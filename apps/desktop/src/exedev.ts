import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Authentication,
  type ConnectionSource,
  type Credentials,
  credentialsSchema,
  type ExeCredentials,
  proxySchema,
  vmNameSchema,
} from "./connection-settings";

export type SSH = (
  host: string,
  command: string[],
  signal?: AbortSignal,
) => Promise<string>;
export const ssh: SSH = (host, command, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "StrictHostKeyChecking=yes",
        host,
        ...command,
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, signal },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              "SSH setup failed. Check that your SSH login can access exe.dev and this VM.",
            ),
          );
        else resolve(stdout);
      },
    );
  });
const vmsSchema = z.object({
  vms: z.array(
    z.object({
      vm_name: vmNameSchema,
      status: z.string(),
      access: z.object({ shell: z.boolean() }),
    }),
  ),
});
const deviceSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  expires: z.number(),
});
const proxyResponseSchema = z.object({
  token: z.string(),
  fingerprint: z.string(),
  namespace: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
});
function jsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "SSH returned an unsupported response. Update exe.dev or Roost and try again.",
    );
  }
}
export class ExeDev {
  constructor(private run: SSH = ssh) {}
  async list(signal?: AbortSignal) {
    const data = vmsSchema.parse(
      jsonResponse(await this.run("exe.dev", ["ls", "--json"], signal)),
    );
    return data.vms
      .filter((vm) => vm.access.shell && vm.status === "running")
      .map((vm) => ({ name: vm.vm_name }))
      .sort(
        (a, b) =>
          Number(b.name.startsWith("roost")) -
            Number(a.name.startsWith("roost")) || a.name.localeCompare(b.name),
      );
  }
  async proxy(vm: string, signal: AbortSignal) {
    vmNameSchema.parse(vm);
    const label = `roost-mac-${randomUUID()}`;
    try {
      const value = proxyResponseSchema.parse(
        jsonResponse(
          await this.run(
            "exe.dev",
            [
              "ssh-key",
              "generate-api-key",
              `--vm=${vm}`,
              `--label=${label}`,
              "--exp=30d",
              "--json",
            ],
            signal,
          ),
        ),
      );
      if (value.namespace !== `v0@${vm}.exe.xyz`)
        throw new Error("exe.dev returned a credential for another VM.");
      const proxy = proxySchema.parse({
        token: value.token,
        fingerprint: value.fingerprint,
        expires: Date.parse(value.expires_at),
      });
      if (proxy.expires <= Date.now())
        throw new Error("exe.dev returned an expired credential.");
      return proxy;
    } catch (error) {
      await this.run("exe.dev", ["ssh-key", "remove", label]).catch(() => {});
      throw error;
    }
  }
  async device(vm: string, id: string, renew: boolean, signal: AbortSignal) {
    vmNameSchema.parse(vm);
    z.uuid().parse(id);
    const command = renew
      ? `~/.local/bin/roost mobile renew --id ${id} --json`
      : `~/.local/bin/roost mobile create --name Roost-Mac --id ${id} --json`;
    let response: string;
    try {
      response = await this.run(`${vm}.exe.xyz`, [command], signal);
    } catch {
      throw new Error(
        renew
          ? "Could not renew this Mac's device credential. It may have been revoked; reconnect explicitly to pair again."
          : "Automatic setup failed. Update Roost on this VM to a build with desktop pairing and check your SSH access.",
      );
    }
    const device = deviceSchema.parse(jsonResponse(response));
    if (device.id !== id)
      throw new Error("Roost returned another device's credential.");
    return device;
  }
  async removeProxy(fingerprint: string) {
    z.string()
      .regex(/^SHA256:[A-Za-z0-9+/]+={0,2}$/)
      .parse(fingerprint);
    await this.run("exe.dev", ["ssh-key", "remove", fingerprint]);
  }
  async removeDevice(vm: string, id: string) {
    vmNameSchema.parse(vm);
    z.uuid().parse(id);
    await this.run(`${vm}.exe.xyz`, [`~/.local/bin/roost mobile revoke ${id}`]);
  }
}

export class CredentialSession {
  private credentials: Credentials | null;
  private loading: Promise<Credentials> | null = null;
  private committed = false;
  private deviceId: string;
  private createdProxy: ExeCredentials["proxy"] | null = null;
  private revocation: Promise<void> | null = null;
  private renewProxy = false;
  readonly origin: string;
  constructor(
    private source: ConnectionSource,
    private signal: AbortSignal,
    private persist: (credentials: Credentials) => void,
    private exe = new ExeDev(),
  ) {
    this.credentials =
      source.kind === "new-exe" ? null : credentialsSchema.parse(source);
    this.origin =
      source.kind === "new-exe"
        ? `https://${vmNameSchema.parse(source.vm)}.exe.xyz`
        : source.origin;
    this.deviceId = source.kind === "exe" ? source.device.id : randomUUID();
  }
  async get(): Promise<Credentials> {
    this.signal.throwIfAborted();
    const current = this.credentials;
    if (
      current &&
      (current.kind === "manual" ||
        (!this.renewProxy &&
          current.device.expires > Date.now() + 86400000 &&
          current.proxy.expires > Date.now() + 86400000))
    )
      return current;
    if (!this.loading)
      this.loading = this.refresh().finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
  private async refresh(): Promise<Credentials> {
    const previous = this.credentials;
    if (this.source.kind === "manual") return this.source;
    const vm = this.source.vm;
    if (!previous) {
      const found = await this.exe.list(this.signal);
      if (!found.some((item) => item.name === vm))
        throw new Error("Choose a running VM you can access through SSH.");
    }
    const old = previous?.kind === "exe" ? previous : null;
    let proxy = old?.proxy;
    let device = old?.device;
    try {
      if (!device || device.expires <= Date.now() + 86400000)
        device = await this.exe.device(
          vm,
          this.deviceId,
          Boolean(old),
          this.signal,
        );
      if (this.renewProxy || !proxy || proxy.expires <= Date.now() + 86400000) {
        proxy = await this.exe.proxy(vm, this.signal);
        this.createdProxy = proxy;
      }
      const next = credentialsSchema.parse({
        kind: "exe",
        origin: this.origin,
        vm,
        device,
        proxy,
      });
      this.signal.throwIfAborted();
      if (previous) this.persist(next);
      this.credentials = next;
      this.renewProxy = false;
      if (old && old.proxy.fingerprint !== proxy.fingerprint) {
        // The new credential is stored before retiring the previous key.
        void this.exe.removeProxy(old.proxy.fingerprint).catch(() => {});
      }
      return next;
    } catch (error) {
      if (proxy && proxy !== old?.proxy)
        await this.exe.removeProxy(proxy.fingerprint).catch(() => {});
      this.createdProxy = null;
      throw error;
    }
  }
  async authentication(): Promise<Authentication> {
    const value = await this.get();
    this.signal.throwIfAborted();
    return value.kind === "manual"
      ? { token: value.token }
      : { token: value.device.token, proxyToken: value.proxy.token };
  }
  cachedAuthentication(): Authentication {
    const value = this.credentials;
    if (!value) throw new Error("Connection setup did not complete.");
    return value.kind === "manual"
      ? { token: value.token }
      : { token: value.device.token, proxyToken: value.proxy.token };
  }
  requireFreshProxy() {
    this.renewProxy = true;
  }
  commit() {
    this.committed = true;
  }
  async rollback() {
    if (this.source.kind === "new-exe" && !this.committed) await this.revoke();
  }
  revoke(): Promise<void> {
    if (!this.revocation) this.revocation = this.removeCredentials();
    return this.revocation;
  }
  private async removeCredentials() {
    if (this.source.kind === "manual") return;
    const current = this.credentials;
    const proxy = current?.kind === "exe" ? current.proxy : this.createdProxy;
    const results = await Promise.allSettled([
      this.exe.removeDevice(this.source.vm, this.deviceId),
      ...(proxy ? [this.exe.removeProxy(proxy.fingerprint)] : []),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error(
        "Local access is off, but server credentials could not all be revoked. Remove the Roost-Mac device and roost-mac key on the server.",
      );
  }
}

import {
  type DesktopResult,
  desktopRequestSchema,
  type Grants,
} from "@roost/desktop-protocol";
import type { RoostAPI } from "./api";
import type { LocalTools } from "./local-tools";

export class DesktopCompanion {
  private lease: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private activeRequest: string | null = null;
  constructor(
    readonly api: RoostAPI,
    private tools: LocalTools,
    private grants: () => Grants,
    private status: (value: string) => void,
    private activity: (value: string) => void,
  ) {}

  async start() {
    const session = await this.api.request("session");
    if (this.stopped) throw new Error("Connection attempt cancelled.");
    if (session.apiVersion !== 1)
      throw new Error("Unsupported Roost API version.");
    const connection = await this.api.request("companion/connect", {});
    if (this.stopped) throw new Error("Connection attempt cancelled.");
    if (
      connection.protocolVersion !== 1 ||
      typeof connection.lease !== "string"
    )
      throw new Error("Update the Roost server to enable desktop companions.");
    this.lease = connection.lease;
    this.status("Connected");
    this.schedule(0);
  }
  private schedule(delay: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), delay);
  }
  private async poll() {
    if (this.stopped || !this.lease) return;
    try {
      const response = await this.api.request("companion/poll", {
        lease: this.lease,
        grants: this.grants(),
      });
      if (this.stopped) return;
      if (!Array.isArray(response.requests) || response.requests.length > 1)
        throw new Error("Unexpected desktop request.");
      if (
        this.activeRequest &&
        Array.isArray(response.activeRequestIds) &&
        !response.activeRequestIds.includes(this.activeRequest)
      )
        this.tools.cancelCurrent();
      this.status("Connected");
      for (const input of response.requests) {
        const request = desktopRequestSchema.parse(input);
        void this.handle(request);
      }
    } catch {
      if (this.stopped) return;
      // A disconnected companion must stop local input immediately, even if a
      // previously fetched action or helper process was still running.
      this.tools.stop();
      this.status("Connection lost — reconnect to restore local access");
      this.stopped = true;
    }
    this.schedule(1000);
  }
  private async handle(request: ReturnType<typeof desktopRequestSchema.parse>) {
    if (this.stopped) return;
    this.activeRequest = request.id;
    this.activity(
      request.call.tool === "roost_desktop_messages"
        ? "Reading a shared conversation"
        : `Computer: ${request.call.input.action}`,
    );
    try {
      let result: DesktopResult;
      try {
        result = await this.tools.handle(request);
      } catch (error) {
        result = {
          success: false,
          text: error instanceof Error ? error.message : "Local access failed.",
        };
      }
      if (!this.stopped)
        await this.api.request("companion/result", {
          lease: this.lease,
          id: request.id,
          result,
        });
    } catch {
      this.activity("Request ended before its result was accepted");
    } finally {
      if (this.activeRequest === request.id) this.activeRequest = null;
    }
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.tools.stop();
    if (this.lease)
      await this.api
        .request("companion/disconnect", { lease: this.lease }, null)
        .catch(() => {});
  }
}

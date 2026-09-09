import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { durableJson } from "./journal";

export type Gate = {
  protocol: 1;
  operation: string | null;
  mode: "open" | "drain" | "hold" | "verify" | "manual";
  version?: string;
  token?: string;
};
export const openGate: Gate = { protocol: 1, operation: null, mode: "open" };
export function readGate(root: string): Gate {
  const file = join(root, "updates", "gate.json");
  try {
    const gate = JSON.parse(readFileSync(file, "utf8")) as Gate;
    if (
      gate.protocol !== 1 ||
      !["open", "drain", "hold", "verify", "manual"].includes(gate.mode) ||
      (gate.mode !== "open" && typeof gate.operation !== "string")
    )
      throw new Error("Invalid update gate.");
    return gate;
  } catch (error) {
    if (
      !existsSync(join(root, "updater.json")) &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return openGate;
    return { protocol: 1, operation: null, mode: "manual" };
  }
}
export const writeGate = (root: string, gate: Gate) =>
  durableJson(join(root, "updates", "gate.json"), gate);
export function appRoot() {
  const root = process.env.ROOST_HOME;
  return root && process.env.ROOST_DATA_DIR === join(resolve(root), "data")
    ? resolve(root)
    : undefined;
}
export function appGate() {
  const root = appRoot();
  return root ? readGate(root) : openGate;
}
export function startupGuard(
  root: string,
  version: string,
  token: string | undefined,
) {
  if (!existsSync(join(root, "updater.json"))) return;
  const gate = readGate(root);
  const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const ready = JSON.parse(
    readFileSync(join(root, "updates", "ready.json"), "utf8"),
  ) as { boot: string };
  if (
    ready.boot !== boot ||
    (gate.mode !== "open" &&
      !(
        gate.mode === "verify" &&
        gate.version === version &&
        token &&
        token === gate.token
      ))
  )
    throw new Error(
      "Updater recovery gate is closed. Run roost updates status; do not remove update records.",
    );
}

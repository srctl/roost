import { useSyncExternalStore } from "react";
import type { UpdateSummary } from "../../updater/daemon";
export type UpdateStatus = {
  capability: { code: string; reason: string; canActivate: boolean };
  version: string;
  latest: {
    id: string;
    version: string;
    notes: string;
    checkedAt: number;
    expiresAt: number;
  } | null;
  operation: UpdateSummary | null;
  csrf: string | null;
  recent: boolean;
  canCheck: boolean;
  enrolled: boolean;
  error?: string;
};
let blocked = false;
const subscribers = new Set<() => void>();
export const isUpdateActive = (operation: UpdateSummary | null) =>
  !!operation &&
  !["succeeded", "rolled-back", "failed", "cancelled", "deferred"].includes(
    operation.phase,
  );
export function publishUpdate(status: UpdateStatus) {
  const next =
    !!status.operation &&
    [
      "draining",
      "stopping",
      "snapshot-complete",
      "activating",
      "verifying",
      "committed",
      "restoring",
      "manual-recovery",
    ].includes(status.operation.phase);
  if (next !== blocked) {
    blocked = next;
    for (const listener of subscribers) listener();
  }
}
export function useUpdateBlocked() {
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    () => blocked,
    () => false,
  );
}
export const pendingKey = "roost-update-pending-v1";
export function rememberAcceptance(key: string, version: string) {
  localStorage.setItem(
    pendingKey,
    JSON.stringify({ key, version, created: Date.now() }),
  );
}
export function pendingAcceptance(): { key: string; version: string } | null {
  try {
    return JSON.parse(localStorage.getItem(pendingKey) ?? "null");
  } catch {
    return null;
  }
}
export function rememberResult(operation: UpdateSummary | null) {
  if (!operation) return true;
  try {
    localStorage.setItem("roost-update-operation-v1", operation.id);
    if (
      !isUpdateActive(operation) &&
      pendingAcceptance()?.key === operation.requestKey
    )
      localStorage.removeItem(pendingKey);
    return true;
  } catch {
    return false;
  }
}
export const phaseLabel: Record<string, string> = {
  accepted: "Downloading",
  staged: "Verifying",
  draining: "Waiting for work",
  stopping: "Stopping writers and backing up",
  "snapshot-complete": "Backup complete",
  activating: "Switching release",
  verifying: "Checking startup",
  committed: "Committing update",
  restoring: "Restoring previous version and data",
  "rolled-back": "Previous version and data restored",
  succeeded: "Update succeeded",
  cancelled: "Update cancelled",
  deferred: "Update deferred — work is still active",
  failed: "Update failed before activation",
  "manual-recovery": "Manual recovery required",
};

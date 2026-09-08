import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  isUpdateActive,
  phaseLabel,
  publishUpdate,
  type UpdateStatus,
  useUpdateBlocked,
} from "../features/updates/state";
export function UpdateNotice() {
  const blocked = useUpdateBlocked();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/api/updates", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const next = (await response.json()) as UpdateStatus;
          if (!stopped) {
            setStatus(next);
            publishUpdate(next);
          }
        }
      } catch {
        /* Keep the last known admission notice during an outage. */
      } finally {
        if (!stopped) timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return status && isUpdateActive(status.operation) ? (
    <aside role="status" aria-live="polite">
      Roost update: {phaseLabel[status.operation!.phase]}.{" "}
      {blocked ? "New work is paused." : "Existing work can continue."}{" "}
      <Link to="/settings" search={{ group: "updates" }}>
        View update status
      </Link>
    </aside>
  ) : null;
}

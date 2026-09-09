import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import {
  isUpdateActive,
  pendingAcceptance,
  pendingKey,
  phaseLabel,
  publishUpdate,
  rememberAcceptance,
  rememberResult,
  type UpdateStatus,
} from "../features/updates/state";
import { colors } from "../styles/tokens.stylex";
import { compareVersions, stableVersion } from "../updater/contract";
import { Button } from "./ui/button";

export function UpdateSetting() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("Loading update availability…");
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [version, setVersion] = useState("");
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const newer =
    !!status?.latest &&
    stableVersion.test(status.version) &&
    compareVersions(status.latest.version, status.version) > 0;
  const confirmation = useRef<HTMLInputElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement>(null);
  function closeConfirmation() {
    setConfirm(false);
    confirmationTrigger.current?.focus();
  }
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    setUncertain(!!pendingAcceptance());
    const poll = async () => {
      try {
        const response = await fetch("/api/updates", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          setNeedsAuth(true);
          setMessage(
            "Sign in again to read the durable update result. Do not resubmit the update.",
          );
          return;
        }
        if (!response.ok) throw new Error();
        const value = (await response.json()) as UpdateStatus;
        if (stopped) return;
        setNeedsAuth(false);
        setStatus(value);
        publishUpdate(value);
        if (!rememberResult(value.operation)) {
          setMessage(
            "Browser storage is unavailable. Keep this tab open to observe the operation.",
          );
          return;
        }
        attempt = 0;
        let pending = pendingAcceptance();
        if (pending && pending.key !== value.operation?.requestKey) {
          // Another browser may have completed a later operation while this
          // browser was offline. Resolve this key without replacing live status
          // or publishing historical admission state to the rest of the app.
          const lookup = await fetch(
            `/api/updates?key=${encodeURIComponent(pending.key)}`,
            {
              cache: "no-store",
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!lookup.ok) throw new Error();
          const historical = (await lookup.json()) as UpdateStatus;
          if (stopped) return;
          if (
            historical.operation?.requestKey === pending.key &&
            !isUpdateActive(historical.operation)
          ) {
            if (!rememberResult(historical.operation)) throw new Error();
            pending = pendingAcceptance();
            setUncertain(!!pending);
            setMessage(
              `Earlier request: ${phaseLabel[historical.operation.phase]}. Current installation status is shown below.`,
            );
            return;
          }
        }
        setUncertain(!!pending && pending.key !== value.operation?.requestKey);
        if (
          value.operation &&
          (!pending || pending.key === value.operation.requestKey)
        ) {
          setMessage(value.error ?? "");
        } else if (!pending) setMessage(value.error ?? "");
      } catch {
        if (!stopped)
          setMessage(
            "Reconnecting… Roost may be restarting. No result has been confirmed; no request will be replayed.",
          );
        attempt++;
      } finally {
        if (!stopped)
          timer = setTimeout(
            poll,
            Math.min(30000, 2000 * 2 ** Math.min(attempt, 4)) +
              Math.random() * 500,
          );
      }
    };
    void poll();
    const changed = () => {
      setUncertain(!!pendingAcceptance());
    };
    window.addEventListener("storage", changed);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("storage", changed);
    };
  }, []);
  useEffect(() => {
    if (confirm) confirmation.current?.focus();
  }, [confirm]);
  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Roost-CSRF": status?.csrf ?? "",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(22000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Request not confirmed.");
    return result;
  }
  async function check() {
    setChecking(true);
    try {
      const result = await post("/api/updates/check", {});
      setStatus((s) => (s ? { ...s, latest: result.latest } : s));
      setMessage(
        "Release metadata checked. The updater verifies artifact and migration compatibility before stopping Roost.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  }
  async function activate() {
    if (!status?.latest || sending || version !== status.latest.version) return;
    const key = crypto.randomUUID();
    try {
      rememberAcceptance(key, version);
    } catch {
      setMessage(
        "Browser storage is unavailable. Enable it before updating so acceptance can be reconciled after a disconnect.",
      );
      return;
    }
    setSending(true);
    setUncertain(true);
    setConfirm(false);
    try {
      const result = await post("/api/updates", {
        offerId: status.latest.id,
        version,
        key,
      });
      setStatus({ ...status, operation: result.operation });
      if (!rememberResult(result.operation))
        setMessage(
          "The update was accepted, but browser storage is unavailable. Keep this tab open to observe it.",
        );
      setUncertain(false);
    } catch {
      setMessage(
        "Acceptance response was lost or refused. Reading durable status; do not submit again. If no operation appears, inspect updater status before a new confirmation.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <div {...stylex.props(styles.card)}>
      <h2 {...stylex.props(styles.title)}>Software updates</h2>
      {status && (
        <>
          <p>
            Running version:{" "}
            <strong>
              {status.version === "dev" ? "Source build" : status.version}
            </strong>
          </p>
          <p>{status.capability.reason}</p>
          {status.latest && (
            <>
              <p>
                Latest published stable release:{" "}
                <strong>{status.latest.version}</strong>
              </p>
              <p>
                Checked {new Date(status.latest.checkedAt).toLocaleString()}.
              </p>
              <details>
                <summary>Release notes</summary>
                <p {...stylex.props(styles.notes)}>
                  {status.latest.notes || "No release notes provided."}
                </p>
              </details>
            </>
          )}
          <Button
            allowDuringUpdate
            disabled={
              !status.canCheck ||
              checking ||
              needsAuth ||
              !status.recent ||
              isUpdateActive(status.operation)
            }
            onClick={check}
          >
            {checking ? "Checking…" : "Check for updates"}
          </Button>
          {!status.canCheck && (
            <p {...stylex.props(styles.muted)}>
              Release checks require a packaged installation with a configured
              repository and native passkey sign-in.
            </p>
          )}
          {status.latest && !newer && stableVersion.test(status.version) && (
            <p>No newer stable release was found.</p>
          )}
          {status.capability.canActivate &&
            status.latest &&
            newer &&
            !isUpdateActive(status.operation) && (
              <Button
                ref={confirmationTrigger}
                disabled={
                  !status.recent ||
                  needsAuth ||
                  uncertain ||
                  status.latest.expiresAt <= Date.now()
                }
                onClick={() => {
                  setVersion("");
                  setConfirm(true);
                }}
              >
                Update to {status.latest.version}
              </Button>
            )}
          {confirm && (
            <section aria-label="Confirm update">
              <p>
                Roost will be unavailable briefly. Active or uncertain work
                defers the update. Startup failure may restore the previous
                release and matching data. External actions cannot be undone.
              </p>
              <label>
                Type {status.latest?.version} to confirm{" "}
                <input
                  ref={confirmation}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeConfirmation();
                    }
                  }}
                  maxLength={32}
                  autoComplete="off"
                />
              </label>
              <Button
                disabled={
                  version !== status.latest?.version ||
                  sending ||
                  needsAuth ||
                  !status.recent
                }
                onClick={activate}
              >
                Confirm update and outage
              </Button>
              <Button onClick={closeConfirmation}>Keep current version</Button>
            </section>
          )}
          {status.operation && (
            <section aria-label="Update progress">
              <p role="status">
                {phaseLabel[status.operation.phase] ?? status.operation.phase}
              </p>
              {status.operation.bytes !== undefined && (
                <p>
                  {status.operation.bytes.toLocaleString()} bytes downloaded
                </p>
              )}
              {status.operation.blockers?.map((b) => (
                <p key={b}>{b}</p>
              ))}
              {status.operation.error && <p>{status.operation.error}</p>}
              {status.operation.cancellable && (
                <Button
                  allowDuringUpdate
                  disabled={needsAuth || !status.recent}
                  onClick={() => {
                    void post(
                      `/api/updates/${status.operation!.id}/cancel`,
                      {},
                    ).then(
                      () =>
                        setMessage(
                          "Cancellation requested. Waiting for durable status.",
                        ),
                      () =>
                        setMessage(
                          "Cancellation not confirmed. Continue observing status.",
                        ),
                    );
                  }}
                >
                  Cancel update
                </Button>
              )}
              {!isUpdateActive(status.operation) && (
                <Button
                  allowDuringUpdate
                  onClick={() => window.location.reload()}
                >
                  Reload versioned app assets
                </Button>
              )}
            </section>
          )}
          {!status.capability.canActivate && (
            <p {...stylex.props(styles.muted)}>
              UI installation and restart are not enabled for this installation.
              Updates require an outage; external actions cannot be undone.
            </p>
          )}
        </>
      )}
      {uncertain && (
        <p>
          Checking an earlier confirmation. No activation request will be
          automatically repeated.
        </p>
      )}
      {uncertain && status && !isUpdateActive(status.operation) && (
        <Button
          allowDuringUpdate
          onClick={() => {
            localStorage.removeItem(pendingKey);
            setUncertain(false);
            setMessage(
              "Pending confirmation dismissed. A new update still requires checking and explicit version confirmation.",
            );
          }}
        >
          Dismiss pending confirmation after inspecting updater status
        </Button>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {(needsAuth || (status && !status.recent && status.canCheck)) && (
        <p>
          <a href="/auth?updates=1">Sign in again</a> to return to Updates and
          read the durable result before confirming another action.
        </p>
      )}
    </div>
  );
}
const styles = stylex.create({
  card: {
    padding: 20,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflowWrap: "anywhere",
  },
  title: { marginTop: 0, fontSize: 18 },
  muted: { color: colors.muted, fontSize: 14 },
  notes: { whiteSpace: "pre-wrap" },
});

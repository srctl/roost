import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { colors } from "../styles/tokens.stylex";
import type { Capability } from "../updater/contract";
import type { Offer } from "../updater/releases";
import { Button } from "./ui/button";

type Status = {
  capability: Capability;
  version: string;
  latest: Offer | null;
  canCheck: boolean;
  csrf: string | null;
  recent: boolean;
};

export function UpdateSetting() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("Loading update availability…");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/updates", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not load update availability. Sign in or reload to retry.",
          );
        return (await response.json()) as Status;
      })
      .then((value) => {
        setStatus(value);
        setMessage("");
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setMessage(
            "Could not load update availability. Sign in or reload to retry.",
          );
      });
    return () => abort.abort();
  }, []);
  async function check() {
    if (!status?.csrf || checking) return;
    setChecking(true);
    setMessage("Checking published releases…");
    try {
      const response = await fetch("/api/updates/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Roost-CSRF": status.csrf,
        },
        body: "{}",
        signal: AbortSignal.timeout(20000),
      });
      const result = (await response.json()) as {
        latest?: Offer;
        error?: string;
      };
      if (!response.ok || !result.latest)
        throw new Error(result.error ?? "Could not check releases.");
      setStatus({ ...status, latest: result.latest });
      setMessage(
        "Release metadata checked. Activation compatibility has not been verified.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not check releases. Try again.",
      );
    } finally {
      setChecking(false);
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
                Compatibility is not yet verified.
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
            disabled={!status.canCheck || checking || !status.recent}
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
          {status.canCheck && !status.recent && (
            <p>
              <a href="/auth">Sign in again</a> to check for updates.
            </p>
          )}
          <p {...stylex.props(styles.muted)}>
            UI installation and restart are not enabled in this build. Updates
            require an outage; external actions cannot be undone.
          </p>
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
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

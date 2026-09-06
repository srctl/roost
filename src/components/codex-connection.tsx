import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "./ui/button";
import { colors } from "../styles/tokens.stylex";
import type { CodexLogin } from "../features/auth/schema";
import {
  getCodexAccount,
  getCodexLogin,
  startCodexLogin,
  cancelCodexLogin,
} from "../features/auth/functions";

export function CodexConnection() {
  const router = useRouter();
  const [login, setLogin] = useState<CodexLogin>({ status: "idle" });
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let current = true;
    void Promise.all([getCodexAccount(), getCodexLogin()])
      .then(([account, state]) => {
        if (current) {
          setConfigured(account.configured);
          setLogin(state);
        }
      })
      .catch(() => {
        if (current)
          setError(
            "Could not read connection status. Try reloading this page.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (login.status !== "pending") return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getCodexLogin();
        if (!current) return;
        setLogin(next);
        setError(undefined);
        if (next.status === "connected") {
          setConfigured(true);
          void router.invalidate();
        }
      } catch {
        if (current)
          setError("Connection interrupted. Checking sign-in again…");
      }
      if (current) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [login.status, router]);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      setLogin(await startCodexLogin());
    } catch {
      setError("Could not reach Roost. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (busy || login.status !== "pending") return;
    setBusy(true);
    try {
      setLogin(await cancelCodexLogin({ data: { loginId: login.loginId } }));
      setError(undefined);
    } catch {
      setError("Could not cancel sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      {...stylex.props(styles.section)}
      aria-labelledby="codex-connection-title"
    >
      <div {...stylex.props(styles.heading)}>
        <h2 id="codex-connection-title" {...stylex.props(styles.title)}>
          Codex connection
        </h2>
        {login.status !== "pending" && (
          <Button
            disabled={loading || busy}
            onClick={() => void start()}
            xstyle={styles.primary}
          >
            {busy
              ? "Connecting…"
              : configured
                ? "Reconnect Codex"
                : "Connect Codex"}
          </Button>
        )}
      </div>
      <p {...stylex.props(styles.description)}>
        {loading
          ? "Checking this machine’s login…"
          : login.status === "connected"
            ? "Signed in. Your agents are ready to use Codex."
            : configured
              ? "This machine has a saved Codex login. Reconnect if your agents need you to sign in again."
              : "Sign in with ChatGPT to let your agents use Codex on this machine."}
      </p>
      {login.status === "pending" && (
        <div {...stylex.props(styles.device)}>
          <p {...stylex.props(styles.step)}>1. Copy this one-time code.</p>
          <div {...stylex.props(styles.codeRow)}>
            <code {...stylex.props(styles.code)}>{login.userCode}</code>
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(login.userCode)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Copy the code manually, then open the sign-in page.",
                    ),
                  );
              }}
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
          <p {...stylex.props(styles.step)}>
            2. Open the sign-in page and enter your code.
          </p>
          <div {...stylex.props(styles.actions)}>
            <a
              href={login.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(styles.signIn)}
            >
              Open ChatGPT sign-in ↗
            </a>
            <Button disabled={busy} onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
          <p role="status" {...stylex.props(styles.description)}>
            Waiting for you to finish signing in… You can return here when
            you’re done.
          </p>
        </div>
      )}
      {(error || login.status === "error") && (
        <p role="alert" {...stylex.props(styles.description)}>
          {error ?? (login.status === "error" ? login.error : "")}
        </p>
      )}
      <p {...stylex.props(styles.note)}>
        Applies to all agents on this Roost machine. Sign-in is handled by
        OpenAI.
      </p>
    </section>
  );
}
const styles = stylex.create({
  section: {
    marginBlock: 28,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 14, fontWeight: 500, margin: 0 },
  description: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginBlock: 10,
  },
  note: { color: colors.muted, fontSize: 11, marginBottom: 0 },
  primary: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 12,
    opacity: { default: 1, ":disabled": 0.5 },
  },
  device: {
    marginBlock: 18,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
  },
  step: { fontSize: 12, marginTop: 0, marginBottom: 12 },
  codeRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  code: { fontSize: 24, letterSpacing: 2, fontWeight: 500, userSelect: "all" },
  actions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16 },
  signIn: {
    color: colors.accent,
    fontSize: 12,
    paddingBlock: 8,
    textUnderlineOffset: 4,
  },
});

import * as stylex from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getConnection } from "../features/agents/functions";
import { saveAgentModelSettings } from "../features/agents/model-functions";
import type { Agent } from "../features/agents/schema";
import type { CodexModel } from "../server/codex/app-server.server";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function AgentModelSettings({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [models, setModels] = useState<CodexModel[]>([]);
  const [model, setModel] = useState(agent.model);
  const [effort, setEffort] = useState(agent.reasoningEffort ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    void getConnection()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setModels(result.value.models);
        else setError(result.error);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not load available models. Reopen settings to retry.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const selected = models.find((entry) => entry.model === model);
  return (
    <form
      aria-label="Model settings"
      {...stylex.props(styles.root)}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const result = await saveAgentModelSettings({
            data: {
              agentId: agent.id,
              model,
              reasoningEffort: effort || null,
              expectedModel: agent.model,
              expectedReasoningEffort: agent.reasoningEffort ?? null,
            },
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          await router.invalidate();
          setNotice("Model settings saved.");
        } catch {
          setError("Could not save model settings. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label {...stylex.props(styles.field)}>
        Model
        <select
          value={model}
          disabled={busy || !models.length}
          onChange={(event) => {
            setModel(event.target.value);
            setEffort("");
          }}
          {...stylex.props(styles.input)}
        >
          {!selected && <option value={model}>{model}</option>}
          {models.map((entry) => (
            <option key={entry.model} value={entry.model}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </label>
      <label {...stylex.props(styles.field)}>
        Reasoning effort
        <select
          value={effort}
          disabled={busy || !selected}
          onChange={(event) => setEffort(event.target.value)}
          {...stylex.props(styles.input)}
        >
          <option value="">
            Model default
            {selected?.defaultReasoningEffort
              ? ` (${selected.defaultReasoningEffort})`
              : ""}
          </option>
          {effort &&
            !selected?.supportedReasoningEfforts?.some(
              (entry) => entry.reasoningEffort === effort,
            ) && <option value={effort}>{effort} (unavailable)</option>}
          {selected?.supportedReasoningEfforts?.map((entry) => (
            <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
              {entry.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      <p {...stylex.props(styles.help)}>
        Applies to future turns in this agent’s existing conversations and
        background work. Automation model overrides keep their own selection.
        Higher effort gives the model more time to reason and can use more
        tokens.
      </p>
      <Button type="submit" disabled={busy || !selected}>
        {busy ? "Saving…" : "Save model settings"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
const styles = stylex.create({
  root: {
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    paddingBottom: 16,
    display: "grid",
    gap: 12,
    flexShrink: 0,
  },
  field: { display: "grid", gap: 6, fontSize: 14 },
  input: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    width: "100%",
  },
  help: { margin: 0, color: colors.muted, fontSize: 12, lineHeight: 1.5 },
});

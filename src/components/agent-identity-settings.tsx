import { Tabs } from "@base-ui/react/tabs";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import {
  getAgentIdentity,
  reflectAgentNow,
  saveAgentReflection,
  saveAgentSoul,
} from "../features/agents/functions";
import { colors } from "../styles/tokens.stylex";
import { AgentAutomationSettings } from "./agent-automation-settings";
import { MessageContent } from "./conversation/message-content";
import { SoulChangeDetails } from "./soul-change";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Icon } from "./ui/primitives";

type Identity = Extract<
  Awaited<ReturnType<typeof getAgentIdentity>>,
  { ok: true }
>["value"];

export function AgentIdentitySettings({ agentId }: { agentId: string }) {
  const [editing, setEditing] = useState(false);
  const [changeId, setChangeId] = useState<string>();
  const [identity, setIdentity] = useState<Identity>();
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoading(true);
    void getAgentIdentity({ data: { agentId } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);

          return;
        }
        setIdentity(result.value);
        setContent(result.value.soul.content);
      })
      .catch(() => {
        if (!cancelled)
          setError("Could not load this agent's soul and memories.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, reload]);

  async function save() {
    if (!identity) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveAgentSoul({
        data: { agentId, content, revision: identity.soul.revision },
      });
      if (!result.ok) {
        setError(result.error);

        return;
      }
      const refreshed = await getAgentIdentity({ data: { agentId } });
      setIdentity(
        refreshed.ok ? refreshed.value : { ...identity, soul: result.value },
      );
      setContent(result.value.content);
      setNotice("Saved. Applies to the next message.");
      setEditing(false);
    } catch {
      setError("Could not save the soul. Your edits are still here.");
    } finally {
      setSaving(false);
    }
  }

  async function configureReflection(intervalMinutes: 0 | 60 | 360 | 1440) {
    setSaving(true);
    setError("");
    try {
      const result = await saveAgentReflection({
        data: { agentId, intervalMinutes },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReload((value) => value + 1);
    } catch {
      setError("Could not save reflection settings.");
    } finally {
      setSaving(false);
    }
  }

  async function reflectNow() {
    setSaving(true);
    setError("");
    try {
      const result = await reflectAgentNow({
        data: { agentId, requestId: crypto.randomUUID() },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        "Reflection queued. Changes will appear in this conversation and soul history.",
      );
      setReload((value) => value + 1);
    } catch {
      setError("Could not start reflection.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshMemories() {
    setLoading(true);
    setError("");
    try {
      const result = await getAgentIdentity({ data: { agentId } });
      if (!result.ok) {
        setError(result.error);

        return;
      }
      setIdentity((current) =>
        current
          ? { ...current, memories: result.value.memories }
          : result.value,
      );
    } catch {
      setError("Could not refresh memories.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Tabs.Root defaultValue="soul" {...stylex.props(styles.root)}>
      <Tabs.List
        aria-label="Agent settings sections"
        {...stylex.props(styles.tabs)}
      >
        <Tabs.Tab value="soul" {...stylex.props(styles.tab)}>
          Soul
        </Tabs.Tab>
        <Tabs.Tab value="memory" {...stylex.props(styles.tab)}>
          Memory
        </Tabs.Tab>
        <Tabs.Tab value="automations" {...stylex.props(styles.tab)}>
          Automations
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="soul" {...stylex.props(styles.panel)}>
        <p {...stylex.props(styles.help)}>
          Your agent’s purpose, personality, and boundaries. You can edit these
          or let your agent refine them through reflection.
        </p>
        {identity && (
          <>
            <div {...stylex.props(styles.toolbar)}>
              <span {...stylex.props(styles.documentLabel)}>
                {editing ? "Edit soul" : "Soul"}
              </span>
              <div {...stylex.props(styles.actions)}>
                {editing ? (
                  <>
                    <Button
                      disabled={saving || loading}
                      onClick={() => {
                        setContent(identity.soul.content);
                        setEditing(false);
                        setNotice("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      xstyle={styles.save}
                      disabled={
                        saving ||
                        loading ||
                        !content.trim() ||
                        content.trim() === identity.soul.content.trim()
                      }
                      onClick={() => void save()}
                    >
                      {saving ? "Saving…" : "Save soul"}
                    </Button>
                  </>
                ) : (
                  <Button
                    xstyle={styles.edit}
                    disabled={loading}
                    onClick={() => setEditing(true)}
                  >
                    Edit soul
                  </Button>
                )}
              </div>
            </div>
            {editing ? (
              <>
                <label
                  htmlFor={`soul-${agentId}`}
                  {...stylex.props(styles.label)}
                >
                  SOUL.md · Markdown
                </label>
                <textarea
                  id={`soul-${agentId}`}
                  // biome-ignore lint/a11y/noAutofocus: Focus the editor only after the user chooses Edit soul.
                  autoFocus
                  value={content}
                  maxLength={16000}
                  spellCheck={false}
                  disabled={saving || loading}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setNotice("");
                  }}
                  {...stylex.props(styles.editor)}
                />
              </>
            ) : (
              <div {...stylex.props(styles.document)}>
                <MessageContent>{content}</MessageContent>
              </div>
            )}
            <p {...stylex.props(styles.help)}>
              Previous versions are kept. Memories never replace these
              instructions.
            </p>
          </>
        )}
        {identity && (
          <section {...stylex.props(styles.history)}>
            <h3 {...stylex.props(styles.documentLabel)}>Reflection</h3>
            <p {...stylex.props(styles.help)}>
              Review recent conversations and memory, then make small, grounded
              soul improvements. Runs only after new activity and stays quiet
              when nothing needs changing. Every edit has a reason and Undo.
            </p>
            <div {...stylex.props(styles.reflectionControls)}>
              <label htmlFor={`reflection-${agentId}`}>Reflect</label>
              <select
                id={`reflection-${agentId}`}
                value={identity.reflection.intervalMinutes}
                disabled={saving || loading || editing}
                onChange={(event) =>
                  void configureReflection(
                    Number(event.target.value) as 0 | 60 | 360 | 1440,
                  )
                }
                {...stylex.props(styles.interval)}
              >
                <option value={0}>Off</option>
                <option value={60}>Every hour</option>
                <option value={360}>Every 6 hours</option>
                <option value={1440}>Every day</option>
              </select>
              <Button
                disabled={
                  saving ||
                  loading ||
                  editing ||
                  ["queued", "running"].includes(
                    identity.reflection.latest?.status ?? "",
                  )
                }
                onClick={() => void reflectNow()}
              >
                Reflect now
              </Button>
              <Button
                disabled={saving || loading || editing}
                onClick={() => setReload((value) => value + 1)}
              >
                Refresh
              </Button>
            </div>
            <p {...stylex.props(styles.help)}>
              {identity.reflection.latest
                ? `Last reflection: ${identity.reflection.latest.status} · ${new Date(identity.reflection.latest.finishedAt ?? identity.reflection.latest.createdAt).toLocaleString()}.`
                : "No reflections yet."}
              {identity.reflection.nextRunAt
                ? ` Next check: ${new Date(identity.reflection.nextRunAt).toLocaleString()}.`
                : " Periodic reflection is off."}
            </p>
          </section>
        )}
        <Collapsible {...stylex.props(styles.history)}>
          <CollapsibleTrigger {...stylex.props(styles.historyTrigger)}>
            <Icon name="chevron-right" />
            <span>Change history</span>
            <span {...stylex.props(styles.count)}>
              {identity?.changes.length ?? 0}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {identity?.changes.length === 0 && (
              <p {...stylex.props(styles.help)}>No changes yet.</p>
            )}
            {identity?.changes.map((change) => (
              <div key={change.id}>
                <Button onClick={() => setChangeId(change.id)}>
                  {change.reason}
                </Button>
                <p {...stylex.props(styles.help)}>
                  {change.source === "reflection"
                    ? "Reflection"
                    : change.source === "agent"
                      ? "Agent"
                      : "You"}{" "}
                  · {new Date(change.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
        {changeId && (
          <SoulChangeDetails
            agentId={agentId}
            id={changeId}
            onClose={() => setChangeId(undefined)}
            onUndo={() => setReload((value) => value + 1)}
          />
        )}
      </Tabs.Panel>
      <Tabs.Panel value="automations" {...stylex.props(styles.panel)}>
        <AgentAutomationSettings agentId={agentId} />
      </Tabs.Panel>
      <Tabs.Panel value="memory" {...stylex.props(styles.panel)}>
        <p {...stylex.props(styles.help)}>
          What this agent has learned. Its Codex memory and session store are
          separate from your other agents and your own Codex sessions.
        </p>
        {identity?.memories.length === 0 && (
          <p>
            No memories yet. Codex builds them in the background from eligible
            conversations, so they won’t appear after every reply.
          </p>
        )}
        {identity?.memories.map((memory) => (
          <section key={memory.name}>
            <h3 {...stylex.props(styles.label)}>{memory.name}</h3>
            <pre {...stylex.props(styles.memory)}>{memory.content}</pre>
          </section>
        ))}
        <Button
          disabled={saving || loading}
          onClick={() => void refreshMemories()}
        >
          Refresh memories
        </Button>
        <p {...stylex.props(styles.help)}>
          Your Codex sign-in and connected apps belong to you and can be shared.
        </p>
      </Tabs.Panel>
      {!identity && !error && <p role="status">Loading…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            disabled={saving || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload from disk
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" {...stylex.props(styles.help)}>
          {notice}
        </p>
      )}
    </Tabs.Root>
  );
}

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  panel: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    paddingBottom: "max(24px, env(safe-area-inset-bottom))",
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
  },
  toolbar: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: colors.background,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 12,
  },
  documentLabel: { fontWeight: 500, fontSize: 14 },
  document: {
    paddingBlock: 16,
    overflowWrap: "anywhere",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  edit: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    paddingInline: 12,
    color: colors.foreground,
  },
  history: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    marginTop: 24,
  },
  historyTrigger: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingBlock: 14,
    paddingInline: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    color: colors.foreground,
    fontSize: 12,
    cursor: "pointer",
  },
  count: { marginLeft: "auto", color: colors.muted },
  tabs: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  tab: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingBlock: 10,
    paddingInline: 12,
    minHeight: 44,
    color: { default: colors.muted, ":is([data-active])": colors.foreground },
    font: "inherit",
    cursor: "pointer",
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "transparent",
      ":is([data-active])": colors.accent,
    },
  },
  help: { fontSize: 12, color: colors.muted, marginBlock: 16 },
  label: {
    display: "block",
    fontSize: 11,
    color: colors.muted,
    fontWeight: 500,
    marginBottom: 8,
  },
  editor: {
    width: "100%",
    height: "45dvh",
    minHeight: 220,
    resize: "none",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "monospace",
    fontSize: { default: 12, "@media (max-width: 700px)": 16 },
    lineHeight: 1.6,
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
  },
  save: {
    borderWidth: 0,
    borderRadius: 6,
    minHeight: 32,
    fontSize: 12,
    cursor: { default: "pointer", ":disabled": "default" },
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 12,
    opacity: { default: 1, ":disabled": 0.5 },
  },
  actions: { display: "flex", gap: 8 },
  reflectionControls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
  },
  interval: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    padding: 8,
    font: "inherit",
  },
  memory: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: 12,
    fontFamily: "monospace",
    maxHeight: 400,
    overflowY: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
  },
});

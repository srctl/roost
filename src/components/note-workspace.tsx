import * as stylex from "@stylexjs/stylex";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNote,
  getNoteHistory,
  getNoteRevision,
  restoreNoteRevision,
  updateNote,
  updateNoteInstructions,
} from "../features/notes/functions";
import {
  NoteContent,
  NoteInstructions,
  type NoteSnapshot,
  reconcileNote,
} from "../features/notes/schema";
import { noteColors } from "../styles/notes.stylex";
import { colors } from "../styles/tokens.stylex";
import { NoteButton } from "./note-button";
import { NoteEditor } from "./note-editor";
import { NotePreview } from "./note-preview";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
type Draft = {
  base: NoteSnapshot;
  blocks: NoteSnapshot["blocks"];
  instructions: string;
};
type Pending =
  | {
      kind: "content";
      data: {
        agentId: string;
        requestId: string;
        revision: number;
        blocks: NoteSnapshot["blocks"];
      };
    }
  | {
      kind: "instructions";
      data: {
        agentId: string;
        requestId: string;
        revision: number;
        instructions: string;
      };
    };

export function NoteWorkspace({ initial }: { initial: NoteSnapshot }) {
  const [base, setBase] = useState(initial);
  const [blocks, setBlocks] = useState(initial.blocks);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [version, setVersion] = useState(0);
  const [conflict, setConflict] = useState<NoteSnapshot | null>(null);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [history, setHistory] = useState<
    { revision: number; source: string; updatedAt: number }[] | null
  >(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const historyBusy = useRef(false);
  const [preview, setPreview] = useState<NoteSnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [ready, setReady] = useState(false);
  const busy = useRef(false),
    focused = useRef(false),
    pending = useRef<Pending | null>(null);
  const current = useRef({ base, blocks, instructions, conflict, recovery });
  current.current = { base, blocks, instructions, conflict, recovery };
  const key = `roost:note-draft:${initial.agentId}`;
  const dirty =
    !same(blocks, base.blocks) || instructions !== base.instructions;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const draft = JSON.parse(saved) as Draft;
        if (
          draft.base.agentId !== initial.agentId ||
          !Number.isSafeInteger(draft.base.revision)
        )
          throw new Error("Invalid draft");
        Schema.decodeUnknownSync(NoteContent)(draft.base.blocks);
        Schema.decodeUnknownSync(NoteContent)(draft.blocks);
        Schema.decodeUnknownSync(NoteInstructions)(draft.instructions);
        if (
          !same(draft.blocks, initial.blocks) ||
          draft.instructions !== initial.instructions
        ) {
          setRecovery(draft);
          setStatus("Unsaved draft found");
        } else localStorage.removeItem(key);
      }
    } catch {
      setError("A saved draft could not be read. Your server note is intact.");
    }
    setOnline(navigator.onLine);
    setReady(true);
  }, [key, initial]);

  useEffect(() => {
    if (!ready || recovery) return;
    try {
      if (dirty)
        localStorage.setItem(
          key,
          JSON.stringify({ base, blocks, instructions }),
        );
      else localStorage.removeItem(key);
    } catch {
      setStorageWarning(
        "Local recovery storage is unavailable. Keep this page open until Saved appears.",
      );
    }
  }, [ready, recovery, dirty, key, base, blocks, instructions]);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    try {
      const response = await getNote({ data: { agentId: initial.agentId } });
      if (!response.ok) return;
      const state = current.current;
      if (response.value.revision <= state.base.revision) return;
      if (
        focused.current ||
        !same(state.blocks, state.base.blocks) ||
        state.instructions !== state.base.instructions ||
        state.recovery
      ) {
        setConflict(response.value);
        return;
      }
      pending.current = null;
      setBase(response.value);
      setBlocks(response.value.blocks);
      setInstructions(response.value.instructions);
      setVersion((v) => v + 1);
    } catch {
      /* The next poll/reconnect retries without disturbing the editor. */
    }
  }, [initial.agentId]);

  useEffect(() => {
    const offline = () => {
      setOnline(false);
      setStatus("Offline · draft kept on this device");
    };
    const reconnect = () => {
      setOnline(true);
      setError("");
      void refresh();
    };
    const timer = window.setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 5000);
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
    };
  }, [initial.agentId, refresh]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useCallback(async () => {
    const state = current.current;
    if (busy.current || state.conflict || state.recovery || !navigator.onLine)
      return;
    const contentChanged = !same(state.blocks, state.base.blocks);
    if (
      !pending.current &&
      !contentChanged &&
      state.instructions === state.base.instructions
    )
      return;
    const request: Pending =
      pending.current ??
      (contentChanged
        ? {
            kind: "content",
            data: {
              agentId: initial.agentId,
              requestId: crypto.randomUUID(),
              revision: state.base.revision,
              blocks: state.blocks,
            },
          }
        : {
            kind: "instructions",
            data: {
              agentId: initial.agentId,
              requestId: crypto.randomUUID(),
              revision: state.base.revision,
              instructions: state.instructions,
            },
          });
    pending.current = request;
    busy.current = true;
    setStatus("Saving…");
    setError("");
    try {
      const response =
        request.kind === "content"
          ? await updateNote({ data: request.data })
          : await updateNoteInstructions({ data: request.data });
      if (!response.ok) {
        if (response.error.includes("NOTE_CONFLICT")) {
          pending.current = null;
          const latest = await getNote({ data: { agentId: initial.agentId } });
          if (latest.ok) setConflict(latest.value);
        }
        throw new Error(response.error);
      }
      pending.current = null;
      setBase(response.value);
      setStatus("Saved");
    } catch (failure) {
      setStatus("Not saved");
      setError(
        failure instanceof Error
          ? failure.message.replace(/^NOTE_CONFLICT: /, "")
          : "Could not save. Your draft is kept on this device. Retry when connected.",
      );
    } finally {
      busy.current = false;
    }
  }, [initial.agentId]);

  useEffect(() => {
    if (!ready || !dirty || !online || conflict || recovery || error) return;
    const timer = window.setTimeout(() => void save(), 750);
    return () => window.clearTimeout(timer);
  }, [
    save,
    ready,
    blocks,
    instructions,
    base,
    dirty,
    online,
    conflict,
    recovery,
    error,
  ]);

  function load(snapshot: NoteSnapshot) {
    pending.current = null;
    setBase(snapshot);
    setBlocks(snapshot.blocks);
    setInstructions(snapshot.instructions);
    setVersion((v) => v + 1);
    setConflict(null);
    setRecovery(null);
    setError("");
    setStatus("Saved");
  }
  function merge(remote: NoteSnapshot, draft: Draft) {
    const merged = reconcileNote(
      draft.base.blocks,
      draft.blocks,
      remote.blocks,
    );
    const instructionConflict =
      draft.instructions !== draft.base.instructions &&
      remote.instructions !== draft.base.instructions &&
      draft.instructions !== remote.instructions;
    if (!merged || instructionConflict) {
      setError(
        "Both versions changed the same content. Download your draft, then reload the saved note and reapply your changes.",
      );
      return;
    }
    pending.current = null;
    setBase(remote);
    setBlocks(merged);
    setInstructions(
      draft.instructions === draft.base.instructions
        ? remote.instructions
        : draft.instructions,
    );
    setConflict(null);
    setRecovery(null);
    setError("");
    setVersion((v) => v + 1);
    setStatus("Unsaved changes");
  }

  function downloadDraft() {
    const blob = new Blob(
      [JSON.stringify(recovery ?? { base, blocks, instructions }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "shared-note-draft.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function showHistory(before?: number) {
    if (historyBusy.current) return;
    historyBusy.current = true;
    try {
      const response = await getNoteHistory({
        data: { agentId: initial.agentId, before },
      });
      if (response.ok) {
        setHasMoreHistory(response.value.length === 100);
        setHistory((old) =>
          before ? [...(old ?? []), ...response.value] : response.value,
        );
      } else setError(response.error);
    } catch {
      setError("Could not load history. Reconnect and try again.");
    } finally {
      historyBusy.current = false;
    }
  }

  async function previewRevision(revision: number) {
    try {
      const response = await getNoteRevision({
        data: { agentId: initial.agentId, revision },
      });
      if (response.ok) setPreview(response.value);
      else setError(response.error);
    } catch {
      setError("Could not load this revision. Reconnect and try again.");
    }
  }

  async function restorePreview() {
    if (!preview || busy.current || dirty || conflict || recovery) return;
    busy.current = true;
    setStatus("Restoring…");
    try {
      const response = await restoreNoteRevision({
        data: {
          agentId: initial.agentId,
          requestId: crypto.randomUUID(),
          revision: base.revision,
          targetRevision: preview.revision,
        },
      });
      if (response.ok) {
        const latest = current.current;
        if (
          !same(latest.blocks, base.blocks) ||
          latest.instructions !== base.instructions
        ) {
          setConflict(response.value);
          setStatus("Restored on server · resolve your newer edits");
        } else load(response.value);
        setPreview(null);
        await showHistory();
      } else {
        setError(response.error);
        setStatus("Restore failed");
      }
    } catch {
      setError("Could not confirm restore. Reload history before retrying.");
      setStatus("Restore not confirmed");
    } finally {
      busy.current = false;
    }
  }

  return (
    <div {...stylex.props(styles.scroll)}>
      <article {...stylex.props(styles.paper)}>
        <div {...stylex.props(styles.eyebrow)}>SHARED WITH YOUR AGENT</div>
        <div {...stylex.props(styles.titleRow)}>
          <h2 {...stylex.props(styles.title)}>Note</h2>
          <NoteButton
            type="button"
            xstyle={styles.subtle}
            onClick={() => (history ? setHistory(null) : void showHistory())}
            aria-expanded={history !== null}
          >
            History
          </NoteButton>
        </div>
        <p {...stylex.props(styles.subtitle)}>
          A lasting place for plans, details, and things to remember together.
        </p>
        <div role="status" aria-live="polite" {...stylex.props(styles.status)}>
          {!online
            ? "Offline · draft kept on this device"
            : dirty && status === "Saved"
              ? "Unsaved changes"
              : status}
        </div>
        {recovery && (
          <div {...stylex.props(styles.notice)}>
            <strong>Recover your unsaved draft</strong>
            <p>A previous editing session left changes on this device.</p>
            <NoteButton type="button" onClick={() => merge(base, recovery)}>
              Recover draft
            </NoteButton>{" "}
            <NoteButton type="button" onClick={downloadDraft}>
              Download draft
            </NoteButton>{" "}
            <NoteButton type="button" onClick={() => load(base)}>
              Discard draft
            </NoteButton>
          </div>
        )}
        {conflict && (
          <div {...stylex.props(styles.notice)}>
            <strong>The note changed elsewhere</strong>
            <p>
              Your edits are safe here. Merge changes to different blocks, or
              download your draft before reloading.
            </p>
            <NoteButton
              type="button"
              onClick={() => merge(conflict, { base, blocks, instructions })}
            >
              Merge changes
            </NoteButton>{" "}
            <NoteButton type="button" onClick={downloadDraft}>
              Download draft
            </NoteButton>{" "}
            <NoteButton type="button" onClick={() => load(conflict)}>
              Reload saved note
            </NoteButton>
          </div>
        )}
        {storageWarning && (
          <p role="status" {...stylex.props(styles.notice)}>
            {storageWarning}
          </p>
        )}
        {error && (
          <div role="alert" {...stylex.props(styles.notice)}>
            {error}{" "}
            {!conflict && (
              <NoteButton
                type="button"
                onClick={() => {
                  setError("");
                  void save();
                }}
              >
                Retry
              </NoteButton>
            )}
          </div>
        )}
        {history && (
          <aside {...stylex.props(styles.notice)} aria-label="Note history">
            <strong>Revision history</strong>
            {history.length ? (
              history.map((revision) => (
                <div key={revision.revision}>
                  <NoteButton
                    type="button"
                    xstyle={styles.subtle}
                    onClick={() => void previewRevision(revision.revision)}
                  >
                    Revision {revision.revision} ·{" "}
                    {revision.source.startsWith("agent:")
                      ? "Agent"
                      : revision.source}{" "}
                    ·{" "}
                    {revision.updatedAt
                      ? new Date(revision.updatedAt).toLocaleString()
                      : "Empty note"}
                  </NoteButton>
                </div>
              ))
            ) : (
              <p>No saved revisions yet.</p>
            )}
            {hasMoreHistory && (
              <NoteButton
                type="button"
                onClick={() => void showHistory(history.at(-1)!.revision)}
              >
                Load older revisions
              </NoteButton>
            )}
            {preview && (
              <div>
                <h3>Revision {preview.revision}</h3>
                <NotePreview blocks={preview.blocks} />
                <NoteButton
                  type="button"
                  disabled={dirty || busy.current || !!conflict || !!recovery}
                  onClick={() => void restorePreview()}
                >
                  Restore this content
                </NoteButton>{" "}
                <NoteButton type="button" onClick={() => setPreview(null)}>
                  Close preview
                </NoteButton>
                <p>
                  Restoring creates a new revision and keeps current maintenance
                  instructions. Save or resolve your draft first.
                </p>
              </div>
            )}
          </aside>
        )}
        {recovery ? (
          <NotePreview blocks={base.blocks} />
        ) : (
          <NoteEditor
            key={version}
            blocks={blocks}
            onChange={(value) => {
              setBlocks(value);
              setStatus("Unsaved changes");
              setError("");
            }}
            onFocusChange={(value) => {
              focused.current = value;
            }}
            onError={(message) => {
              setError(message);
              setStatus("Not saved");
            }}
          />
        )}

        <details {...stylex.props(styles.instructions)}>
          <summary {...stylex.props(styles.summary)}>
            Maintenance instructions{" "}
            <span {...stylex.props(styles.optional)}>Optional</span>
          </summary>
          <p {...stylex.props(styles.description)}>
            Tell your agent how to keep this note useful. These instructions
            apply only to note maintenance and never authorize external actions.
          </p>
          <label
            htmlFor="note-instructions"
            {...stylex.props(styles.description)}
          >
            How should your agent maintain this note?
          </label>
          <textarea
            id="note-instructions"
            disabled={!!recovery}
            maxLength={8000}
            rows={4}
            value={instructions}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
            }}
            onChange={(event) => {
              setInstructions(event.target.value);
              setError("");
              setStatus("Unsaved changes");
            }}
            placeholder="For example: keep the next steps current and preserve my personal notes."
            {...stylex.props(styles.textarea)}
          />
          <p {...stylex.props(styles.description)}>
            Saved separately from the note ·{" "}
            {instructions.length.toLocaleString()} / 8,000
          </p>
        </details>
      </article>
    </div>
  );
}

const styles = stylex.create({
  scroll: {
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
    overscrollBehavior: "contain",
  },
  paper: {
    width: "100%",
    maxWidth: 800,
    marginInline: "auto",
    paddingInline: { default: 48, "@media (max-width: 700px)": 22 },
    paddingTop: { default: 54, "@media (max-width: 700px)": 28 },
    paddingBottom: 80,
  },
  eyebrow: {
    color: noteColors.secondary,
    fontSize: 10,
    letterSpacing: "0.1em",
    fontWeight: 600,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10,
  },
  title: {
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: "-0.04em",
    margin: 0,
    color: colors.foreground,
  },
  subtitle: {
    color: noteColors.secondary,
    fontSize: 13,
    lineHeight: 1.6,
    marginTop: 8,
    marginBottom: 12,
  },
  subtle: {
    color: colors.foreground,
    backgroundColor: { default: "transparent", ":hover": colors.selected },
    borderWidth: 0,
    borderRadius: 6,
    minHeight: 36,
    paddingInline: 10,
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
  },
  status: { fontSize: 11, color: noteColors.secondary, minHeight: 25 },
  notice: {
    padding: 14,
    marginBlock: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    fontSize: 13,
    lineHeight: 1.6,
    overflowWrap: "anywhere",
  },
  instructions: {
    marginTop: 32,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    paddingTop: 20,
  },
  summary: {
    cursor: "pointer",
    fontSize: 13,
    color: colors.foreground,
    paddingBlock: 8,
  },
  optional: { marginLeft: 8, fontSize: 11, color: noteColors.secondary },
  description: { color: noteColors.secondary, fontSize: 12, lineHeight: 1.6 },
  textarea: {
    display: "block",
    width: "100%",
    padding: 12,
    marginTop: 8,
    resize: "vertical",
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 1.6,
  },
});

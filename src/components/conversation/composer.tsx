import * as stylex from "@stylexjs/stylex";
import {
  type ClipboardEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type FileAttachment,
  formatFileSize,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
} from "../../features/chat/files";
import { usePreferences } from "../../features/settings/preferences";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";
import { Icon } from "../ui/primitives";

export function Composer({
  agentId,
  agentName,
  busy,
  loading = false,
  status,
  onSend,
  onStop,
}: {
  agentId: string;
  agentName: string;
  busy: boolean;
  loading?: boolean;
  status?: string;
  onSend: (text: string, files: readonly FileAttachment[]) => Promise<boolean>;
  onStop: () => void;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;

    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };

    resize();
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text]);
  const { responseStyle } = usePreferences();

  function keepInputFocus(event: MouseEvent<HTMLButtonElement>) {
    // Blurring before click dismisses the iOS keyboard and moves the button
    // away from the tap. Keep focus; the native click still submits the form.
    if (event.button === 0 && document.activeElement === input.current)
      event.preventDefault();
  }

  async function attach(selected: FileList | readonly File[] | null) {
    if (!selected?.length) return;
    if (loading || busy || uploading) {
      setUploadError(
        uploading
          ? "Wait for the current upload to finish, then paste or attach again."
          : "Wait for the current response to finish before attaching files.",
      );
      return;
    }
    const incoming = Array.from(selected);
    if (files.length + incoming.length > MAX_ATTACHMENTS) {
      setUploadError("Attach up to five files per message.");
      return;
    }
    if (incoming.some((file) => file.size > MAX_FILE_BYTES)) {
      setUploadError("Files must be 20 MB or smaller.");
      return;
    }
    setUploading(true);
    setUploadError(undefined);
    try {
      for (const file of incoming) {
        const form = new FormData();
        form.set("agentId", agentId);
        form.set("file", file);
        const response = await fetch("/api/files", {
          method: "POST",
          body: form,
        });
        if (!response.ok)
          throw new Error("Could not upload this file. Try again.");
        const saved = (await response.json()) as FileAttachment;
        setFiles((current) => [...current, saved]);
      }
    } catch {
      setUploadError(
        "Could not upload this file. Check your connection and try again.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!images.length) return;
    // Let the browser insert any accompanying text at the current selection.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    void attach(images);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || busy || uploading || (!text.trim() && !files.length)) return;
    const submittedText = text;
    const submittedIds = new Set(files.map((file) => file.id));
    if (await onSend(text.trim(), files)) {
      setText((current) => (current === submittedText ? "" : current));
      setFiles((current) =>
        current.filter((file) => !submittedIds.has(file.id)),
      );
      setUploadError(undefined);
    }
  }

  return (
    <form onSubmit={submit} {...stylex.props(styles.composerArea)}>
      {busy && responseStyle === "codex" && (
        <div role="status" {...stylex.props(styles.progress)}>
          <span {...stylex.props(styles.progressDot)} />
          <span>{`${status ?? "Replying"}…`}</span>
        </div>
      )}
      {files.length > 0 && (
        <ul aria-label="Attached files" {...stylex.props(styles.attachments)}>
          {files.map((file) => (
            <li key={file.id} {...stylex.props(styles.attachment)}>
              <span {...stylex.props(styles.filename)}>{file.name}</span>
              <span>{formatFileSize(file.size)}</span>
              <Button
                type="button"
                disabled={busy || !hydrated}
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((current) =>
                    current.filter((item) => item.id !== file.id),
                  )
                }
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {uploading && (
        <p role="status" {...stylex.props(styles.uploadStatus)}>
          Uploading…
        </p>
      )}
      {uploadError && (
        <p role="alert" {...stylex.props(styles.uploadError)}>
          {uploadError}
        </p>
      )}
      <div {...stylex.props(styles.composer)}>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => void attach(event.target.files)}
        />
        <Button
          type="button"
          aria-label="Attach files"
          title="Attach files (up to 20 MB each)"
          disabled={
            !hydrated ||
            loading ||
            busy ||
            uploading ||
            files.length >= MAX_ATTACHMENTS
          }
          onClick={() => fileInput.current?.click()}
          xstyle={styles.attachButton}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a1 1 0 0 1 1.5 1.5l-9 9a3 3 0 0 0 4 4l8-8a1 1 0 0 0-1.5-1.5l-6 6" />
          </svg>
        </Button>
        <textarea
          ref={input}
          aria-label={`Message ${agentName}`}
          placeholder={`Message ${agentName}…`}
          value={text}
          disabled={!hydrated}
          onChange={(event) => setText(event.target.value)}
          onPaste={paste}
          maxLength={32000}
          rows={1}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          {...stylex.props(styles.input)}
        />
        {busy ? (
          <Button
            key="stop"
            type="button"
            onMouseDown={keepInputFocus}
            onClick={onStop}
            disabled={!hydrated}
            aria-label="Stop response"
            xstyle={styles.send}
          >
            <span aria-hidden="true" {...stylex.props(styles.stopIcon)} />
          </Button>
        ) : (
          <Button
            key="send"
            type="submit"
            onMouseDown={keepInputFocus}
            disabled={
              !hydrated ||
              loading ||
              uploading ||
              (!text.trim() && !files.length)
            }
            aria-label="Send message"
            xstyle={styles.send}
          >
            <Icon name="up" size={16} />
          </Button>
        )}
      </div>
    </form>
  );
}

const styles = stylex.create({
  attachments: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  attachment: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingLeft: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    fontSize: 11,
    color: colors.muted,
  },
  filename: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 220,
    color: colors.foreground,
  },
  uploadStatus: {
    margin: 0,
    marginBottom: 6,
    fontSize: 11,
    color: colors.muted,
  },
  uploadError: {
    margin: 0,
    marginBottom: 6,
    fontSize: 12,
    color: colors.review,
  },
  attachButton: {
    flexShrink: 0,
    padding: 0,
    width: { default: 28, "@media (max-width: 700px)": 36 },
    height: { default: 28, "@media (max-width: 700px)": 44 },
    borderWidth: 0,
  },
  composerArea: {
    marginTop: "auto",
    flexShrink: 0,
    paddingTop: { default: 20, "@media (max-width: 700px)": 8 },
    paddingInline: { default: 0, "@media (max-width: 700px)": 12 },
    paddingBottom: {
      default: 0,
      "@media (max-width: 700px)":
        "max(12px, var(--roost-bottom-inset, env(safe-area-inset-bottom)))",
    },
  },
  progress: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: colors.muted,
    fontSize: 10,
    marginBottom: 10,
  },
  progressDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    backgroundColor: colors.accent,
  },
  stopIcon: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "currentColor",
  },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.border, ":focus-within": colors.accent },
    borderRadius: 14,
    padding: 10,
    boxShadow: "0 2px 8px #00000003",
  },
  input: {
    display: "block",
    resize: "none",
    width: "100%",
    minWidth: 0,
    minHeight: { default: 28, "@media (max-width: 700px)": 44 },
    maxHeight: {
      default: "calc(3lh + 10px)",
      "@media (max-width: 700px)": "calc(3lh + 20px)",
    },
    margin: 0,
    overflowY: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
    backgroundColor: "transparent",
    color: colors.foreground,
    borderWidth: 0,
    outline: "none",
    paddingInline: 3,
    paddingBlock: { default: 5, "@media (max-width: 700px)": 10 },
    fontSize: { default: 12, "@media (max-width: 700px)": 16 },
    lineHeight: 1.5,
    "::placeholder": { color: colors.muted },
  },
  send: {
    display: "grid",
    placeItems: "center",
    marginLeft: "auto",
    width: { default: 28, "@media (max-width: 700px)": 44 },
    height: { default: 28, "@media (max-width: 700px)": 44 },
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: "50%",
    backgroundColor: colors.action,
    color: colors.onAccent,
  },
});

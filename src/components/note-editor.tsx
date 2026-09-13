import * as stylex from "@stylexjs/stylex";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import UniqueID from "@tiptap/extension-unique-id";
import {
  type Editor,
  EditorContent,
  Extension,
  useEditor,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import {
  fromEditor,
  sanitizeNotePaste,
  toEditor,
} from "../features/notes/editor-content";
import { type NoteSnapshot, safeNoteUrl } from "../features/notes/schema";
import { noteColors } from "../styles/notes.stylex";
import { colors } from "../styles/tokens.stylex";
import { NoteButton } from "./note-button";
import "./note-editor.css";
import { NotePreview } from "./note-preview";

const FlatLists = Extension.create({
  name: "flatLists",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () =>
        this.editor.isActive("listItem") || this.editor.isActive("taskItem"),
      "Shift-Tab": () =>
        this.editor.isActive("listItem") || this.editor.isActive("taskItem"),
    };
  },
});

function matchesCommand(label: string, query: string) {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases =
    label === "To-do list" ? " todo task checkbox checklist " : "";
  return normalize(label + aliases).includes(normalize(query));
}

const commands = [
  "Text",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Bullet list",
  "Numbered list",
  "To-do list",
];
function apply(editor: Editor, index: number) {
  const chain = editor.chain().focus();
  if (index === 0) chain.clearNodes().setParagraph().run();
  else if (index < 4)
    chain
      .clearNodes()
      .setHeading({ level: index as 1 | 2 | 3 })
      .run();
  else if (index === 4) chain.toggleBulletList().run();
  else if (index === 5) chain.toggleOrderedList().run();
  else chain.toggleTaskList().run();
}

export function NoteEditor({
  blocks,
  onChange,
  onFocusChange,
  onError,
}: {
  blocks: NoteSnapshot["blocks"];
  onChange: (blocks: NoteSnapshot["blocks"]) => void;
  onFocusChange: (focused: boolean) => void;
  onError: (message: string) => void;
}) {
  const [slash, setSlash] = useState<{
    from: number;
    to: number;
    query: string;
  } | null>(null);
  const [selected, setSelected] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const indexRef = useRef(selected);
  indexRef.current = selected;
  const filtered = commands
    .map((label, index) => ({ label, index }))
    .filter((c) => matchesCommand(c.label, slash?.query ?? ""));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      FlatLists,
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          isAllowedUri: safeNoteUrl,
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: false,
        a11y: {
          checkboxLabel: (node) =>
            `Mark ${node.textContent || "task"} complete`,
        },
      }),
      UniqueID.configure({ types: ["paragraph", "heading"] }),
      Placeholder.configure({
        placeholder: "Write something, or type / for blocks…",
      }),
    ],
    content: toEditor(blocks),
    editorProps: {
      transformPastedHTML: sanitizeNotePaste,
      attributes: {
        class: "shared-note-prose",
        role: "textbox",
        "aria-label": "Shared note",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleKeyDown: (view, event) => {
        if (
          event.altKey &&
          event.key === "F10" &&
          !view.state.selection.empty
        ) {
          event.preventDefault();
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>("button")
            ?.focus();
          return true;
        }
        const menu = slashRef.current;
        if (!menu) return false;
        const choices = commands
          .map((label, index) => ({ label, index }))
          .filter((c) => matchesCommand(c.label, menu.query));
        if (event.key === "Escape") {
          setSlash(null);
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          setSelected(
            (value) =>
              (value +
                (event.key === "ArrowDown" ? 1 : -1) +
                Math.max(choices.length, 1)) %
              Math.max(choices.length, 1),
          );
          return true;
        }
        if (event.key === "Enter" && choices.length) {
          view.dispatch(view.state.tr.delete(menu.from, menu.to));
          // Editor is initialized before keyboard events can fire.
          if (editor)
            apply(editor, choices[indexRef.current % choices.length]!.index);
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      try {
        onChange(fromEditor(current.getJSON()));
      } catch {
        onError(
          "This note exceeds the content limits. Undo your last change to continue saving.",
        );
      }
      const { $from, empty } = current.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, "\n");
      const match = /^\/([\w -]*)$/.exec(text);
      setSlash(
        empty && match
          ? { from: $from.start(), to: $from.pos, query: match[1]! }
          : null,
      );
      setSelected(0);
    },
    onSelectionUpdate: () => setLinkOpen(false),
    onFocus: () => onFocusChange(true),
    onBlur: () => onFocusChange(false),
  });
  useEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  useEffect(() => {
    if (!editor || !slash) return;
    const place = () => {
      const coordinates = editor.view.coordsAtPos(
        Math.min(slash.to, editor.state.doc.content.size),
      );
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      setMenuPosition({
        left: Math.max(8, Math.min(coordinates.left, width - 266)),
        top: Math.max(8, Math.min(coordinates.bottom + 6, height - 320)),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [editor, slash]);
  if (!editor)
    return (
      <div {...stylex.props(styles.loading)}>
        <NotePreview blocks={blocks} />
        <p>Loading editor…</p>
      </div>
    );
  return (
    <div {...stylex.props(styles.container)}>
      <BubbleMenu
        editor={editor}
        options={{
          placement: "top",
          offset: 8,
          shift: { padding: 8 },
          flip: true,
          scrollTarget:
            editor.view.dom.closest<HTMLElement>("article")?.parentElement ??
            window,
        }}
        updateDelay={0}
        {...stylex.props(styles.bubble)}
      >
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Selected text formatting"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setLinkOpen(false);
              editor.commands.focus();
              editor.commands.setTextSelection(editor.state.selection.to);
            }
          }}
          {...stylex.props(styles.toolbar)}
        >
          <NoteButton
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
            aria-pressed={editor.isActive("bold")}
            xstyle={[styles.tool, editor.isActive("bold") && styles.highlight]}
          >
            <strong>B</strong>
          </NoteButton>
          <NoteButton
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
            aria-pressed={editor.isActive("italic")}
            xstyle={[
              styles.tool,
              editor.isActive("italic") && styles.highlight,
            ]}
          >
            <em>I</em>
          </NoteButton>
          <NoteButton
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setHref(editor.getAttributes("link").href ?? "");
              setLinkOpen(!linkOpen);
            }}
            aria-expanded={linkOpen}
            xstyle={styles.tool}
          >
            Link
          </NoteButton>
        </div>
        {linkOpen && (
          <form
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            {...stylex.props(styles.linkForm)}
            onSubmit={(event) => {
              event.preventDefault();
              if (href && !safeNoteUrl(href)) {
                setLinkError("Use an https, http, or mailto URL.");
                return;
              }
              if (href)
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href })
                  .run();
              else
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
              setLinkOpen(false);
              setLinkError("");
            }}
          >
            <label>
              Link URL{" "}
              <input
                ref={linkInput}
                value={href}
                onChange={(event) => setHref(event.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <NoteButton type="submit">Apply</NoteButton>
            <NoteButton
              type="button"
              onClick={() => {
                setLinkOpen(false);
                editor.commands.focus();
              }}
            >
              Cancel
            </NoteButton>
            {linkError && <span role="alert">{linkError}</span>}
          </form>
        )}
      </BubbleMenu>
      {slash && (
        <div
          ref={menuRef}
          style={menuPosition}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setSlash(null);
              editor.commands.focus();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const buttons = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button",
                ) ?? [],
              );
              const currentIndex = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (currentIndex +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
              setSelected(next);
            }
          }}
          role="menu"
          aria-label="Insert block"
          {...stylex.props(styles.menu)}
        >
          {filtered.length ? (
            filtered.map((item, index) => (
              <NoteButton
                role="menuitem"
                type="button"
                key={item.index}
                xstyle={[
                  styles.menuItem,
                  index === selected && styles.highlight,
                ]}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: slash.from, to: slash.to })
                    .run();
                  apply(editor, item.index);
                  setSlash(null);
                }}
              >
                {item.label}
                <span {...stylex.props(styles.hint)}>
                  {["", "#", "##", "###", "-", "1.", "[]"][item.index]}
                </span>
              </NoteButton>
            ))
          ) : (
            <p>No matching blocks</p>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      <div {...stylex.props(styles.footer)}>
        <details ref={actionsRef} {...stylex.props(styles.actions)}>
          <summary
            aria-label="Editing actions"
            {...stylex.props(styles.actionsToggle)}
          >
            •••
          </summary>
          <div {...stylex.props(styles.actionMenu)}>
            <NoteButton
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              xstyle={styles.tool}
            >
              Undo
            </NoteButton>
            <NoteButton
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              xstyle={styles.tool}
            >
              Redo
            </NoteButton>
            <NoteButton
              type="button"
              aria-expanded={!!slash}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSlash(
                  slash
                    ? null
                    : {
                        from: editor.state.selection.from,
                        to: editor.state.selection.from,
                        query: "",
                      },
                );
                setSelected(0);
                if (actionsRef.current) actionsRef.current.open = false;
              }}
              xstyle={styles.tool}
            >
              + Block
            </NoteButton>
          </div>
        </details>
      </div>
    </div>
  );
}

const styles = stylex.create({
  container: { position: "relative", minWidth: 0, color: colors.foreground },
  loading: { padding: 24, color: noteColors.secondary },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
    paddingBlock: 0,
    backgroundColor: colors.background,
  },
  tool: {
    backgroundColor: { default: "transparent", ":hover": colors.selected },
    color: colors.foreground,
    borderWidth: 0,
    borderRadius: 5,
    paddingInline: 10,
    minHeight: { default: 32, "@media (max-width: 700px)": 44 },
    fontSize: 12,
    cursor: "pointer",
    opacity: { default: 1, ":disabled": 0.45 },
  },
  bubble: {
    zIndex: 5,
    maxWidth: "calc(100vw - 32px)",
    padding: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    boxShadow: "0 4px 16px #0002",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  actions: { position: "relative" },
  actionsToggle: {
    listStyle: "none",
    cursor: "pointer",
    color: noteColors.secondary,
    minWidth: 44,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  actionMenu: {
    position: "absolute",
    bottom: "100%",
    right: 0,
    display: "flex",
    zIndex: 3,
    padding: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    boxShadow: "0 4px 16px #0002",
    whiteSpace: "nowrap",
  },
  menu: {
    position: "fixed",
    maxHeight: "min(310px, 70dvh)",
    overflowY: "auto",
    zIndex: 3,
    width: 250,
    maxWidth: "100%",
    padding: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    boxShadow: "0 8px 30px #0002",
  },
  menuItem: {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    minHeight: { default: 36, "@media (max-width: 700px)": 44 },
    padding: 10,
    borderWidth: 0,
    borderRadius: 5,
    color: colors.foreground,
    backgroundColor: { default: "transparent", ":hover": colors.selected },
    textAlign: "left",
    cursor: "pointer",
  },
  highlight: { backgroundColor: colors.selected },
  hint: { color: noteColors.secondary },
  linkForm: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    padding: 8,
    fontSize: 13,
  },
});

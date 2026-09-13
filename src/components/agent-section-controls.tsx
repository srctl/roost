import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type {
  AgentNavigation,
  NavigationChange,
} from "../features/agents/navigation-schema";
import {
  orderedSections,
  placeSection,
} from "../features/agents/navigation-state";
import type { Agent } from "../features/agents/schema";
import { useOpenAfterMount } from "../features/motion";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { DisplayNameEditor, nameEditorStyles } from "./display-name-editor";
import { Button } from "./ui/button";
import { Avatar, Icon } from "./ui/primitives";

export function AgentSectionControls({
  navigation,
  agents,
  save,
  busy,
  error,
  onClose,
}: {
  navigation: AgentNavigation;
  agents: readonly Agent[];
  save: (change: NavigationChange) => Promise<void>;
  busy: boolean;
  error: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const shown = useOpenAfterMount(open);
  const [editing, setEditing] = useState<{
    kind: "create" | "rename";
    id: string;
  }>();
  const [deleting, setDeleting] = useState<string>();
  const groups = orderedSections(navigation);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    edge: "before" | "after";
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLElement>(null);
  const pointer = useRef<{
    id: string;
    startY: number;
    active: boolean;
  } | null>(null);
  const [dragY, setDragY] = useState(0);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const previewGroups =
    dragged !== null && dropTarget
      ? orderedSections(
          placeSection(
            navigation,
            dragged || null,
            dropTarget.id || null,
            dropTarget.edge,
          ),
        )
      : groups;
  const offsets = new Map<string, number>();
  let nextTop = 0;
  for (const group of previewGroups) {
    offsets.set(group.id, nextTop);
    nextTop += rowHeights[group.id] ?? 0;
  }
  let originalTop = 0;
  for (const group of groups) {
    offsets.set(group.id, (offsets.get(group.id) ?? 0) - originalTop);
    originalTop += rowHeights[group.id] ?? 0;
  }
  function endDrag() {
    const positions = pointer.current?.active
      ? Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[data-section-id]") ??
            [],
        ).map((row) => ({ row, top: row.getBoundingClientRect().top }))
      : [];
    pointer.current = null;
    setDragged(null);
    setDropTarget(null);
    setDragY(0);
    if (
      positions.length &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      requestAnimationFrame(() => {
        for (const { row, top } of positions) {
          if (!row.isConnected) continue;
          const distance = top - row.getBoundingClientRect().top;
          if (Math.abs(distance) < 0.5) continue;
          row.animate(
            [
              { transform: `translateY(${distance}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
      });
  }
  function targetAt(clientY: number, sourceId: string) {
    if (busy || editing) return null;
    // Hit-test stationary slots, not the sliding rows, so crossing a midpoint
    // does not reverse the preview when that row moves under the pointer.
    const slots = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-section-slot]") ??
        [],
    ).filter((slot) => slot.dataset.sectionSlot !== sourceId);
    const before = slots.find((slot) => {
      const bounds = slot.getBoundingClientRect();
      return clientY < bounds.top + bounds.height / 2;
    });
    const target = before ?? slots.at(-1);
    if (!target) return null;
    return {
      id: target.dataset.sectionSlot!,
      edge: before ? ("before" as const) : ("after" as const),
    };
  }
  return (
    <Dialog.Root
      open={shown}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.dialog)}>
          <header {...stylex.props(styles.header)}>
            <div>
              <Dialog.Title {...stylex.props(styles.title)}>
                Sections
              </Dialog.Title>
              <Dialog.Description {...stylex.props(styles.help)}>
                Organize agents in the sidebar. Changes apply to everyone.
              </Dialog.Description>
            </div>
            <Dialog.Close render={<Button />} aria-label="Close sections">
              <Icon name="close" />
            </Dialog.Close>
          </header>
          <div {...stylex.props(styles.body)}>
            <span role="status" {...stylex.props(styles.srOnly)}>
              {announcement}
            </span>
            {error && (
              <p role="alert" {...stylex.props(styles.help)}>
                {error}
              </p>
            )}
            <div {...stylex.props(styles.sectionHeader)}>
              <h3 {...stylex.props(styles.label)}>Your sections</h3>
              <Button
                disabled={busy || !!editing}
                onClick={() =>
                  setEditing({ kind: "create", id: crypto.randomUUID() })
                }
              >
                <Icon name="plus" size={14} /> New section
              </Button>
            </div>
            {navigation.sections.length === 0 && !editing && (
              <p {...stylex.props(styles.empty)}>
                Create a section, then choose which agents belong in it.
              </p>
            )}
            <section
              ref={listRef}
              aria-label="Reorder sections"
              {...stylex.props(styles.sectionList)}
            >
              {groups.map((section, index) => {
                const count = agents.filter(
                  (agent) =>
                    (navigation.memberships[agent.id] ?? "") === section.id,
                ).length;
                return (
                  <div key={section.id} data-section-slot={section.id}>
                    <section
                      aria-label={`${section.name} section`}
                      data-section-id={section.id || "ungrouped"}
                      {...stylex.props(
                        styles.section,
                        dragged !== null &&
                          dragged !== section.id &&
                          styles.sliding,
                        dragged !== null &&
                          styles.offset(
                            dragged === section.id
                              ? dragY
                              : (offsets.get(section.id) ?? 0),
                          ),
                        dragged === section.id && styles.dragging,
                      )}
                    >
                      {editing?.kind === "rename" &&
                      editing.id === section.id ? (
                        <DisplayNameEditor
                          focusOnMount
                          name={section.name}
                          label="Section name"
                          onCancel={() => setEditing(undefined)}
                          onSave={async (name) => {
                            await save({
                              action: "rename",
                              id: section.id,
                              name,
                            });
                            setEditing(undefined);
                          }}
                        />
                      ) : (
                        <div {...stylex.props(styles.row)}>
                          <Button
                            aria-label={`Reorder ${section.name}`}
                            title="Drag to reorder. Alt + arrow keys to move."
                            disabled={busy || !!editing || groups.length < 2}
                            xstyle={styles.dragHandle}
                            onPointerDown={(event) => {
                              if (event.button !== 0 || busy || editing) return;
                              for (const row of listRef.current?.querySelectorAll<HTMLElement>(
                                "[data-section-id]",
                              ) ?? [])
                                for (const animation of row.getAnimations())
                                  animation.cancel();
                              pointer.current = {
                                id: section.id,
                                startY: event.clientY,
                                active: false,
                              };
                              setRowHeights(
                                Object.fromEntries(
                                  Array.from(
                                    listRef.current?.querySelectorAll<HTMLElement>(
                                      "[data-section-slot]",
                                    ) ?? [],
                                  ).map((slot) => [
                                    slot.dataset.sectionSlot!,
                                    slot.getBoundingClientRect().height,
                                  ]),
                                ),
                              );
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                            }}
                            onPointerMove={(event) => {
                              const current = pointer.current;
                              if (!current) return;
                              const y = event.clientY - current.startY;
                              if (!current.active && Math.abs(y) < 4) return;
                              current.active = true;
                              setDragged(current.id);
                              setDragY(y);
                              const target = targetAt(
                                event.clientY,
                                current.id,
                              );
                              setDropTarget((previous) =>
                                previous?.id === target?.id &&
                                previous?.edge === target?.edge
                                  ? previous
                                  : target,
                              );
                            }}
                            onPointerUp={(event) => {
                              const current = pointer.current;
                              if (current?.active) {
                                const target = targetAt(
                                  event.clientY,
                                  current.id,
                                );
                                const bounds =
                                  listRef.current?.getBoundingClientRect();
                                if (
                                  target &&
                                  bounds &&
                                  event.clientX >= bounds.left &&
                                  event.clientX <= bounds.right &&
                                  event.clientY >= bounds.top &&
                                  event.clientY <= bounds.bottom
                                ) {
                                  void save({
                                    action: "place-section",
                                    id: current.id || null,
                                    targetId: target.id || null,
                                    edge: target.edge,
                                  })
                                    .then(() =>
                                      setAnnouncement(`Moved ${section.name}.`),
                                    )
                                    .catch(() =>
                                      setAnnouncement(
                                        `Could not move ${section.name}.`,
                                      ),
                                    );
                                }
                              }
                              endDrag();
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            }}
                            onPointerCancel={endDrag}
                            onLostPointerCapture={endDrag}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" && pointer.current) {
                                event.preventDefault();
                                event.stopPropagation();
                                endDrag();
                                return;
                              }
                              if (
                                !event.altKey ||
                                (event.key !== "ArrowUp" &&
                                  event.key !== "ArrowDown")
                              )
                                return;
                              event.preventDefault();
                              void save({
                                action: "reorder-section",
                                id: section.id || null,
                                direction:
                                  event.key === "ArrowUp" ? "up" : "down",
                              }).catch(() => {});
                            }}
                          >
                            <Icon name="grip" size={18} />
                          </Button>
                          <span {...stylex.props(styles.name)}>
                            {section.name}
                          </span>
                          <span {...stylex.props(styles.count)}>{count}</span>
                          <select
                            aria-label={`Actions for ${section.name}`}
                            value=""
                            disabled={
                              busy ||
                              !!editing ||
                              (!section.id && groups.length === 1)
                            }
                            onChange={(event) => {
                              const action = event.target.value;
                              if (action === "up" || action === "down") {
                                void save({
                                  action: "reorder-section",
                                  id: section.id || null,
                                  direction: action,
                                }).catch(() => {});
                              } else if (action === "rename") {
                                setDeleting(undefined);
                                setEditing({ kind: "rename", id: section.id });
                              } else if (action === "remove") {
                                setDeleting(section.id);
                              }
                            }}
                            {...stylex.props(
                              nameEditorStyles.control,
                              styles.actionSelect,
                            )}
                          >
                            <option value="" disabled>
                              Actions
                            </option>
                            <option value="up" disabled={index === 0}>
                              Move up
                            </option>
                            <option
                              value="down"
                              disabled={index === groups.length - 1}
                            >
                              Move down
                            </option>
                            {section.id && (
                              <option value="rename">Rename</option>
                            )}
                            {section.id && (
                              <option value="remove">Remove</option>
                            )}
                          </select>
                        </div>
                      )}
                      {deleting === section.id && (
                        <div {...stylex.props(styles.confirmation)}>
                          <p {...stylex.props(styles.help)}>
                            Remove “{section.name}”? Its agents will move to
                            Ungrouped.
                          </p>
                          <div {...stylex.props(styles.actions)}>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void save({ action: "delete", id: section.id })
                                  .then(() => setDeleting(undefined))
                                  .catch(() => {})
                              }
                            >
                              Remove section
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => setDeleting(undefined)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                );
              })}
            </section>
            {editing?.kind === "create" && (
              <div {...stylex.props(styles.editor)}>
                <DisplayNameEditor
                  focusOnMount
                  name=""
                  label="Section name"
                  onCancel={() => setEditing(undefined)}
                  onSave={async (name) => {
                    await save({ action: "create", id: editing.id, name });
                    setEditing(undefined);
                  }}
                />
              </div>
            )}
            {agents.length > 0 && (
              <section
                {...stylex.props(styles.agents)}
                aria-label="Agent sections"
              >
                <div {...stylex.props(styles.sectionHeader)}>
                  <h3 {...stylex.props(styles.label)}>Agents</h3>
                  <span {...stylex.props(styles.help)}>Section</span>
                </div>
                {agents.map((agent) => (
                  <label key={agent.id} {...stylex.props(styles.agentRow)}>
                    <Avatar character={agent.character} size={24} />
                    <span {...stylex.props(styles.name)}>{agent.name}</span>
                    <select
                      aria-label={`Section for ${agent.name}`}
                      value={navigation.memberships[agent.id] ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        void save({
                          action: "move",
                          agentId: agent.id,
                          sectionId: event.target.value || null,
                        }).catch(() => {})
                      }
                      {...stylex.props(nameEditorStyles.control, styles.select)}
                    >
                      <option value="">Ungrouped</option>
                      {navigation.sections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </section>
            )}
          </div>
          <footer {...stylex.props(styles.footer)}>
            {busy && (
              <span role="status" {...stylex.props(styles.help)}>
                Saving…
              </span>
            )}
            <Dialog.Close render={<Button xstyle={styles.done} />}>
              Done
            </Dialog.Close>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "#00000060",
    zIndex: 40,
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transitionProperty: "opacity",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
  dialog: {
    position: "fixed",
    top: "50%",
    left: "50%",
    width: "min(480px, calc(100vw - 24px))",
    maxHeight: "calc(100dvh - 48px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: colors.background,
    color: colors.foreground,
    zIndex: 41,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    boxShadow: "0 16px 64px #00000030",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transform: {
      default: "translate(-50%, -50%)",
      ":is([data-starting-style], [data-ending-style])":
        "translate(-50%, calc(-50% + 6px))",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: 20,
    flexShrink: 0,
  },
  title: { margin: 0, marginBottom: 4, fontSize: 18, fontWeight: 500 },
  help: { color: colors.muted, fontSize: 12, margin: 0 },
  body: {
    paddingInline: 20,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 36,
  },
  label: { fontSize: 12, fontWeight: 500, color: colors.muted, margin: 0 },
  empty: { color: colors.muted, fontSize: 13, marginBlock: 12, maxWidth: 290 },
  section: {
    paddingBlock: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  sectionList: { position: "relative" },
  row: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  dragHandle: {
    cursor: { default: "grab", ":active": "grabbing", ":disabled": "default" },
    flexShrink: 0,
    touchAction: "none",
    userSelect: "none",
    opacity: { default: 1, ":disabled": 0.25 },
  },
  sliding: {
    transitionProperty: "transform, opacity",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
    willChange: "transform",
  },
  offset: (y: number) => ({ transform: `translateY(${y}px)` }),
  dragging: {
    position: "relative",
    zIndex: 2,
    backgroundColor: colors.background,
    boxShadow: "0 6px 16px #00000018",
    cursor: "grabbing",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  count: {
    color: colors.muted,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    paddingRight: 8,
  },
  actionSelect: {
    width: "auto",
    minWidth: 104,
    paddingBlock: 5,
    fontSize: { default: 12, "@media (max-width: 700px)": 16 },
    minHeight: { default: 32, "@media (max-width: 700px)": 44 },
  },
  confirmation: { paddingBlock: 10 },
  actions: { display: "flex", gap: 8, marginTop: 8 },
  editor: { paddingBlock: 12 },
  agents: { marginTop: 24, paddingBottom: 8 },
  agentRow: { display: "flex", alignItems: "center", gap: 8, paddingBlock: 8 },
  select: {
    width: "42%",
    paddingBlock: 6,
    paddingInline: 8,
    fontSize: { default: 12, "@media (max-width: 700px)": 16 },
    minHeight: { default: 32, "@media (max-width: 700px)": 44 },
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    padding: 16,
    paddingInline: 20,
    flexShrink: 0,
  },
  done: {
    backgroundColor: colors.selected,
    color: colors.foreground,
    paddingInline: 16,
  },
});

import * as stylex from "@stylexjs/stylex";
import { type RefObject, useEffect, useState } from "react";
import { noteColors } from "../styles/notes.stylex";
import { colors } from "../styles/tokens.stylex";

export function NoteOutline({
  contentRef,
  scrollRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<
    { element: HTMLElement; title: string; level: number }[]
  >([]);
  const [active, setActive] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = hovered || focused || pinned;

  useEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;
    let current: HTMLElement[] = [];
    let frame = 0;
    const updateActive = () => {
      const top = scroll.getBoundingClientRect().top + 32;
      let selected = current[0] ?? null;
      for (const heading of current) {
        if (heading.getBoundingClientRect().top > top) break;
        selected = heading;
      }
      setActive(selected);
    };
    const scheduleActive = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };
    const readHeadings = () => {
      current = Array.from(content.querySelectorAll<HTMLElement>("h1, h2, h3"));
      setHeadings(
        current.map((element) => ({
          element,
          title: element.textContent?.trim() || "Untitled section",
          level: Number(element.tagName.slice(1)),
        })),
      );
      scheduleActive();
    };
    readHeadings();
    const mutations = new MutationObserver(readHeadings);
    mutations.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resize = new ResizeObserver(scheduleActive);
    resize.observe(content);
    resize.observe(scroll);
    scroll.addEventListener("scroll", scheduleActive, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      scroll.removeEventListener("scroll", scheduleActive);
    };
  }, [contentRef, scrollRef]);

  if (!headings.length) return null;
  return (
    <nav
      aria-label="Table of contents"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPinned(false);
          setHovered(false);
          setFocused(false);
          scrollRef.current?.focus({ preventScroll: true });
        }
      }}
      {...stylex.props(styles.outline, expanded && styles.expanded)}
    >
      <button
        type="button"
        aria-label={
          pinned ? "Unpin table of contents" : "Pin table of contents"
        }
        aria-pressed={pinned}
        onClick={() => setPinned(!pinned)}
        {...stylex.props(styles.toggle)}
      >
        <span aria-hidden="true">☰</span>
        {expanded && <span>On this page</span>}
      </button>
      <div
        {...stylex.props(styles.entries, expanded && styles.expandedEntries)}
      >
        {headings.map(({ element, title, level }, index) => (
          <button
            // Headings are read directly from the rendered note, including unsaved edits.
            // biome-ignore lint/suspicious/noArrayIndexKey: These buttons have no per-item state and follow document order.
            key={index}
            type="button"
            aria-label={title}
            aria-current={element === active ? "location" : undefined}
            onClick={() => {
              const scroll = scrollRef.current;
              if (!scroll) return;
              scroll.scrollTo({
                top:
                  scroll.scrollTop +
                  element.getBoundingClientRect().top -
                  scroll.getBoundingClientRect().top -
                  24,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
              });
            }}
            {...stylex.props(styles.entry, element === active && styles.active)}
          >
            <span
              aria-hidden="true"
              {...stylex.props(
                styles.marker,
                element === active && styles.activeMarker,
                level === 2 && styles.levelTwo,
                level === 3 && styles.levelThree,
              )}
            />
            {expanded && <span {...stylex.props(styles.title)}>{title}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

const styles = stylex.create({
  outline: {
    position: "absolute",
    right: 8,
    top: 56,
    zIndex: 4,
    width: 36,
    maxHeight: "calc(100% - 72px)",
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    paddingBlock: 4,
    color: noteColors.secondary,
  },
  expanded: {
    width: "min(280px, calc(100% - 32px))",
    backgroundColor: colors.background,
    boxShadow: "0 4px 24px #0002",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 36,
    flexShrink: 0,
    paddingInline: 10,
    backgroundColor: "transparent",
    color: "inherit",
    borderWidth: 0,
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
  },
  entries: { overflowY: "hidden", minHeight: 0, overscrollBehavior: "contain" },
  expandedEntries: { overflowY: "auto" },
  entry: {
    width: "100%",
    minHeight: { default: 28, "@media (pointer: coarse)": 44 },
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingInline: 8,
    paddingBlock: 6,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: { default: "transparent", ":hover": colors.selected },
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
  },
  active: { color: colors.foreground },
  marker: {
    display: "block",
    width: 20,
    height: 2,
    flexShrink: 0,
    backgroundColor: "currentColor",
    opacity: 0.4,
  },
  activeMarker: { opacity: 1 },
  levelTwo: { width: 14, marginLeft: 6 },
  levelThree: { width: 8, marginLeft: 12 },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

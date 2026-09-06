import type { ReactNode, Ref, UIEventHandler } from "react";
import { ScrollArea as Primitive } from "@base-ui/react/scroll-area";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

// shadcn's Base UI Scroll Area composition, styled with Roost's StyleX tokens.
export function ScrollArea({
  children,
  viewportRef,
  onScroll,
  label,
  bounded = false,
}: {
  children: ReactNode;
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  label: string;
  bounded?: boolean;
}) {
  return (
    <Primitive.Root
      data-slot="scroll-area"
      {...stylex.props(styles.root, bounded && styles.bounded)}
    >
      <Primitive.Viewport
        ref={viewportRef}
        onScroll={onScroll}
        aria-label={label}
        {...stylex.props(styles.viewport)}
      >
        <Primitive.Content {...stylex.props(styles.content)}>
          {children}
        </Primitive.Content>
      </Primitive.Viewport>
      <Primitive.Scrollbar orientation="vertical" {...stylex.props(styles.bar)}>
        <Primitive.Thumb {...stylex.props(styles.thumb)} />
      </Primitive.Scrollbar>
    </Primitive.Root>
  );
}
const styles = stylex.create({
  root: { position: "relative", minHeight: 0, flex: 1, overflow: "hidden" },
  bounded: { maxHeight: 240, flex: "0 1 auto" },
  viewport: {
    height: "100%",
    maxHeight: "inherit",
    width: "100%",
    overscrollBehavior: "contain",
    outlineOffset: -2,
  },
  content: { paddingRight: 18 },
  bar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    display: "flex",
    width: 10,
    padding: 2,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  thumb: {
    width: "100%",
    borderRadius: 10,
    backgroundColor: { default: colors.border, ":hover": colors.muted },
    minHeight: 28,
  },
});

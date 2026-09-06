import type { ReactNode } from "react";
import { Icon } from "../ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

export function Activity({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.activity)}>
      <Icon name="check" size={14} />
      <span>{children}</span>
      <Icon name="chevron-right" size={12} />
    </div>
  );
}
const styles = stylex.create({
  activity: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginTop: 18,
    color: colors.muted,
    fontSize: 11,
  },
});

import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function NoteButton({
  xstyle,
  ...props
}: ComponentProps<typeof Button>) {
  return <Button {...props} xstyle={[styles.button, xstyle]} />;
}

const styles = stylex.create({
  button: {
    color: colors.foreground,
    minHeight: { default: 36, "@media (max-width: 700px)": 44 },
  },
});

import { Input as InputPrimitive } from "@base-ui/react/input";
import * as stylex from "@stylexjs/stylex";
import { motion } from "../../styles/motion.stylex";
import { colors, radii, shadows } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Base UI input; see THIRD_PARTY_NOTICES.md.
export function Input({
  xstyle,
  className: _className,
  style: _style,
  ...props
}: InputPrimitive.Props & { xstyle?: stylex.StyleXStyles }) {
  return (
    <InputPrimitive
      data-slot="input"
      {...props}
      {...stylex.props(inputStyles.input, xstyle)}
    />
  );
}

/* Shared with native inputs, selects, and textareas that cannot use the
   Base UI primitive. */
export const inputStyles = stylex.create({
  input: {
    width: "100%",
    minHeight: 38,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.border, ":focus-visible": colors.accent },
    borderRadius: radii.md,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "inherit",
    fontSize: { default: 13, "@media (max-width: 700px)": 16 },
    lineHeight: 1.5,
    boxShadow: { default: shadows.xs, ":focus-visible": shadows.ring },
    outline: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
    "::placeholder": { color: colors.muted },
  },
});

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import { motion } from "../../styles/motion.stylex";
import { colors } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Base UI button; see THIRD_PARTY_NOTICES.md.
export function Button({
  xstyle,
  className,
  ...props
}: ButtonPrimitive.Props & { xstyle?: stylex.StyleXStyles }) {
  const base = stylex.props(styles.button, xstyle);

  return (
    <ButtonPrimitive
      data-slot="button"
      {...props}
      className={(state) =>
        [
          base.className,
          typeof className === "function" ? className(state) : className,
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}

const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: { default: 28, "@media (max-width: 700px)": 44 },
    minWidth: { default: 0, "@media (max-width: 700px)": 44 },
    gap: 6,
    paddingBlock: 5,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 5,
    // A translucent wash of the text colour reads on every surface and theme.
    backgroundColor: {
      default: "transparent",
      "@media (hover: hover)": {
        ":not(:disabled):hover":
          "color-mix(in srgb, currentColor 9%, transparent)",
      },
    },
    color: {
      default: colors.muted,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.foreground },
    },
    fontSize: 12,
    whiteSpace: "nowrap",
    fontWeight: 400,
    cursor: { default: "pointer", ":disabled": "default" },
    outlineOffset: 3,
    transform: { default: "scale(1)", ":not(:disabled):active": "scale(0.94)" },
    transitionProperty: "background-color, color, transform, opacity",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
});

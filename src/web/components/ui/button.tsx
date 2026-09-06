import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Base UI button; see THIRD_PARTY_NOTICES.md.
// Keep only the default appearance until another variant is needed.
export function Button(props: ButtonPrimitive.Props) {
  return (
    <ButtonPrimitive
      data-slot="button"
      {...stylex.props(styles.button)}
      {...props}
    />
  );
}

const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: colors.accent,
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: 500,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.5 },
    outlineOffset: 3,
  },
});

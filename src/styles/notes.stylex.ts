import * as stylex from "@stylexjs/stylex";
import { colors } from "./tokens.stylex";

// Derive secondary text from the active theme, including user-selected themes.
export const noteColors = stylex.defineVars({
  secondary: `color-mix(in srgb, ${colors.foreground} 75%, ${colors.background})`,
});

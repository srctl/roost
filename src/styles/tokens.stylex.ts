import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  background: {
    default: "#FFFFFF",
    "@media (prefers-color-scheme: dark)": "#20221E",
  },
  sidebar: {
    default: "#F2F2E9",
    "@media (prefers-color-scheme: dark)": "#25281F",
  },
  surface: {
    default: "#FCFCFA",
    "@media (prefers-color-scheme: dark)": "#23251F",
  },
  selected: {
    default: "#E8EBDD",
    "@media (prefers-color-scheme: dark)": "#363D2D",
  },
  bubble: {
    default: "#F3F3EF",
    "@media (prefers-color-scheme: dark)": "#303329",
  },
  foreground: {
    default: "#292A28",
    "@media (prefers-color-scheme: dark)": "#ECEEE8",
  },
  muted: {
    default: "#80817D",
    "@media (prefers-color-scheme: dark)": "#A3A79B",
  },
  faint: {
    default: "#B4B6AB",
    "@media (prefers-color-scheme: dark)": "#737A68",
  },
  border: {
    default: "#E8E8E2",
    "@media (prefers-color-scheme: dark)": "#35392E",
  },
  accent: {
    default: "#657553",
    "@media (prefers-color-scheme: dark)": "#C6D4B4",
  },
  onAccent: {
    default: "#FCFBF7",
    "@media (prefers-color-scheme: dark)": "#20221E",
  },
  action: {
    default: "#30322D",
    "@media (prefers-color-scheme: dark)": "#DCE4CF",
  },
  review: {
    default: "#9C8053",
    "@media (prefers-color-scheme: dark)": "#C8B080",
  },
});

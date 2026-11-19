import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  background: {
    default: "var(--roost-background, #FFFFFF)",
    "@media (prefers-color-scheme: dark)": "var(--roost-background, #20221E)",
  },
  sidebar: {
    default: "var(--roost-sidebar, #F6F6F1)",
    "@media (prefers-color-scheme: dark)": "var(--roost-sidebar, #25281F)",
  },
  surface: {
    default: "var(--roost-surface, #FCFCFA)",
    "@media (prefers-color-scheme: dark)": "var(--roost-surface, #23251F)",
  },
  selected: {
    default: "var(--roost-selected, #E8EBDD)",
    "@media (prefers-color-scheme: dark)": "var(--roost-selected, #363D2D)",
  },
  bubble: {
    default: "var(--roost-bubble, #F3F3EF)",
    "@media (prefers-color-scheme: dark)": "var(--roost-bubble, #303329)",
  },
  foreground: {
    default: "var(--roost-foreground, #292A28)",
    "@media (prefers-color-scheme: dark)": "var(--roost-foreground, #ECEEE8)",
  },
  muted: {
    default: "var(--roost-muted, #80817D)",
    "@media (prefers-color-scheme: dark)": "var(--roost-muted, #A3A79B)",
  },
  faint: {
    default: "var(--roost-faint, #B4B6AB)",
    "@media (prefers-color-scheme: dark)": "var(--roost-faint, #737A68)",
  },
  border: {
    default: "var(--roost-border, #E8E8E2)",
    "@media (prefers-color-scheme: dark)": "var(--roost-border, #35392E)",
  },
  accent: {
    default: "var(--roost-accent, #657553)",
    "@media (prefers-color-scheme: dark)": "var(--roost-accent, #C6D4B4)",
  },
  onAccent: {
    default: "var(--roost-onAccent, #FCFBF7)",
    "@media (prefers-color-scheme: dark)": "var(--roost-onAccent, #20221E)",
  },
  action: {
    default: "var(--roost-action, #30322D)",
    "@media (prefers-color-scheme: dark)": "var(--roost-action, #DCE4CF)",
  },
  review: {
    default: "var(--roost-review, #9C8053)",
    "@media (prefers-color-scheme: dark)": "var(--roost-review, #C8B080)",
  },
});

/* Type, shape, and depth shared by the shadcn-derived components in
   components/ui. Shadows mix the foreground colour so they read in every
   theme without per-palette values. */
export const fonts = stylex.defineVars({
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
});

export const radii = stylex.defineVars({
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
});

export const shadows = stylex.defineVars({
  xs: `0 1px 2px color-mix(in srgb, ${colors.foreground} 6%, transparent)`,
  sm: `0 1px 2px color-mix(in srgb, ${colors.foreground} 5%, transparent), 0 1px 3px color-mix(in srgb, ${colors.foreground} 6%, transparent)`,
  md: `0 2px 4px color-mix(in srgb, ${colors.foreground} 4%, transparent), 0 6px 16px color-mix(in srgb, ${colors.foreground} 7%, transparent)`,
  ring: `0 0 0 3px color-mix(in srgb, ${colors.accent} 22%, transparent)`,
});

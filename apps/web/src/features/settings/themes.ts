// Semantic adaptations of Rosé Pine Dawn/Main, Carbonfox, and Catppuccin Latte/Mocha.
// Sources and adaptation notes: docs/custom-themes.md.
export const themeKey = "roost.theme";
export const themeModes = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof themeModes)[number];
export const themeNames = {
  default: "Default",
  "rose-pine": "Rosé Pine",
  carbonfox: "Carbonfox",
  catppuccin: "Catppuccin",
} as const;
export type ThemeId = keyof typeof themeNames;
export type ThemePreference = { preset: ThemeId; mode: ThemeMode };
export const defaultTheme: ThemePreference = {
  preset: "default",
  mode: "system",
};
export function readThemePreference(
  value: string | undefined,
): ThemePreference {
  const [preset, mode, extra] = (value ?? "").split(":");
  if (
    extra !== undefined ||
    !Object.hasOwn(themeNames, preset ?? "") ||
    !themeModes.includes(mode as ThemeMode)
  )
    return defaultTheme;
  return { preset: preset as ThemeId, mode: mode as ThemeMode };
}
export function serializeTheme(value: ThemePreference) {
  return `${value.preset}:${value.mode}`;
}
export const themePalettes = {
  default: {
    light: {
      background: "#FFFFFF",
      sidebar: "#F2F2E9",
      surface: "#FCFCFA",
      selected: "#E8EBDD",
      bubble: "#F3F3EF",
      foreground: "#292A28",
      muted: "#80817D",
      faint: "#B4B6AB",
      border: "#E8E8E2",
      accent: "#657553",
      onAccent: "#FCFBF7",
      action: "#30322D",
      review: "#9C8053",
    },
    dark: {
      background: "#20221E",
      sidebar: "#25281F",
      surface: "#23251F",
      selected: "#363D2D",
      bubble: "#303329",
      foreground: "#ECEEE8",
      muted: "#A3A79B",
      faint: "#737A68",
      border: "#35392E",
      accent: "#C6D4B4",
      onAccent: "#20221E",
      action: "#DCE4CF",
      review: "#C8B080",
    },
  },
  "rose-pine": {
    light: {
      background: "#faf4ed",
      sidebar: "#f2e9e1",
      surface: "#fffaf3",
      selected: "#dfdad9",
      bubble: "#f2e9e1",
      foreground: "#575279",
      muted: "#625d75",
      faint: "#9893a5",
      border: "#cecacd",
      accent: "#286983",
      onAccent: "#fffaf3",
      action: "#575279",
      review: "#875b16",
    },
    dark: {
      background: "#191724",
      sidebar: "#1f1d2e",
      surface: "#211f32",
      selected: "#403d52",
      bubble: "#26233a",
      foreground: "#e0def4",
      muted: "#b1acc8",
      faint: "#817c9c",
      border: "#524f67",
      accent: "#c4a7e7",
      onAccent: "#191724",
      action: "#9ccfd8",
      review: "#f6c177",
    },
  },
  carbonfox: {
    light: {
      background: "#f2f4f8",
      sidebar: "#e8eaee",
      surface: "#ffffff",
      selected: "#d0e2ff",
      bubble: "#e0e3e8",
      foreground: "#161616",
      muted: "#525253",
      faint: "#747478",
      border: "#c1c4c9",
      accent: "#0043ce",
      onAccent: "#ffffff",
      action: "#161616",
      review: "#705000",
    },
    dark: {
      background: "#161616",
      sidebar: "#101010",
      surface: "#202020",
      selected: "#393939",
      bubble: "#2a2a2a",
      foreground: "#f2f4f8",
      muted: "#b6b8bb",
      faint: "#85878b",
      border: "#525253",
      accent: "#78a9ff",
      onAccent: "#161616",
      action: "#dfdfe0",
      review: "#3ddbd9",
    },
  },
  catppuccin: {
    light: {
      background: "#eff1f5",
      sidebar: "#e6e9ef",
      surface: "#ffffff",
      selected: "#ccd0da",
      bubble: "#dce0e8",
      foreground: "#4c4f69",
      muted: "#55586f",
      faint: "#8c8fa1",
      border: "#bcc0cc",
      accent: "#8839ef",
      onAccent: "#ffffff",
      action: "#4c4f69",
      review: "#805600",
    },
    dark: {
      background: "#1e1e2e",
      sidebar: "#181825",
      surface: "#242436",
      selected: "#45475a",
      bubble: "#313244",
      foreground: "#cdd6f4",
      muted: "#b5bdd8",
      faint: "#7f849c",
      border: "#585b70",
      accent: "#cba6f7",
      onAccent: "#1e1e2e",
      action: "#b4befe",
      review: "#f9e2af",
    },
  },
} as const;
function declarations(
  palette: (typeof themePalettes)[ThemeId]["light" | "dark"],
) {
  return Object.entries(palette)
    .map(([key, value]) => `--roost-${key}:${value};`)
    .join("");
}
// CSS media queries resolve System before first paint and react to OS changes.
export const themeCss = Object.entries(themePalettes)
  .map(([preset, palette]) => {
    const selector = `html[data-theme="${preset}"]`;
    return `${selector}{${declarations(palette.light)}color-scheme:light;}
${selector}[data-theme-mode="dark"]{${declarations(palette.dark)}color-scheme:dark;}
@media(prefers-color-scheme:dark){${selector}[data-theme-mode="system"]{${declarations(palette.dark)}color-scheme:dark;}}`;
  })
  .join("\n");

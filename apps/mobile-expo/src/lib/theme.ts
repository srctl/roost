import { useColorScheme } from "react-native";
// Shared with the SwiftUI app: both read the palette generated from the web
// theme, so the prototype needs no second copy of Roost's colors.
import themes from "../../../ios/Roost/Resources/Themes.json";

export type Palette = {
  background: string;
  sidebar: string;
  surface: string;
  selected: string;
  bubble: string;
  foreground: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  onAccent: string;
  action: string;
  review: string;
  scheme: "light" | "dark";
};

export function usePalette(): Palette {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { ...(themes.default[scheme] as Omit<Palette, "scheme">), scheme };
}

// RoostMotion in the SwiftUI app: spring(duration:bounce:) maps to a
// Reanimated duration spring with dampingRatio = 1 - bounce.
export const motion = {
  send: { duration: 520, dampingRatio: 0.88 },
  settle: { duration: 320, dampingRatio: 0.94 },
  press: { duration: 200, dampingRatio: 0.88 },
};

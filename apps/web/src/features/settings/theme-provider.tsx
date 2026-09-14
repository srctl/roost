import { createContext, type ReactNode, useContext, useState } from "react";
import {
  serializeTheme,
  type ThemePreference,
  themeKey,
  themePalettes,
} from "./themes";

const ThemeContext = createContext<{
  saved: ThemePreference;
  current: ThemePreference;
  preview: (value: ThemePreference | null) => void;
  save: () => boolean;
  error?: string;
} | null>(null);

export function ThemeDocument({
  initial,
  className,
  children,
}: {
  initial: ThemePreference;
  className?: string;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<ThemePreference | null>(null);
  const [error, setError] = useState<string>();
  const current = draft ?? saved;
  function save() {
    try {
      const value = serializeTheme(current);
      // biome-ignore lint/suspicious/noDocumentCookie: Cookies keep the server's first paint consistent with the saved theme.
      document.cookie = `${themeKey}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      if (!document.cookie.split("; ").includes(`${themeKey}=${value}`)) {
        throw new Error("Cookie storage unavailable");
      }
      setSaved(current);
      setDraft(null);
      setError(undefined);
      return true;
    } catch {
      setError(
        "Could not save your theme. Allow cookies and try again, or cancel the preview.",
      );
      return false;
    }
  }
  return (
    <ThemeContext.Provider
      value={{ saved, current, preview: setDraft, save, error }}
    >
      <html
        lang="en"
        className={className}
        data-theme={current.preset}
        data-theme-mode={current.mode}
      >
        {children}
      </html>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeDocument is missing");
  return theme;
}

export function ThemeMeta() {
  const { current } = useTheme();
  const palette = themePalettes[current.preset];
  return (
    <>
      <meta
        name="theme-color"
        content={palette[current.mode === "dark" ? "dark" : "light"].background}
        media="(prefers-color-scheme: light)"
      />
      <meta
        name="theme-color"
        content={
          palette[current.mode === "light" ? "light" : "dark"].background
        }
        media="(prefers-color-scheme: dark)"
      />
    </>
  );
}

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

import { Route } from "../../routes/__root";
import {
  activityDetailsKey,
  type ResponseStyle,
  responseStyleKey,
} from "./display-preferences";

export type { ResponseStyle } from "./display-preferences";

const Preferences = createContext<{
  responseStyle: ResponseStyle;
  setResponseStyle: (style: ResponseStyle) => void;
  showActivityDetails: boolean;
  setShowActivityDetails: (show: boolean) => void;
  error?: string;
} | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const initial = Route.useLoaderData().displayPreferences;
  const [showActivityDetails, setShow] = useState(initial.showActivityDetails);
  const [responseStyle, setStyle] = useState<ResponseStyle>(
    initial.responseStyle,
  );
  const [error, setError] = useState<string>();

  const savePreference = useCallback((storageKey: string, value: string) => {
    try {
      // biome-ignore lint/suspicious/noDocumentCookie: Display preferences must match the initial server render.
      document.cookie = `${storageKey}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      setError(undefined);
    } catch {
      setError(
        "Could not save this preference. It will last until you reload.",
      );
    }
  }, []);

  // Import legacy browser preferences once. Cookies are authoritative on all
  // later requests, so a stale localStorage value cannot change the first paint.
  useLayoutEffect(() => {
    try {
      if (initial.migrateResponseStyle) {
        const style =
          localStorage.getItem(responseStyleKey) === "messages"
            ? "messages"
            : "codex";
        setStyle(style);
        savePreference(responseStyleKey, style);
      }
      if (initial.migrateActivityDetails) {
        const show = localStorage.getItem(activityDetailsKey) === "true";
        setShow(show);
        savePreference(activityDetailsKey, String(show));
      }
    } catch {
      // Keep the server defaults when legacy storage is unavailable.
    }
  }, [
    initial.migrateResponseStyle,
    initial.migrateActivityDetails,
    savePreference,
  ]);

  function setShowActivityDetails(show: boolean) {
    setShow(show);
    savePreference(activityDetailsKey, String(show));
  }

  function setResponseStyle(style: ResponseStyle) {
    setStyle(style);
    savePreference(responseStyleKey, style);
  }

  return (
    <Preferences.Provider
      value={{
        responseStyle,
        setResponseStyle,
        showActivityDetails,
        setShowActivityDetails,
        error,
      }}
    >
      {children}
    </Preferences.Provider>
  );
}

export function usePreferences() {
  const preferences = useContext(Preferences);
  if (!preferences) throw new Error("PreferencesProvider is missing");
  return preferences;
}

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const key = "roost.showActivityDetails";
const responseStyleKey = "roost.responseStyle";

export type ResponseStyle = "messages" | "codex";

const Preferences = createContext<{
  responseStyle: ResponseStyle;
  setResponseStyle: (style: ResponseStyle) => void;
  showActivityDetails: boolean;
  setShowActivityDetails: (show: boolean) => void;
  error?: string;
} | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [showActivityDetails, setShow] = useState(false);
  const [responseStyle, setStyle] = useState<ResponseStyle>("codex");
  const [error, setError] = useState<string>();
  useEffect(() => {
    try {
      const show = localStorage.getItem(key) === "true";
      const style = localStorage.getItem(responseStyleKey);
      setShow(show);
      setStyle(style === "messages" ? "messages" : "codex");
    } catch {
      setError(
        "Browser storage is unavailable. This preference will last until you reload.",
      );
    }
  }, []);

  function setShowActivityDetails(show: boolean) {
    setShow(show);
    savePreference(key, String(show));
  }

  function setResponseStyle(style: ResponseStyle) {
    setStyle(style);
    savePreference(responseStyleKey, style);
  }

  function savePreference(storageKey: string, value: string) {
    try {
      localStorage.setItem(storageKey, value);
      setError(undefined);
    } catch {
      setError(
        "Could not save this preference. It will last until you reload.",
      );
    }
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

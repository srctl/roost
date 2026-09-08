// Isolate the composer from route loaders and server-owned preferences.
export function usePreferences() {
  return { responseStyle: "codex" };
}

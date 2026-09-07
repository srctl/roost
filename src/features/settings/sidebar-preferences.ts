export const sidebarCollapsedKey = "roost.sidebarCollapsed";
export const sidebarWidthKey = "roost.sidebarWidth";
export const sidebarMinWidth = 140;
export const sidebarMaxWidth = 360;
export const sidebarDefaultWidth = 216;

export type SidebarPreferences = { collapsed: boolean; width: number };

export function readSidebarPreferences(
  collapsed: string | undefined,
  width: string | undefined,
): SidebarPreferences {
  const parsedWidth = width && /^\d+$/.test(width) ? Number(width) : NaN;
  return {
    collapsed: collapsed === "true",
    width: Number.isFinite(parsedWidth)
      ? Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, parsedWidth))
      : sidebarDefaultWidth,
  };
}

export function saveSidebarPreference(key: string, value: boolean | number) {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Non-sensitive layout preferences must be available to the next server render.
    document.cookie = `${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // Navigation remains usable if this browser blocks cookies.
  }
}

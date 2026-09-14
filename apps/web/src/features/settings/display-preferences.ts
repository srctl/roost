export const responseStyleKey = "roost.responseStyle";
export const activityDetailsKey = "roost.showActivityDetails";
export type ResponseStyle = "messages" | "codex";

export function readDisplayPreferences(
  responseStyle: string | undefined,
  showActivityDetails: string | undefined,
) {
  return {
    responseStyle: (responseStyle === "messages"
      ? "messages"
      : "codex") as ResponseStyle,
    showActivityDetails: showActivityDetails === "true",
  };
}

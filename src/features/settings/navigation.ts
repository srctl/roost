export const settingsGroups = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Conversation display and dashboards.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Updates and delivery on this device.",
  },
  {
    id: "account",
    label: "Account & security",
    description: "Codex sign-in and access to Roost.",
  },
] as const;

export type SettingsGroup = (typeof settingsGroups)[number]["id"];

export function readSettingsGroup(value: unknown): SettingsGroup {
  return settingsGroups.find((group) => group.id === value)?.id ?? "appearance";
}

// Index the controls and their vocabulary, including options revealed by another
// setting. Keep related controls together so their dependencies remain clear.
export const settingsEntries = [
  {
    id: "conversation",
    group: "appearance",
    terms:
      "Response style Messages Codex conversation chat bubbles preview Show activity details tool inputs outputs calls thinking summaries compact rows browser",
  },
  {
    id: "dashboards",
    group: "appearance",
    terms:
      "Dashboards trackers project updates trends enabled dashboard updates saved content all devices",
  },
  {
    id: "notifications",
    group: "notifications",
    terms:
      "Notifications enabled pause Turn completed summary Agent updates deliveries tracked changes Needs attention work fails approval push This device enable disable permission browser lock screen previews setup",
  },
  {
    id: "account",
    group: "account",
    terms:
      "Codex connection Connect Reconnect sign in login ChatGPT OpenAI account security passkeys signed-in sessions access",
  },
] as const;

export function findSettings(query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return settingsEntries.filter((entry) => {
    const group = settingsGroups.find((group) => group.id === entry.group)!;
    const text =
      `${group.label} ${group.description} ${entry.terms}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

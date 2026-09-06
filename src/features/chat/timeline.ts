import type { Message } from "./schema";
export type Entry = { position: number; message: Message };

export function mergeEntries(
  current: readonly Entry[],
  incoming: readonly Entry[],
) {
  if (!incoming.length) return current;
  const byId = new Map(current.map((entry) => [entry.message.id, entry]));
  for (const entry of incoming) byId.set(entry.message.id, entry);
  return [...byId.values()].sort((a, b) => a.position - b.position);
}

import { Schema } from "effect";

export function safeNoteUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      )
    );
  } catch {
    return false;
  }
}

export const NoteSpan = Schema.Struct({
  text: Schema.String.pipe(Schema.maxLength(20000)),
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  href: Schema.optional(
    Schema.String.pipe(Schema.maxLength(2048), Schema.filter(safeNoteUrl)),
  ),
});
export const NoteBlock = Schema.Struct({
  id: Schema.UUID,
  type: Schema.Literal("paragraph", "heading", "bullet", "ordered", "todo"),
  content: Schema.Array(NoteSpan).pipe(Schema.maxItems(500)),
  level: Schema.optional(Schema.Literal(1, 2, 3)),
  checked: Schema.optional(Schema.Boolean),
});
export type NoteBlock = typeof NoteBlock.Type;
export const NoteContent = Schema.Array(NoteBlock).pipe(
  Schema.maxItems(500),
  Schema.filter(
    (blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length,
  ),
  Schema.filter((blocks) => JSON.stringify(blocks).length <= 200000),
);
export const NoteInstructions = Schema.String.pipe(Schema.maxLength(8000));
export const NoteWrite = Schema.Struct({
  requestId: Schema.UUID,
  revision: Schema.NonNegativeInt,
  blocks: NoteContent,
});
export const NoteInstructionWrite = Schema.Struct({
  requestId: Schema.UUID,
  revision: Schema.NonNegativeInt,
  instructions: NoteInstructions,
});
export const NoteEdit = Schema.Struct({
  id: Schema.UUID,
  before: Schema.NullOr(NoteBlock),
  after: Schema.NullOr(NoteBlock),
  afterId: Schema.optional(Schema.NullOr(Schema.UUID)),
});
export const NotePatch = Schema.Struct({
  requestId: Schema.UUID,
  revision: Schema.NonNegativeInt,
  readToken: Schema.UUID,
  edits: Schema.Array(NoteEdit).pipe(Schema.minItems(1), Schema.maxItems(100)),
});
export const NoteRestore = Schema.Struct({
  requestId: Schema.UUID,
  revision: Schema.NonNegativeInt,
  targetRevision: Schema.NonNegativeInt,
});
export type NoteSnapshot = {
  agentId: string;
  revision: number;
  blocks: typeof NoteContent.Type;
  instructions: string;
  updatedAt: number;
};

// Three-way reconciliation is explicit: only unchanged target blocks may be replaced.
export function reconcileNote(
  base: NoteSnapshot["blocks"],
  local: NoteSnapshot["blocks"],
  remote: NoteSnapshot["blocks"],
) {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const result = [...remote];
  for (const old of base) {
    const next = local.find((b) => b.id === old.id);
    if (same(old, next)) continue;
    const index = result.findIndex((b) => b.id === old.id);
    if (same(result[index], next)) continue;
    if (!same(result[index], old)) return null;
    if (next) result[index] = next;
    else result.splice(index, 1);
  }
  for (let i = 0; i < local.length; i++) {
    const block = local[i]!;
    if (base.some((b) => b.id === block.id)) continue;
    const existing = result.find((b) => b.id === block.id);
    if (existing) {
      if (!same(existing, block)) return null;
      continue;
    }
    const previous = local[i - 1];
    const index = previous ? result.findIndex((b) => b.id === previous.id) : -1;
    if (previous && index < 0) return null;
    result.splice(index + 1, 0, block);
  }
  // Reordering existing blocks needs a deliberate reload, never a guessed merge.
  const common = new Set(
    base.filter((b) => local.some((n) => n.id === b.id)).map((b) => b.id),
  );
  if (
    !same(
      base.filter((b) => common.has(b.id)).map((b) => b.id),
      local.filter((b) => common.has(b.id)).map((b) => b.id),
    )
  )
    return null;
  return Schema.decodeUnknownSync(NoteContent)(result);
}

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔", "👀"] as const;
export const MAX_REACTIONS_PER_ACTOR = 20;

// Unicode's recommended emoji sequences include flags, modifiers and ZWJ
// families. Also accept a single emoji with default text presentation (e.g. ❤).
// biome-ignore lint/complexity/useRegexLiterals: Our ES2022 compile target needs this newer Unicode flag at runtime.
const emoji = new RegExp(
  "^(?:\\p{RGI_Emoji}|(?=\\p{Emoji})\\p{Extended_Pictographic})$",
  "v",
);

export function isReactionEmoji(value: string): boolean {
  return (
    value.length <= 64 &&
    !/^\p{Emoji_Component}$/u.test(value) &&
    emoji.test(value)
  );
}

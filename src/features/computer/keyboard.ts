// X11 keysyms: Latin-1 is direct; other codepoints use the Unicode prefix.
export function desktopKeys(text: string) {
  return Array.from(text, (character) => {
    const special = { "\b": 0xff08, "\t": 0xff09, "\n": 0xff0d, "\r": 0xff0d }[
      character
    ];
    if (special) return special;
    const codepoint = character.codePointAt(0)!;

    return codepoint <= 0xff ? codepoint : 0x01000000 | codepoint;
  });
}

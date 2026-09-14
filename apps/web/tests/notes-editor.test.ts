import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const block = (text: string) => ({
  id: randomUUID(),
  type: "paragraph" as const,
  content: [{ text }],
});

test("editor round trips supported formatting, checked tasks, headings, line breaks, and identities", async () => {
  const { fromEditor, toEditor } = await import(
    "../src/features/notes/editor-content"
  );
  const blocks = [
    ...([1, 2, 3] as const).map((level) => ({
      ...block(`Heading ${level}`),
      type: "heading" as const,
      level,
    })),
    { ...block("Bullet"), type: "bullet" as const },
    { ...block("Number"), type: "ordered" as const },
    { ...block("Done"), type: "todo" as const, checked: true },
    { ...block("Next"), type: "todo" as const, checked: false },
    {
      ...block(""),
      content: [
        { text: "bold\nline", bold: true },
        { text: "italic", italic: true },
        { text: "link", href: "https://example.com/" },
      ],
    },
  ];
  assert.deepEqual(fromEditor(toEditor(blocks)), blocks);
  const document = toEditor(blocks);
  assert.match(JSON.stringify(document), /hardBreak/);
  assert.deepEqual(fromEditor(toEditor(fromEditor(document))), blocks);
});

test("safe preview escapes HTML and refuses unsafe URLs even before client hydration", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NotePreview } = await import("../src/components/note-preview");
  const html = renderToStaticMarkup(
    createElement(NotePreview, {
      blocks: [
        {
          ...block(""),
          content: [
            {
              text: '<img src=x onerror="alert(1)">',
              href: "javascript:alert(1)",
            },
            { text: "Safe", bold: true, href: "https://example.com" },
          ],
        },
      ],
    }),
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("javascript:"));
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>Safe<\/strong>/);
});

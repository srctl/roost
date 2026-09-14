import type { JSONContent } from "@tiptap/react";
import { Schema } from "effect";
import {
  type NoteBlock,
  NoteContent,
  type NoteSnapshot,
  safeNoteUrl,
} from "./schema";

export function toEditor(blocks: NoteSnapshot["blocks"]): JSONContent {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    const text: JSONContent[] = block.content.flatMap((span) => {
      const marks = [
        ...(span.bold ? [{ type: "bold" }] : []),
        ...(span.italic ? [{ type: "italic" }] : []),
        ...(span.href ? [{ type: "link", attrs: { href: span.href } }] : []),
      ];
      return span.text
        .split("\n")
        .flatMap((part, index) => [
          ...(index ? [{ type: "hardBreak", marks }] : []),
          ...(part ? [{ type: "text", text: part, marks }] : []),
        ]);
    });
    const node: JSONContent = {
      type: block.type === "heading" ? "heading" : "paragraph",
      attrs: {
        id: block.id,
        ...(block.type === "heading" ? { level: block.level ?? 2 } : {}),
      },
      content: text,
    };
    if (["bullet", "ordered", "todo"].includes(block.type)) {
      const type =
        block.type === "todo"
          ? "taskList"
          : block.type === "bullet"
            ? "bulletList"
            : "orderedList";
      const item = {
        type: block.type === "todo" ? "taskItem" : "listItem",
        attrs: { checked: block.checked ?? false },
        content: [node],
      };
      const last = content.at(-1);
      if (last?.type === type) last.content!.push(item);
      else content.push({ type, content: [item] });
    } else content.push(node);
  }
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export function fromEditor(document: JSONContent): NoteSnapshot["blocks"] {
  const blocks: NoteBlock[] = [];
  function visit(
    node: JSONContent,
    type: NoteBlock["type"] = "paragraph",
    checked = false,
  ) {
    if (node.type === "paragraph" || node.type === "heading") {
      const content: {
        text: string;
        bold?: boolean;
        italic?: boolean;
        href?: string;
      }[] = [];
      for (const child of node.content ?? []) {
        const span: (typeof content)[number] = {
          text: child.type === "hardBreak" ? "\n" : (child.text ?? ""),
        };
        for (const mark of child.marks ?? []) {
          if (mark.type === "bold") span.bold = true;
          if (mark.type === "italic") span.italic = true;
          if (
            mark.type === "link" &&
            typeof mark.attrs?.href === "string" &&
            safeNoteUrl(mark.attrs.href)
          )
            span.href = mark.attrs.href;
        }
        if (span.text) {
          const previous = content.at(-1);
          if (
            previous &&
            previous.bold === span.bold &&
            previous.italic === span.italic &&
            previous.href === span.href
          )
            previous.text += span.text;
          else content.push(span);
        }
      }
      blocks.push({
        id: node.attrs?.id ?? crypto.randomUUID(),
        type: node.type === "heading" ? "heading" : type,
        content,
        ...(node.type === "heading" ? { level: node.attrs?.level ?? 2 } : {}),
        ...(type === "todo" ? { checked } : {}),
      });
      return;
    }
    const nextType =
      node.type === "taskList"
        ? "todo"
        : node.type === "bulletList"
          ? "bullet"
          : node.type === "orderedList"
            ? "ordered"
            : type;
    for (const child of node.content ?? [])
      visit(
        child,
        nextType,
        node.type === "taskItem" ? !!node.attrs?.checked : checked,
      );
  }
  visit(document);
  return Schema.decodeUnknownSync(NoteContent)(blocks);
}

// Paste only supported rich text; flatten nested lists because this note has flat blocks.
// The editor schema then discards unsupported elements and attributes as a second boundary.
export function sanitizeNotePaste(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const node of document.querySelectorAll(
    "script,style,iframe,object,embed,svg,math",
  ))
    node.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("on") ||
        ["id", "data-id", "style"].includes(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
    if (
      element.tagName === "A" &&
      !safeNoteUrl(element.getAttribute("href") ?? "")
    )
      element.removeAttribute("href");
  }
  for (const list of [...document.querySelectorAll("li ul, li ol")].reverse()) {
    const item = list.closest("li");
    if (!item?.parentElement) continue;
    for (const child of [...list.children].reverse()) item.after(child);
    list.remove();
  }
  return document.body.innerHTML;
}

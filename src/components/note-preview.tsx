import type { ReactNode } from "react";
import { type NoteSnapshot, safeNoteUrl } from "../features/notes/schema";

// React escapes all text. Never render note HTML, including in revision previews.
export function NotePreview({ blocks }: { blocks: NoteSnapshot["blocks"] }) {
  return (
    <div>
      {blocks.map((block) => {
        const text = block.content.map((span, index) => {
          let content: ReactNode = span.text;
          if (span.bold) content = <strong>{content}</strong>;
          if (span.italic) content = <em>{content}</em>;
          if (span.href && safeNoteUrl(span.href))
            content = (
              <a href={span.href} rel="noopener noreferrer">
                {content}
              </a>
            );
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: Stateless inline text fragments are identified by their position within a stable block.
              key={`${block.id}:${index}`}
              style={{ whiteSpace: "pre-wrap" }}
            >
              {content}
            </span>
          );
        });
        if (block.type === "heading") {
          if (block.level === 1) return <h1 key={block.id}>{text}</h1>;
          if (block.level === 3) return <h3 key={block.id}>{text}</h3>;
          return <h2 key={block.id}>{text}</h2>;
        }
        if (block.type === "bullet")
          return (
            <ul key={block.id}>
              <li>{text}</li>
            </ul>
          );
        if (block.type === "ordered")
          return (
            <ol key={block.id}>
              <li>{text}</li>
            </ol>
          );
        return (
          <p key={block.id}>
            {block.type === "todo" && (
              <span
                role="img"
                aria-label={block.checked ? "Completed: " : "Not completed: "}
              >
                {block.checked ? "☑ " : "☐ "}
              </span>
            )}
            {text}
          </p>
        );
      })}
    </div>
  );
}

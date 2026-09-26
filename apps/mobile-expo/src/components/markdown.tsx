import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { type Palette, usePalette } from "@/lib/theme";

// A deliberately small subset of MarkdownText.swift: headings, paragraphs,
// lists, fenced code, and inline bold/italic/code/links. Tables are rendered
// as code blocks. A production port would reuse the web app's parser.
type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i]))
        items.push(lines[i++].replace(bullet, ""));
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|"))
        rows.push(lines[i++]);
      blocks.push({ kind: "code", text: rows.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !bullet.test(lines[i])
    )
      paragraph.push(lines[i++]);
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

const inlinePattern =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string, palette: Palette, color: string): ReactNode[] {
  return text.split(inlinePattern).map((part, index) => {
    const key = `${index}-${part.length}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <Text key={key} style={{ fontWeight: "600" }}>
          {part.slice(2, -2)}
        </Text>
      );
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <Text
          key={key}
          style={{
            fontFamily: "Menlo",
            fontSize: 14,
            backgroundColor: palette.surface,
          }}
        >
          {part.slice(1, -1)}
        </Text>
      );
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link)
      return (
        <Text
          key={key}
          style={{
            color: color === palette.foreground ? palette.accent : color,
            textDecorationLine: "underline",
          }}
          onPress={() => WebBrowser.openBrowserAsync(link[2])}
          accessibilityRole="link"
        >
          {link[1]}
        </Text>
      );
    if (/^(\*[^*].*\*|_[^_].*_)$/.test(part))
      return (
        <Text key={key} style={{ fontStyle: "italic" }}>
          {part.slice(1, -1)}
        </Text>
      );
    return part;
  });
}

export function Markdown({ text, color }: { text: string; color?: string }) {
  const palette = usePalette();
  const foreground = color ?? palette.foreground;
  const body = { color: foreground, fontSize: 17, lineHeight: 23 };
  return (
    <View style={{ gap: 10 }}>
      {parse(text).map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={key}
                accessibilityRole="header"
                style={{
                  ...body,
                  fontWeight: "600",
                  fontSize: block.level <= 2 ? 20 : 17,
                }}
              >
                {inline(block.text, palette, foreground)}
              </Text>
            );
          case "list":
            return (
              <View key={key} style={{ gap: 4 }}>
                {block.items.map((item, n) => (
                  <View
                    // biome-ignore lint/suspicious/noArrayIndexKey: parsed list items never reorder.
                    key={`${n}-${item.length}`}
                    style={{ flexDirection: "row", gap: 8 }}
                  >
                    <Text style={{ ...body, color: palette.muted }}>
                      {block.ordered ? `${n + 1}.` : "•"}
                    </Text>
                    <Text style={{ ...body, flex: 1 }}>
                      {inline(item, palette, foreground)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "code":
            return (
              <ScrollView
                key={key}
                horizontal
                style={{ backgroundColor: palette.surface, borderRadius: 10 }}
                contentContainerStyle={{ padding: 12 }}
              >
                <Text
                  selectable
                  style={{
                    fontFamily: "Menlo",
                    fontSize: 13,
                    color: palette.foreground,
                  }}
                >
                  {block.text}
                </Text>
              </ScrollView>
            );
          default:
            return (
              <Text key={key} selectable style={body}>
                {inline(block.text, palette, foreground)}
              </Text>
            );
        }
      })}
    </View>
  );
}

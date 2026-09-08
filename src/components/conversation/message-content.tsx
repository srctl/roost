import * as stylex from "@stylexjs/stylex";
import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { colors } from "../../styles/tokens.stylex";

const remarkPlugins = [remarkGfm];

const components: Components = {
  p: ({ children }) => <p {...stylex.props(styles.paragraph)}>{children}</p>,
  ul: ({ children }) => <ul {...stylex.props(styles.list)}>{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} {...stylex.props(styles.list)}>
      {children}
    </ol>
  ),
  h1: ({ children }) => <h2 {...stylex.props(styles.heading)}>{children}</h2>,
  h2: ({ children }) => <h2 {...stylex.props(styles.heading)}>{children}</h2>,
  h3: ({ children }) => <h3 {...stylex.props(styles.heading)}>{children}</h3>,
  pre: ({ children }) => (
    <pre {...stylex.props(styles.codeBlock)}>{children}</pre>
  ),
  code: ({ children }) => (
    <code {...stylex.props(styles.code)}>{children}</code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      {...stylex.props(styles.link)}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote {...stylex.props(styles.quote)}>{children}</blockquote>
  ),
  table: ({ children }) => (
    <section
      aria-label="Table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus the region to scroll wide tables.
      tabIndex={0}
      {...stylex.props(styles.tableScroll)}
    >
      <table {...stylex.props(styles.table)}>{children}</table>
    </section>
  ),
  th: ({ children, style }) => (
    <th
      scope="col"
      {...stylex.props(
        styles.cell,
        styles.tableHeader,
        style?.textAlign === "center" && styles.alignCenter,
        style?.textAlign === "right" && styles.alignRight,
      )}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      {...stylex.props(
        styles.cell,
        styles.tableCell,
        style?.textAlign === "center" && styles.alignCenter,
        style?.textAlign === "right" && styles.alignRight,
      )}
    >
      {children}
    </td>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

export const MessageContent = memo(function MessageContent({
  children,
}: {
  children: string;
}) {
  return (
    <Markdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </Markdown>
  );
});

const styles = stylex.create({
  paragraph: {
    margin: 0,
    marginTop: { default: 12, ":first-child": 0 },
    whiteSpace: "pre-wrap",
  },
  list: {
    margin: 0,
    marginTop: { default: 12, ":first-child": 0 },
    paddingLeft: 20,
  },
  heading: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
    marginTop: { default: 20, ":first-child": 0 },
  },
  codeBlock: {
    maxWidth: "100%",
    overflowX: "auto",
    padding: 12,
    borderRadius: 6,
    backgroundColor: colors.surface,
    marginBottom: 0,
    marginTop: 12,
  },
  code: { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
  link: {
    color: "inherit",
    textDecorationColor: colors.muted,
    textUnderlineOffset: 3,
  },
  quote: {
    marginInline: 0,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    color: colors.muted,
  },
  tableScroll: {
    maxWidth: "100%",
    overflowX: "auto",
    marginTop: { default: 16, ":first-child": 0 },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    outlineColor: colors.accent,
    outlineOffset: 2,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "inherit",
    lineHeight: 1.5,
  },
  cell: {
    minWidth: 120,
    maxWidth: 480,
    paddingBlock: 10,
    paddingInline: 12,
    textAlign: "left",
    verticalAlign: "top",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  tableHeader: {
    backgroundColor: colors.surface,
    fontWeight: 600,
  },
  tableCell: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  alignCenter: { textAlign: "center" },
  alignRight: { textAlign: "right" },
});

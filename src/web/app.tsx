import * as stylex from "@stylexjs/stylex";
import { Button } from "./components/ui/button";
import { colors } from "./styles/tokens.stylex";

export function App() {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <p {...stylex.props(styles.wordmark)}>roost</p>
        <h1 {...stylex.props(styles.heading)}>A home for your agents.</h1>
        <p {...stylex.props(styles.description)}>
          Nothing here yet. Your agents and their work will live here.
        </p>
        <Button disabled>Create agent</Button>
        <p {...stylex.props(styles.note)}>Scaffolding only — not connected.</p>
      </div>
    </main>
  );
}

const styles = stylex.create({
  page: {
    minHeight: "100svh",
    paddingBlock: 80,
    paddingInline: 24,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, sans-serif",
  },
  content: { maxWidth: 640, marginInline: "auto" },
  wordmark: { fontSize: 24, fontWeight: 600, marginBottom: 72 },
  heading: { fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em" },
  description: { color: colors.muted, lineHeight: 1.6, marginBottom: 28 },
  note: { color: colors.muted, fontSize: 12, marginTop: 20 },
});

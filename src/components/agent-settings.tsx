import * as stylex from "@stylexjs/stylex";
import type { Agent } from "../features/agents/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "./ui/sheet";
import { AgentIdentitySettings } from "./agent-identity-settings";

export function AgentSettings({ agent }: { agent: Agent }) {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button />}
        aria-label={`Settings for ${agent.name}`}
      >
        <Icon name="settings" />
      </SheetTrigger>
      <SheetContent>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.heading)}>
            <SheetTitle {...stylex.props(styles.title)}>
              {agent.name} settings
            </SheetTitle>
            <SheetDescription {...stylex.props(styles.model)}>
              Model · {agent.model}
            </SheetDescription>
          </div>
          <SheetClose render={<Button />} aria-label="Close agent settings">
            <Icon name="close" />
          </SheetClose>
        </header>
        <AgentIdentitySettings agentId={agent.id} />
      </SheetContent>
    </Sheet>
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexShrink: 0,
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    paddingTop: "max(16px, env(safe-area-inset-top))",
    paddingBottom: 16,
  },
  heading: { minWidth: 0 },
  title: { margin: 0, fontSize: 18, fontWeight: 500, overflowWrap: "anywhere" },
  model: {
    margin: 0,
    marginTop: 2,
    fontSize: 12,
    color: colors.muted,
    overflowWrap: "anywhere",
  },
});

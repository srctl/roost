import * as stylex from "@stylexjs/stylex";
import { lazy, type RefObject, Suspense } from "react";
import type { Agent } from "../features/agents/schema";
import { useOpenAfterMount } from "../features/motion";
import { colors } from "../styles/tokens.stylex";
import { AgentNameSettings } from "./agent-name-settings";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";

const AgentIdentitySettings = lazy(() =>
  import("./agent-identity-settings").then((module) => ({
    default: module.AgentIdentitySettings,
  })),
);

export function AgentSettingsDialog({
  agent,
  open,
  onOpenChange,
  trigger,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const shown = useOpenAfterMount(open);

  return (
    <Sheet open={shown} onOpenChange={onOpenChange}>
      <SheetContent finalFocus={trigger}>
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
        <AgentNameSettings key={agent.id} agent={agent} />
        <Suspense
          fallback={<p {...stylex.props(styles.loading)}>Loading settings…</p>}
        >
          <AgentIdentitySettings
            agentId={agent.id}
            coding={agent.kind === "coding"}
          />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}

const styles = stylex.create({
  loading: { padding: 24, color: colors.muted },
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

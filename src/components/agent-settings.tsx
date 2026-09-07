import { lazy, Suspense, useRef, useState } from "react";
import type { Agent } from "../features/agents/schema";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

const AgentSettingsDialog = lazy(() =>
  import("./agent-settings-dialog").then((module) => ({
    default: module.AgentSettingsDialog,
  })),
);

export function AgentSettings({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        aria-label={`Settings for ${agent.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <Icon name="settings" />
      </Button>
      {mounted && (
        <Suspense fallback={null}>
          <AgentSettingsDialog
            agent={agent}
            open={open}
            onOpenChange={setOpen}
            trigger={trigger}
          />
        </Suspense>
      )}
    </>
  );
}

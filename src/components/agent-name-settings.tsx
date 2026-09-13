import * as stylex from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveAgentName } from "../features/agents/navigation-functions";
import type { Agent } from "../features/agents/schema";
import { DisplayNameEditor } from "./display-name-editor";
import { Button } from "./ui/button";

export function AgentNameSettings({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <section aria-label="Display name" {...stylex.props(styles.root)}>
      {editing ? (
        <DisplayNameEditor
          name={agent.name}
          label="Display name"
          onCancel={() => setEditing(false)}
          onSave={async (name) => {
            const result = await saveAgentName({
              data: { agentId: agent.id, name },
            });
            if (!result.ok) throw new Error(result.error);
            await router.invalidate();
            setEditing(false);
            setNotice("Display name saved.");
          }}
        />
      ) : (
        <Button
          onClick={() => {
            setNotice("");
            setEditing(true);
          }}
        >
          Edit display name
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
const styles = stylex.create({
  root: {
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    paddingBottom: 12,
    flexShrink: 0,
  },
});

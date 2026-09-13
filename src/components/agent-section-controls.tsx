import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type {
  AgentNavigation,
  NavigationChange,
} from "../features/agents/navigation-schema";
import type { Agent } from "../features/agents/schema";
import { colors } from "../styles/tokens.stylex";
import { DisplayNameEditor, nameEditorStyles } from "./display-name-editor";
import { Button } from "./ui/button";

export function AgentSectionControls({
  navigation,
  agents,
  save,
  busy,
}: {
  navigation: AgentNavigation;
  agents: readonly Agent[];
  save: (change: NavigationChange) => Promise<void>;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<{
    kind: "create" | "rename";
    id: string;
  }>();
  const [deleting, setDeleting] = useState<string>();
  return (
    <div {...stylex.props(styles.root)}>
      <p {...stylex.props(styles.help)}>
        Sections organize navigation for everyone on this instance. Agents stay
        in creation order.
      </p>
      {editing?.kind === "create" ? (
        <DisplayNameEditor
          name=""
          label="Section name"
          onCancel={() => setEditing(undefined)}
          onSave={async (name) => {
            await save({ action: "create", id: editing.id, name });
            setEditing(undefined);
          }}
        />
      ) : (
        <Button
          disabled={busy}
          onClick={() =>
            setEditing({ kind: "create", id: crypto.randomUUID() })
          }
        >
          Create section
        </Button>
      )}
      {navigation.sections.map((section) => (
        <div key={section.id} {...stylex.props(styles.section)}>
          {editing?.kind === "rename" && editing.id === section.id ? (
            <DisplayNameEditor
              name={section.name}
              label="Section name"
              onCancel={() => setEditing(undefined)}
              onSave={async (name) => {
                await save({ action: "rename", id: section.id, name });
                setEditing(undefined);
              }}
            />
          ) : (
            <>
              <strong {...stylex.props(styles.name)}>{section.name}</strong>
              <Button
                disabled={busy}
                aria-label={`Rename section ${section.name}`}
                onClick={() => setEditing({ kind: "rename", id: section.id })}
              >
                Rename
              </Button>
              <Button
                disabled={busy}
                aria-label={`Delete section ${section.name}`}
                onClick={() => setDeleting(section.id)}
              >
                Delete
              </Button>
            </>
          )}
          {deleting === section.id && (
            <div>
              <p>Delete this section? Its agents move to Ungrouped.</p>
              <Button
                disabled={busy}
                onClick={() =>
                  void save({ action: "delete", id: section.id })
                    .then(() => setDeleting(undefined))
                    .catch(() => {})
                }
              >
                Delete section
              </Button>
              <Button disabled={busy} onClick={() => setDeleting(undefined)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}
      {agents.map((agent) => (
        <label key={agent.id} {...stylex.props(styles.section)}>
          <span {...stylex.props(styles.name)}>Section for {agent.name}</span>
          <select
            aria-label={`Section for ${agent.name}`}
            value={navigation.memberships[agent.id] ?? ""}
            disabled={busy}
            onChange={(event) =>
              void save({
                action: "move",
                agentId: agent.id,
                sectionId: event.target.value || null,
              }).catch(() => {})
            }
            {...stylex.props(nameEditorStyles.control)}
          >
            <option value="">Ungrouped</option>
            {navigation.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 8,
    fontSize: 12,
  },
  help: { color: colors.muted, margin: 0 },
  section: { display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 },
  name: { width: "100%", overflowWrap: "anywhere" },
});

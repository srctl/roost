import * as stylex from "@stylexjs/stylex";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  getCodingConfiguration,
  removeExecutionProfile,
  updateCodingConfiguration,
  upsertExecutionProfile,
} from "../features/coding/functions";
import type {
  CodingSettings,
  ExecutionProfile,
  TaskSource,
} from "../features/coding/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function AgentCodingSettings({ agentId }: { agentId: string }) {
  const [settings, setSettings] = useState<CodingSettings>();
  const [savedSettings, setSavedSettings] = useState<CodingSettings>();
  const [profiles, setProfiles] = useState<readonly ExecutionProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<ExecutionProfile>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getCodingConfiguration({ data: { agentId } })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSettings(result.value.settings);
        setSavedSettings(result.value.settings);
        setProfiles(result.value.profiles);
      })
      .catch(() => {
        if (active) setError("Could not load coding settings. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agentId, reload]);

  function changeSettings(patch: Partial<CodingSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setNotice("");
  }

  function changeSource(id: string, patch: Partial<TaskSource>) {
    if (!settings) return;
    changeSettings({
      sources: settings.sources.map((source) =>
        source.id === id ? { ...source, ...patch } : source,
      ),
    });
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await updateCodingConfiguration({ data: settings });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSettings(result.value);
      setSavedSettings(result.value);
      setNotice("Coding settings saved. Applies to new work.");
    } catch {
      setError("Could not save coding settings. Your edits are still here.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(profile: ExecutionProfile) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await upsertExecutionProfile({ data: profile });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setProfiles((current) =>
        [
          ...current.filter((item) => item.id !== profile.id),
          result.value,
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingProfile(undefined);
      setNotice("Execution profile saved. Available to every coding agent.");
    } catch {
      setError(
        "Could not save the execution profile. Your edits are still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: ExecutionProfile) {
    let removed = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await removeExecutionProfile({
        data: { id: profile.id, revision: profile.revision },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      removed = true;
      setProfiles((current) =>
        current.filter((item) => item.id !== profile.id),
      );
      if (editingProfile?.id === profile.id) setEditingProfile(undefined);
      // Deleting a default profile also changes the project's saved revision.
      // Merge only that known change; concurrent project edits must still conflict.
      const refreshed = await getCodingConfiguration({ data: { agentId } });
      if (!refreshed.ok || !settings || !savedSettings) {
        setError(
          "Profile removed. Reload saved settings before saving project changes.",
        );
        return;
      }
      const expected = {
        ...savedSettings,
        defaultProfileId:
          savedSettings.defaultProfileId === profile.id
            ? null
            : savedSettings.defaultProfileId,
        revision:
          savedSettings.revision +
          (savedSettings.defaultProfileId === profile.id ? 1 : 0),
      };
      const unchanged =
        JSON.stringify(settings) === JSON.stringify(savedSettings);
      if (
        JSON.stringify(refreshed.value.settings) === JSON.stringify(expected)
      ) {
        setSettings({
          ...settings,
          defaultProfileId:
            settings.defaultProfileId === profile.id
              ? null
              : settings.defaultProfileId,
          revision: expected.revision,
        });
      } else if (unchanged) {
        setSettings(refreshed.value.settings);
      } else {
        setError(
          "Profile removed, but project settings changed elsewhere. Your edits are still here. Reload saved settings before saving.",
        );
        return;
      }
      setSavedSettings(refreshed.value.settings);
      setProfiles(refreshed.value.profiles);
      setNotice("Execution profile removed.");
    } catch {
      setError(
        removed
          ? "Profile removed. Could not refresh project settings; reload before saving."
          : "Could not remove the execution profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...stylex.props(styles.root)}>
      <p {...stylex.props(styles.help)}>
        Defaults for this project. You can choose another task source or
        execution profile in conversation. Soul and reflection stay separate.
      </p>
      {loading && !settings && <p role="status">Loading coding settings…</p>}
      {settings && (
        <form onSubmit={saveSettings}>
          <fieldset disabled={busy || loading} {...stylex.props(styles.fields)}>
            <section {...stylex.props(styles.section)}>
              <h3 {...stylex.props(styles.heading)}>Project</h3>
              <Field label="Repository">
                <input
                  value={settings.repository}
                  maxLength={4000}
                  onChange={(event) =>
                    changeSettings({ repository: event.target.value })
                  }
                  placeholder="Repository URL or path on the execution machine"
                  {...stylex.props(styles.input)}
                />
              </Field>
              <Field label="Project instructions">
                <textarea
                  value={settings.projectInstructions}
                  maxLength={32000}
                  onChange={(event) =>
                    changeSettings({ projectInstructions: event.target.value })
                  }
                  placeholder="Setup commands, testing expectations, project conventions, and what is ready for review…"
                  {...stylex.props(styles.input, styles.textarea)}
                />
              </Field>
              <Field label="Default execution profile">
                <select
                  value={settings.defaultProfileId ?? ""}
                  onChange={(event) =>
                    changeSettings({
                      defaultProfileId: event.target.value || null,
                    })
                  }
                  {...stylex.props(styles.input)}
                >
                  <option value="">Choose in conversation</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </Field>
            </section>
            <section {...stylex.props(styles.section)}>
              <div {...stylex.props(styles.sectionHeader)}>
                <h3 {...stylex.props(styles.heading)}>Task sources</h3>
                <Button
                  type="button"
                  disabled={settings.sources.length >= 50}
                  onClick={() =>
                    changeSettings({
                      sources: [
                        ...settings.sources,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          databaseUrl: "",
                          filter: "",
                          instructions: "",
                        },
                      ],
                    })
                  }
                >
                  Add source
                </Button>
              </div>
              <p {...stylex.props(styles.help)}>
                Save a Notion database and optional filters. The agent uses its
                connected apps when you assign work; saving a source does not
                automatically pick up tickets. Ad hoc tasks need no source.
              </p>
              {settings.sources.map((source, index) => (
                <div key={source.id} {...stylex.props(styles.source)}>
                  <div {...stylex.props(styles.sectionHeader)}>
                    <span {...stylex.props(styles.sourceLabel)}>
                      {source.name || `Source ${index + 1}`}
                    </span>
                    <Button
                      type="button"
                      aria-label={`Remove ${source.name || `source ${index + 1}`}`}
                      onClick={() =>
                        changeSettings({
                          sources: settings.sources.filter(
                            (item) => item.id !== source.id,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <Field label="Source name">
                    <input
                      required
                      maxLength={160}
                      value={source.name}
                      placeholder="Project backlog"
                      onChange={(event) =>
                        changeSource(source.id, { name: event.target.value })
                      }
                      {...stylex.props(styles.input)}
                    />
                  </Field>
                  <Field label="Database URL">
                    <input
                      type="url"
                      required
                      maxLength={4000}
                      value={source.databaseUrl}
                      placeholder="https://www.notion.so/…"
                      onChange={(event) =>
                        changeSource(source.id, {
                          databaseUrl: event.target.value,
                        })
                      }
                      {...stylex.props(styles.input)}
                    />
                  </Field>
                  <Field label="Filter instructions">
                    <textarea
                      maxLength={32000}
                      value={source.filter}
                      placeholder="Only tickets labeled Roost with status Ready"
                      onChange={(event) =>
                        changeSource(source.id, { filter: event.target.value })
                      }
                      {...stylex.props(styles.input, styles.shortTextarea)}
                    />
                  </Field>
                  <Field label="Progress update instructions">
                    <textarea
                      maxLength={32000}
                      value={source.instructions}
                      placeholder="Set status to In progress when work starts; add the PR link and move to Review when verified…"
                      onChange={(event) =>
                        changeSource(source.id, {
                          instructions: event.target.value,
                        })
                      }
                      {...stylex.props(styles.input, styles.shortTextarea)}
                    />
                  </Field>
                </div>
              ))}
            </section>
            <Button type="submit" xstyle={styles.primary}>
              {busy ? "Saving…" : "Save coding settings"}
            </Button>
          </fieldset>
        </form>
      )}
      {settings && (
        <section {...stylex.props(styles.section, styles.profiles)}>
          <div {...stylex.props(styles.sectionHeader)}>
            <h3 {...stylex.props(styles.heading)}>Execution profiles</h3>
            <Button
              disabled={busy || loading || Boolean(editingProfile)}
              onClick={() => {
                setNotice("");
                setEditingProfile({
                  id: crypto.randomUUID(),
                  name: "",
                  kind: "local",
                  target: "",
                  instructions: "",
                  revision: 0,
                });
              }}
            >
              Add profile
            </Button>
          </div>
          <p {...stylex.props(styles.help)}>
            Shared by all coding agents. Describe how to prepare the machine,
            launch the coding worker, and clean up. Project instructions add
            this agent’s setup and conventions.
          </p>
          {!profiles.length && !editingProfile && (
            <p {...stylex.props(styles.help)}>No execution profiles yet.</p>
          )}
          {profiles.map((profile) => (
            <div key={profile.id} {...stylex.props(styles.profileRow)}>
              <div {...stylex.props(styles.profileName)}>
                <span>{profile.name}</span>
                <span {...stylex.props(styles.detail)}>
                  {profile.kind === "local"
                    ? "On the Roost host"
                    : profile.target || "SSH machine chosen for each job"}
                </span>
              </div>
              <div {...stylex.props(styles.actions)}>
                <Button
                  disabled={busy || loading || Boolean(editingProfile)}
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => setEditingProfile(profile)}
                >
                  Edit
                </Button>
                <Button
                  disabled={busy || loading || Boolean(editingProfile)}
                  aria-label={`Remove profile ${profile.name}`}
                  onClick={() => void removeProfile(profile)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {editingProfile && (
            <ProfileEditor
              key={editingProfile.id}
              profile={editingProfile}
              disabled={busy || loading}
              onSave={saveProfile}
              onCancel={() => setEditingProfile(undefined)}
            />
          )}
        </section>
      )}
      {error && (
        <div role="alert" {...stylex.props(styles.error)}>
          <p>{error}</p>
          <Button
            disabled={busy || loading}
            onClick={() => {
              setEditingProfile(undefined);
              setReload((current) => current + 1);
            }}
          >
            Reload saved settings
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" {...stylex.props(styles.help)}>
          {notice}
        </p>
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  disabled,
  onSave,
  onCancel,
}: {
  profile: ExecutionProfile;
  disabled: boolean;
  onSave: (profile: ExecutionProfile) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) void onSave(draft);
      }}
      {...stylex.props(styles.profileEditor)}
    >
      <fieldset disabled={disabled} {...stylex.props(styles.fields)}>
        <h4 {...stylex.props(styles.heading)}>
          {profile.revision === 0
            ? "New execution profile"
            : "Edit execution profile"}
        </h4>
        <Field label="Profile name">
          <input
            required
            maxLength={160}
            value={draft.name}
            placeholder="This Mac, new remote machine, or Railway"
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            {...stylex.props(styles.input)}
          />
        </Field>
        <Field label="Run coding workers">
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({
                ...draft,
                kind: event.target.value as "local" | "ssh",
              })
            }
            {...stylex.props(styles.input)}
          >
            <option value="local">On the Roost host</option>
            <option value="ssh">On an SSH machine</option>
          </select>
        </Field>
        <p {...stylex.props(styles.help)}>
          The Roost host is the machine running Roost. It may be different from
          the computer where you open this page.
        </p>
        {draft.kind === "ssh" && (
          <>
            <Field label="Default SSH destination (optional)">
              <input
                maxLength={4000}
                value={draft.target}
                placeholder="user@host or SSH config alias"
                onChange={(event) =>
                  setDraft({ ...draft, target: event.target.value })
                }
                {...stylex.props(styles.input)}
              />
            </Field>
            <p {...stylex.props(styles.help)}>
              Leave empty when your instructions create a new machine.
            </p>
          </>
        )}
        <Field label="Execution instructions">
          <textarea
            maxLength={32000}
            value={draft.instructions}
            placeholder="Describe setup, Herdr and installed agents, workspace isolation, verification, and cleanup. For a new remote or Railway environment, include how to provision it and connect."
            onChange={(event) =>
              setDraft({ ...draft, instructions: event.target.value })
            }
            {...stylex.props(styles.input, styles.textarea)}
          />
        </Field>
        <p {...stylex.props(styles.help)}>
          Instructions use the agent’s available tools and connections. Keep
          credentials in the machine’s configured tools, not in these fields.
        </p>
        <div {...stylex.props(styles.actions)}>
          <Button type="submit" xstyle={styles.primary}>
            {disabled ? "Saving…" : "Save profile"}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Every Field wraps its native input, textarea, or select child.
    <label {...stylex.props(styles.field)}>
      {label}
      {children}
    </label>
  );
}

const styles = stylex.create({
  root: { paddingBottom: 16 },
  fields: { borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  section: { paddingBlock: 12 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: { fontSize: 14, fontWeight: 500, marginBlock: 0 },
  help: {
    color: colors.muted,
    fontSize: 12,
    marginBlock: 12,
    lineHeight: 1.65,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    marginBlock: 16,
  },
  input: {
    width: "100%",
    minWidth: 0,
    padding: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "inherit",
    fontSize: { default: 13, "@media (max-width: 700px)": 16 },
    lineHeight: 1.6,
    outlineOffset: 3,
  },
  textarea: { resize: "vertical", minHeight: 140 },
  shortTextarea: { resize: "vertical", minHeight: 72 },
  source: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    paddingBlock: 16,
  },
  sourceLabel: { fontSize: 12, fontWeight: 500, overflowWrap: "anywhere" },
  profiles: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    paddingTop: 24,
  },
  profileRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingBlock: 12,
  },
  profileName: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  detail: { color: colors.muted, fontSize: 11 },
  profileEditor: { paddingTop: 16 },
  actions: { display: "flex", gap: 8, flexShrink: 0 },
  primary: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 12,
    minHeight: 32,
    opacity: { default: 1, ":disabled": 0.5 },
  },
  error: { color: colors.review, fontSize: 12 },
});

import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Agent } from "../features/agents/schema";
import { updateFeedSettings } from "../features/feed/functions";
import {
  type FeedSettings,
  type FeedSettingsWrite,
  safeFeedUrl,
} from "../features/feed/schema";
import { useOpenAfterMount } from "../features/motion";
import { feedStyles as styles } from "../styles/feed.stylex";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

const presets = [
  {
    name: "Capitol Hill Seattle Blog",
    url: "https://www.capitolhillseattle.com/feed/",
  },
  {
    name: "The Seattle Times · Local",
    url: "https://www.seattletimes.com/seattle-news/feed/",
  },
];

export function FeedPreferences({
  settings,
  agents,
  onClose,
  onSaved,
}: {
  settings: FeedSettings;
  agents: readonly Agent[];
  onClose: () => void;
  onSaved: (settings: FeedSettings) => void;
}) {
  const [draft, setDraft] = useState<FeedSettingsWrite>({
    revision: settings.revision,
    enabled: settings.enabled,
    interests: settings.interests,
    priorities: settings.priorities,
    sources: settings.sources,
    agentId: settings.agentId,
    refreshMinutes: settings.refreshMinutes,
    emailEnabled: settings.emailEnabled,
    jevEnabled: settings.jevEnabled,
    scorePrivateUpdates: settings.scorePrivateUpdates,
  });
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = useOpenAfterMount(true);

  function patch(value: Partial<FeedSettingsWrite>) {
    setDraft((current) => ({ ...current, ...value }));
  }

  function nextSources() {
    if (!url.trim() && !name.trim()) return draft.sources;
    const safe = safeFeedUrl(url.trim());
    if (!safe) throw new Error("Enter a complete http or https RSS/Atom URL.");
    if (draft.sources.some((source) => source.url === safe))
      throw new Error("That source is already in your feed.");
    if (draft.sources.length >= 20)
      throw new Error("You can follow up to 20 sources.");
    return [
      ...draft.sources,
      {
        id: crypto.randomUUID(),
        name: name.trim() || new URL(safe).hostname,
        url: safe,
        enabled: true,
      },
    ];
  }

  function addSource() {
    try {
      if (!url.trim())
        throw new Error("Enter an RSS or Atom URL to add a source.");
      patch({ sources: nextSources() });
      setName("");
      setUrl("");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add source.",
      );
    }
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      const sources = nextSources();
      if (draft.jevEnabled && !settings.jevConfigured && !apiKey.trim())
        throw new Error("Add a Jev API key or turn off Jev ranking.");
      if (draft.emailEnabled && !draft.agentId)
        throw new Error(
          "Choose a contributing agent before enabling email updates.",
        );
      const result = await updateFeedSettings({
        data: {
          ...draft,
          sources,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      });
      if (!result.ok) throw new Error(result.error);
      onSaved(result.value);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save preferences. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={shown}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.dialog)}>
          <header {...stylex.props(styles.dialogHeader)}>
            <Dialog.Title {...stylex.props(styles.dialogTitle)}>
              Your feed
            </Dialog.Title>
            <Dialog.Close
              disabled={busy}
              render={
                <Button aria-label="Close feed preferences">
                  <Icon name="close" />
                </Button>
              }
            />
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            {...stylex.props(styles.form)}
          >
            <div {...stylex.props(styles.dialogScroll)}>
              <Dialog.Description {...stylex.props(styles.hint)}>
                Choose what matters to you and where your stories come from.
              </Dialog.Description>
              <section
                aria-label="Feed preferences"
                {...stylex.props(styles.formSection, styles.firstSection)}
              >
                <label {...stylex.props(styles.checkboxRow)}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) =>
                      patch({ enabled: event.target.checked })
                    }
                    {...stylex.props(styles.checkbox)}
                  />
                  <span {...stylex.props(styles.checkboxText)}>
                    <span {...stylex.props(styles.label)}>
                      Keep my feed up to date
                    </span>
                    <span {...stylex.props(styles.hint)}>
                      Periodically check your sources for new stories.
                    </span>
                  </span>
                </label>
                <label {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.label)}>Your interests</span>
                  <textarea
                    value={draft.interests}
                    maxLength={4000}
                    onChange={(event) =>
                      patch({ interests: event.target.value })
                    }
                    placeholder="Seattle neighborhoods, local food, independent music, building useful software…"
                    rows={3}
                    {...stylex.props(styles.input, styles.textarea)}
                  />
                  <span {...stylex.props(styles.hint)}>
                    Be specific. Places, topics, projects, and things you want
                    to learn all help.
                  </span>
                </label>
                <label {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.label)}>
                    What matters right now
                  </span>
                  <textarea
                    value={draft.priorities}
                    maxLength={4000}
                    onChange={(event) =>
                      patch({ priorities: event.target.value })
                    }
                    placeholder="A trip you're planning, a project you're building, or changes you want to keep up with."
                    rows={2}
                    {...stylex.props(styles.input, styles.textarea)}
                  />
                </label>
                <label {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.label)}>
                    Check for new stories
                  </span>
                  <select
                    value={draft.refreshMinutes}
                    onChange={(event) =>
                      patch({ refreshMinutes: Number(event.target.value) })
                    }
                    {...stylex.props(styles.input)}
                  >
                    {![30, 60, 180, 360, 720, 1440].includes(
                      draft.refreshMinutes,
                    ) && (
                      <option value={draft.refreshMinutes}>
                        Every {draft.refreshMinutes} minutes
                      </option>
                    )}
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={180}>Every 3 hours</option>
                    <option value={360}>Every 6 hours</option>
                    <option value={720}>Twice a day</option>
                    <option value={1440}>Daily</option>
                  </select>
                </label>
              </section>
              <section
                aria-labelledby="feed-sources-title"
                {...stylex.props(styles.formSection)}
              >
                <h2
                  id="feed-sources-title"
                  {...stylex.props(styles.sectionTitle)}
                >
                  Followed sources
                </h2>
                <p {...stylex.props(styles.hint)}>
                  Add publications using their RSS or Atom feed. Articles link
                  to the original publisher.
                </p>
                <div {...stylex.props(styles.sources)}>
                  {draft.sources.map((source) => (
                    <div key={source.id} {...stylex.props(styles.sourceRow)}>
                      <label {...stylex.props(styles.sourceChoice)}>
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={(event) =>
                            patch({
                              sources: draft.sources.map((item) =>
                                item.id === source.id
                                  ? { ...item, enabled: event.target.checked }
                                  : item,
                              ),
                            })
                          }
                          {...stylex.props(styles.checkbox)}
                        />
                        <span {...stylex.props(styles.checkboxText)}>
                          <span {...stylex.props(styles.sourceName)}>
                            {source.name}
                          </span>
                          <span
                            title={source.url}
                            {...stylex.props(styles.sourceUrl)}
                          >
                            {source.url}
                          </span>
                        </span>
                      </label>
                      <Button
                        type="button"
                        aria-label={`Remove ${source.name}`}
                        onClick={() =>
                          patch({
                            sources: draft.sources.filter(
                              (item) => item.id !== source.id,
                            ),
                          })
                        }
                      >
                        <Icon name="close" size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
                <div {...stylex.props(styles.presets)}>
                  {presets
                    .filter(
                      (preset) =>
                        !draft.sources.some(
                          (source) => source.url === preset.url,
                        ),
                    )
                    .map((preset) => (
                      <Button
                        key={preset.url}
                        type="button"
                        disabled={draft.sources.length >= 20}
                        onClick={() =>
                          patch({
                            sources: [
                              ...draft.sources,
                              {
                                ...preset,
                                id: crypto.randomUUID(),
                                enabled: true,
                              },
                            ],
                          })
                        }
                        xstyle={styles.secondary}
                      >
                        <Icon name="plus" size={12} />
                        {preset.name}
                      </Button>
                    ))}
                </div>
                <div {...stylex.props(styles.addSource)}>
                  <label {...stylex.props(styles.smallField)}>
                    <span {...stylex.props(styles.label)}>Source name</span>
                    <input
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Publication"
                      {...stylex.props(styles.input)}
                    />
                  </label>
                  <label {...stylex.props(styles.smallField)}>
                    <span {...stylex.props(styles.label)}>RSS or Atom URL</span>
                    <input
                      type="url"
                      value={url}
                      maxLength={2000}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/feed"
                      {...stylex.props(styles.input)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={draft.sources.length >= 20}
                    onClick={addSource}
                    xstyle={styles.secondary}
                  >
                    Add source
                  </Button>
                </div>
              </section>
              <section
                aria-labelledby="feed-agent-title"
                {...stylex.props(styles.formSection)}
              >
                <h2
                  id="feed-agent-title"
                  {...stylex.props(styles.sectionTitle)}
                >
                  Stories and personal updates
                </h2>
                <p {...stylex.props(styles.hint)}>
                  An agent can connect the dots, write original stories, and
                  contribute important updates to this shared feed.
                </p>
                <label {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.label)}>
                    Contributing agent
                  </span>
                  <select
                    value={draft.agentId ?? ""}
                    onChange={(event) =>
                      patch({
                        agentId: event.target.value || null,
                        ...(!event.target.value ? { emailEnabled: false } : {}),
                      })
                    }
                    {...stylex.props(styles.input)}
                  >
                    <option value="">Publications only</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label {...stylex.props(styles.checkboxRow)}>
                  <input
                    type="checkbox"
                    checked={draft.emailEnabled}
                    disabled={!draft.agentId}
                    onChange={(event) =>
                      patch({ emailEnabled: event.target.checked })
                    }
                    {...stylex.props(styles.checkbox)}
                  />
                  <span {...stylex.props(styles.checkboxText)}>
                    <span {...stylex.props(styles.label)}>
                      Include important email updates
                    </span>
                    <span {...stylex.props(styles.hint)}>
                      The contributing agent may read its connected email
                      sources and publish relevant summaries here. It needs
                      email access configured separately.
                    </span>
                  </span>
                </label>
              </section>
              <section
                aria-labelledby="feed-ranking-title"
                {...stylex.props(styles.formSection)}
              >
                <h2
                  id="feed-ranking-title"
                  {...stylex.props(styles.sectionTitle)}
                >
                  Story selection
                </h2>
                <label {...stylex.props(styles.checkboxRow)}>
                  <input
                    type="checkbox"
                    checked={draft.jevEnabled}
                    onChange={(event) =>
                      patch({ jevEnabled: event.target.checked })
                    }
                    {...stylex.props(styles.checkbox)}
                  />
                  <span {...stylex.props(styles.checkboxText)}>
                    <span {...stylex.props(styles.label)}>
                      Use Jev to score usefulness and interest
                    </span>
                    <span {...stylex.props(styles.hint)}>
                      Jev uses your existing interests, priorities, and feed
                      feedback to estimate practical usefulness and how much you
                      would enjoy reading each story. Article excerpts and this
                      profile are sent to TypeSafe. See both scores in the story
                      reader; basic selection works without a key.
                    </span>
                  </span>
                </label>
                {draft.jevEnabled && (
                  <>
                    {settings.jevKeySource === "environment" ? (
                      <p {...stylex.props(styles.hint)}>
                        Jev is configured on this server.
                      </p>
                    ) : (
                      <label {...stylex.props(styles.field)}>
                        <span {...stylex.props(styles.label)}>
                          {settings.jevConfigured
                            ? "Replace API key"
                            : "Jev API key"}
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={apiKey}
                          maxLength={1000}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder={
                            settings.jevConfigured
                              ? "Leave blank to keep the configured key"
                              : "Enter your TypeSafe API key"
                          }
                          {...stylex.props(styles.input)}
                        />
                        <span {...stylex.props(styles.hint)}>
                          {settings.jevConfigured
                            ? "Your saved key stays on the server."
                            : "Keys are stored on the server and never included in feed responses."}
                        </span>
                      </label>
                    )}
                    <label {...stylex.props(styles.checkboxRow)}>
                      <input
                        type="checkbox"
                        checked={draft.scorePrivateUpdates}
                        onChange={(event) =>
                          patch({ scorePrivateUpdates: event.target.checked })
                        }
                        {...stylex.props(styles.checkbox)}
                      />
                      <span {...stylex.props(styles.checkboxText)}>
                        <span {...stylex.props(styles.label)}>
                          Allow Jev to score personal updates
                        </span>
                        <span {...stylex.props(styles.hint)}>
                          Also send personal update excerpts, including email
                          summaries, to TypeSafe. Leave off to keep them out of
                          Jev scoring.
                        </span>
                      </span>
                    </label>
                  </>
                )}
              </section>
            </div>
            <footer {...stylex.props(styles.dialogFooter)}>
              <p role="alert" {...stylex.props(styles.error)}>
                {error}
              </p>
              <Button type="submit" disabled={busy} xstyle={styles.primary}>
                {busy ? "Saving…" : "Save preferences"}
              </Button>
            </footer>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

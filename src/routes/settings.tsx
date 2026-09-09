import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Switch } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { CodexConnection } from "../components/codex-connection";
import { AgentMessage, UserMessage } from "../components/conversation/message";
import { ToolActivity } from "../components/conversation/tool-activity";
import { DashboardSetting } from "../components/dashboard-setting";
import { PasskeySetting } from "../components/passkey-setting";
import { PushNotifications } from "../components/push-notifications";
import { ThemeSetting } from "../components/theme-setting";
import { Button } from "../components/ui/button";
import { UpdateSetting } from "../components/update-setting";
import { getCodexAccount, getCodexLogin } from "../features/auth/functions";
import { getPushSettings } from "../features/notifications/functions";
import {
  findSettings,
  readSettingsGroup,
  type SettingsGroup,
  settingsGroups,
} from "../features/settings/navigation";
import { usePreferences } from "../features/settings/preferences";
import { colors } from "../styles/tokens.stylex";

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { group?: SettingsGroup } =>
    search.group === undefined
      ? {}
      : { group: readSettingsGroup(search.group) },
  loader: async () => {
    const [connection, notifications] = await Promise.all([
      Promise.all([getCodexAccount(), getCodexLogin()])
        .then(([account, login]) => ({ ...account, login }))
        .catch(() => null),
      getPushSettings({ data: {} }).catch(() => ({
        ok: false as const,
        error:
          "Could not load notification settings. Reload Roost to try again.",
      })),
    ]);
    return { connection, notifications };
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: SettingsPage,
});

function SettingsPage() {
  const { connection, notifications } = Route.useLoaderData();
  const { group = "appearance" } = Route.useSearch();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const matches = findSettings(query);
  const visible = (id: string) =>
    matches.some(
      (entry) => entry.id === id && (searching || entry.group === group),
    );
  const shownGroups = settingsGroups.filter((item) =>
    matches.some(
      (entry) => entry.group === item.id && (searching || item.id === group),
    ),
  );

  function clearSearch() {
    setQuery("");
    searchInput.current?.focus();
  }

  return (
    <section {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Settings</h1>
      <p {...stylex.props(styles.muted)}>Make Roost feel right for you.</p>
      <search aria-label="Settings" {...stylex.props(styles.search)}>
        <label htmlFor="settings-search" {...stylex.props(styles.searchLabel)}>
          Search settings
        </label>
        <div {...stylex.props(styles.searchRow)}>
          <input
            ref={searchInput}
            id="settings-search"
            type="search"
            value={query}
            placeholder="Try “thinking” or “notifications”"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearSearch();
            }}
            {...stylex.props(styles.searchInput)}
          />
          {query && <Button onClick={clearSearch}>Clear search</Button>}
        </div>
      </search>
      <div {...stylex.props(styles.layout)}>
        <nav aria-label="Settings groups" {...stylex.props(styles.navigation)}>
          {settingsGroups.map((item) => (
            <Link
              key={item.id}
              to="/settings"
              search={{ group: item.id }}
              aria-current={
                !searching && group === item.id ? "page" : undefined
              }
              onClick={() => setQuery("")}
              {...stylex.props(
                styles.groupLink,
                !searching && group === item.id && styles.activeGroup,
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div {...stylex.props(styles.content)}>
          <p role="status" {...stylex.props(styles.results)}>
            {searching
              ? matches.length
                ? `Results across ${shownGroups.length} ${shownGroups.length === 1 ? "group" : "groups"}`
                : `No settings found for “${query.trim()}”. Try “display”, “device”, or “sign in”.`
              : settingsGroups.find((item) => item.id === group)?.description}
          </p>
          <section
            hidden={
              !visible("theme") &&
              !visible("conversation") &&
              !visible("dashboards")
            }
            aria-label="Appearance"
          >
            {searching && (
              <p {...stylex.props(styles.groupCaption)}>Appearance</p>
            )}
            <div hidden={!visible("theme")}>
              <ThemeSetting />
            </div>
            <div hidden={!visible("conversation")}>
              <ConversationSettings />
            </div>
            <div hidden={!visible("dashboards")}>
              <DashboardSetting />
            </div>
            <div hidden={searching || !visible("conversation")}>
              <ConversationPreview />
            </div>
          </section>
          <section
            hidden={!visible("notifications")}
            aria-label="Notification settings"
          >
            {searching && (
              <p {...stylex.props(styles.groupCaption)}>Notifications</p>
            )}
            <PushNotifications initial={notifications} />
          </section>
          <section
            hidden={!visible("account")}
            aria-label="Account and security"
          >
            {searching && (
              <p {...stylex.props(styles.groupCaption)}>
                Account &amp; security
              </p>
            )}
            <CodexConnection initial={connection} />
            <PasskeySetting />
          </section>
          <section hidden={!visible("updates")} aria-label="Software updates">
            <UpdateSetting />
          </section>
          <p {...stylex.props(styles.agentHint)}>
            Looking for an agent’s model, instructions, or automations? Open
            that agent to manage its settings.
          </p>
        </div>
      </div>
    </section>
  );
}

function ConversationSettings() {
  const {
    responseStyle,
    setResponseStyle,
    showActivityDetails,
    setShowActivityDetails,
    error,
  } = usePreferences();

  return (
    <>
      <section
        {...stylex.props(styles.responseSetting)}
        aria-labelledby="response-style-label"
      >
        <h2 id="response-style-label" {...stylex.props(styles.responseLabel)}>
          Response style
        </h2>
        <RadioGroup
          value={responseStyle}
          onValueChange={setResponseStyle}
          aria-labelledby="response-style-label"
          {...stylex.props(styles.styleOptions)}
        >
          <Radio.Root
            value="messages"
            {...stylex.props(
              styles.styleOption,
              responseStyle === "messages" && styles.selectedOption,
            )}
          >
            Messages
          </Radio.Root>
          <Radio.Root
            value="codex"
            {...stylex.props(
              styles.styleOption,
              responseStyle === "codex" && styles.selectedOption,
            )}
          >
            Codex
          </Radio.Root>
        </RadioGroup>
        <p {...stylex.props(styles.description)}>
          {responseStyle === "messages"
            ? "Clean chat bubbles. Tool calls and thinking summaries are hidden."
            : "Open, formatted responses with tool activity in the conversation."}
        </p>
      </section>
      {responseStyle === "messages" && (
        <p {...stylex.props(styles.note)}>
          Choose Codex to show activity details, tool inputs and outputs, and
          thinking summaries.
        </p>
      )}
      {responseStyle === "codex" && (
        <div {...stylex.props(styles.setting)}>
          <div>
            <label
              id="activity-label"
              htmlFor="activity-details"
              {...stylex.props(styles.label)}
            >
              Show activity details
            </label>
            <p id="activity-description" {...stylex.props(styles.description)}>
              Show tool inputs, outputs, and thinking summaries. Turn off for
              compact activity rows.
            </p>
          </div>
          <Switch.Root
            id="activity-details"
            aria-labelledby="activity-label"
            checked={showActivityDetails}
            onCheckedChange={setShowActivityDetails}
            aria-describedby="activity-description"
            {...stylex.props(
              styles.switch,
              showActivityDetails && styles.checked,
            )}
          >
            <Switch.Thumb
              {...stylex.props(
                styles.thumb,
                showActivityDetails && styles.thumbChecked,
              )}
            />
          </Switch.Root>
        </div>
      )}
      <p {...stylex.props(styles.note)}>
        Saved in this browser. Applies to all your agents.
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.muted)}>
          {error}
        </p>
      )}
    </>
  );
}

function ConversationPreview() {
  const { responseStyle, showActivityDetails } = usePreferences();
  return (
    <section
      aria-labelledby="activity-preview"
      {...stylex.props(styles.preview)}
    >
      <h2 id="activity-preview" {...stylex.props(styles.previewTitle)}>
        Preview
      </h2>
      <p {...stylex.props(styles.previewDescription)}>
        {responseStyle === "messages"
          ? "A simple back-and-forth with your agent."
          : showActivityDetails
            ? "Details are visible. Click a row to collapse it."
            : "Only compact activity rows are shown."}
      </p>
      <UserMessage>What’s next for the project?</UserMessage>
      <ToolActivity
        message={{
          id: "preview-thinking",
          role: "activity",
          title: "Thinking",
          status: "completed",
          text: "I’ll look through the project notes to find the next steps.",
        }}
      />
      <ToolActivity
        message={{
          id: "preview-command",
          role: "activity",
          title: "Command",
          status: "completed",
          details: "ls notes",
          text: "ideas.md\nnext-steps.md\nresearch.md",
        }}
      />
      <AgentMessage name="Scout">
        {
          "I found **three next steps** in your notes:\n\n- Review the first draft\n- Pick a launch date\n- Share the plan with the team"
        }
      </AgentMessage>
      <AgentMessage name="Scout">
        Want me to help with the first draft?
      </AgentMessage>
      <p {...stylex.props(styles.sampleNote)}>
        Example conversation, using sample data.
      </p>
    </section>
  );
}

const styles = stylex.create({
  page: {
    maxWidth: 940,
    marginInline: "auto",
    paddingBlock: { default: 24, "@media (max-width: 700px)": 8 },
  },
  search: { marginBlock: 24 },
  searchLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 8,
  },
  searchRow: { display: "flex", gap: 8, alignItems: "center" },
  searchInput: {
    width: "100%",
    minWidth: 0,
    minHeight: 44,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 16,
    outlineOffset: 3,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "190px minmax(0, 1fr)",
      "@media (max-width: 700px)": "minmax(0, 1fr)",
    },
    gap: { default: 32, "@media (max-width: 700px)": 20 },
  },
  navigation: {
    display: "flex",
    flexDirection: { default: "column", "@media (max-width: 700px)": "row" },
    flexWrap: "wrap",
    gap: 4,
    alignSelf: "start",
  },
  groupLink: {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    paddingInline: 12,
    borderRadius: 8,
    fontSize: 13,
    color: colors.foreground,
    textDecoration: "none",
    outlineOffset: 3,
    backgroundColor: { default: "transparent", ":hover": colors.bubble },
  },
  activeGroup: { backgroundColor: colors.selected, fontWeight: 500 },
  content: { minWidth: 0 },
  results: { margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.6 },
  groupCaption: {
    marginTop: 28,
    marginBottom: 0,
    fontSize: 12,
    fontWeight: 500,
    color: colors.accent,
  },
  agentHint: {
    marginTop: 32,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    fontSize: 12,
    lineHeight: 1.6,
    color: colors.muted,
  },
  title: { marginTop: 0, fontSize: 26, fontWeight: 500, marginBottom: 8 },
  muted: { color: colors.muted },
  responseSetting: { marginTop: 32 },
  responseLabel: { fontSize: 14, fontWeight: 500, margin: 0, marginBottom: 12 },
  styleOptions: {
    display: "flex",
    gap: 4,
    width: "fit-content",
    padding: 4,
    borderRadius: 8,
    backgroundColor: colors.bubble,
  },
  styleOption: {
    paddingBlock: 7,
    paddingInline: 20,
    borderRadius: 5,
    fontSize: 12,
    cursor: "pointer",
    color: colors.muted,
    outlineOffset: 3,
  },
  selectedOption: {
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  setting: {
    display: "flex",
    alignItems: "center",
    gap: 32,
    justifyContent: "space-between",
    marginTop: 24,
    paddingBlock: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  label: { fontSize: 14, fontWeight: 500, cursor: "pointer" },
  description: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 0,
    maxWidth: 380,
  },
  note: { fontSize: 11, color: colors.muted, marginTop: 16 },
  preview: {
    marginTop: 32,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
  },
  previewTitle: { fontSize: 12, fontWeight: 500, margin: 0 },
  previewDescription: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 16,
  },
  sampleNote: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 0,
    marginTop: 16,
  },
  switch: {
    width: 36,
    height: 22,
    borderWidth: 0,
    borderRadius: 20,
    padding: 3,
    backgroundColor: colors.bubble,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    outlineOffset: 3,
  },
  checked: { backgroundColor: colors.accent },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    backgroundColor: colors.foreground,
    transform: "translateX(0)",
  },
  thumbChecked: {
    transform: "translateX(14px)",
    backgroundColor: colors.onAccent,
  },
});

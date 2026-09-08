import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Switch } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { CodexConnection } from "../components/codex-connection";
import { AgentMessage, UserMessage } from "../components/conversation/message";
import { ToolActivity } from "../components/conversation/tool-activity";
import { DashboardSetting } from "../components/dashboard-setting";
import { PasskeySetting } from "../components/passkey-setting";
import { PushNotifications } from "../components/push-notifications";
import { ThemeSetting } from "../components/theme-setting";
import { getCodexAccount, getCodexLogin } from "../features/auth/functions";
import { getPushSettings } from "../features/notifications/functions";
import { usePreferences } from "../features/settings/preferences";
import { colors } from "../styles/tokens.stylex";

export const Route = createFileRoute("/settings")({
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
  const {
    responseStyle,
    setResponseStyle,
    showActivityDetails,
    setShowActivityDetails,
    error,
  } = usePreferences();

  return (
    <section {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Settings</h1>
      <p {...stylex.props(styles.muted)}>Make Roost feel right for you.</p>
      <ThemeSetting />
      <PasskeySetting />
      <CodexConnection initial={connection} />
      <PushNotifications initial={notifications} />
      <DashboardSetting />
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
    </section>
  );
}

const styles = stylex.create({
  page: {
    maxWidth: 600,
    marginInline: "auto",
    paddingBlock: { default: 24, "@media (max-width: 700px)": 8 },
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

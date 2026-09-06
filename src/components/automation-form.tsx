import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { Automation, Schedule } from "../features/automations/schema";
import { saveAgentAutomation } from "../features/automations/functions";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

function localDate(timestamp: string) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function AutomationForm({
  agentId,
  automation,
  onSaved,
  onCancel,
}: {
  agentId: string;
  automation?: Automation;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(() => automation?.id ?? crypto.randomUUID());
  const [name, setName] = useState(automation?.name ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(
    automation?.schedule.kind ?? "weekly",
  );
  const [time, setTime] = useState(
    automation?.schedule.kind === "weekly" ? automation.schedule.time : "09:00",
  );
  const [timezone, setTimezone] = useState(
    automation?.schedule.kind === "weekly"
      ? automation.schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [days, setDays] = useState<readonly number[]>(
    automation?.schedule.kind === "weekly"
      ? automation.schedule.days
      : [1, 2, 3, 4, 5],
  );
  const [minutes, setMinutes] = useState(
    automation?.schedule.kind === "interval" ? automation.schedule.minutes : 60,
  );
  const [at, setAt] = useState(
    automation?.schedule.kind === "once"
      ? localDate(automation.schedule.at)
      : "",
  );
  const [notification, setNotification] = useState<Automation["notification"]>(
    automation?.notification ?? "when-needed",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const schedule: Schedule =
        kind === "weekly"
          ? { kind, time, timezone, days }
          : kind === "interval"
            ? { kind, minutes, timezone }
            : {
                kind,
                at: new Date(at).toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              };
      const result = await saveAgentAutomation({
        data: {
          agentId,
          id,
          name,
          prompt,
          schedule,
          notification,
          expectedRevision: automation?.revision,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } catch {
      setError("Could not save. Check the schedule and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} {...stylex.props(styles.form)}>
      <label {...stylex.props(styles.label)}>
        Name
        <input
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...stylex.props(styles.input)}
        />
      </label>
      <label {...stylex.props(styles.label)}>
        Task
        <textarea
          required
          maxLength={16000}
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Check my inbox for emails that need a reply. Summarize what needs my attention."
          {...stylex.props(styles.input)}
        />
      </label>
      <p {...stylex.props(styles.help)}>
        Each run starts fresh with this task, the agent’s current soul, and its
        own memory. Include the context it will need.
      </p>
      <label {...stylex.props(styles.label)}>
        Schedule
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Schedule["kind"])}
          {...stylex.props(styles.input)}
        >
          <option value="weekly">Days of the week</option>
          <option value="interval">Every few minutes or hours</option>
          <option value="once">Once</option>
        </select>
      </label>
      {kind === "weekly" && (
        <>
          <div {...stylex.props(styles.days)}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (day, index) => (
                <label key={day} {...stylex.props(styles.day)}>
                  <input
                    type="checkbox"
                    {...stylex.props(styles.checkbox)}
                    checked={days.includes(index)}
                    onChange={(e) =>
                      setDays(
                        e.target.checked
                          ? [...days, index].sort()
                          : days.filter((d) => d !== index),
                      )
                    }
                  />
                  {day}
                </label>
              ),
            )}
          </div>
          <div {...stylex.props(styles.row)}>
            <label {...stylex.props(styles.label)}>
              Time
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                {...stylex.props(styles.input)}
              />
            </label>
            <label {...stylex.props(styles.label)}>
              Timezone
              <input
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Los_Angeles"
                {...stylex.props(styles.input)}
              />
            </label>
          </div>
        </>
      )}
      {kind === "interval" && (
        <label {...stylex.props(styles.label)}>
          Minutes between runs
          <input
            type="number"
            min={1}
            max={525600}
            required
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            {...stylex.props(styles.input)}
          />
        </label>
      )}
      {kind === "once" && (
        <label {...stylex.props(styles.label)}>
          Date and time · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
            {...stylex.props(styles.input)}
          />
        </label>
      )}
      <label {...stylex.props(styles.label)}>
        Post to chat
        <select
          value={notification}
          onChange={(e) =>
            setNotification(e.target.value as Automation["notification"])
          }
          {...stylex.props(styles.input)}
        >
          <option value="when-needed">
            Only when something needs attention
          </option>
          <option value="always">After every run</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <div {...stylex.props(styles.actions)}>
        <Button
          type="submit"
          disabled={busy || (kind === "weekly" && !days.length)}
          xstyle={styles.save}
        >
          {busy ? "Saving…" : "Save automation"}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
const styles = stylex.create({
  form: { marginBlock: 16 },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    marginTop: 16,
    flex: 1,
    minWidth: 0,
  },
  checkbox: { accentColor: colors.accent },
  input: {
    colorScheme: "light dark",
    width: "100%",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "inherit",
    fontSize: { default: "inherit", "@media (max-width: 700px)": 16 },
    lineHeight: 1.5,
    resize: "vertical",
  },
  row: { display: "flex", gap: 12 },
  days: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 },
  day: { display: "flex", alignItems: "center", gap: 3, fontSize: 11 },
  help: { fontSize: 12, color: colors.muted },
  actions: { display: "flex", gap: 8, marginTop: 20 },
  save: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 12,
    borderRadius: 6,
    opacity: { default: 1, ":disabled": 0.5 },
  },
});

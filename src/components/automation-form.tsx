import { useMemo, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { Automation, Schedule } from "../features/automations/schema";
import { saveAgentAutomation } from "../features/automations/functions";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { nextOccurrence } from "../server/automations/schedule";

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
    automation?.schedule.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [expression, setExpression] = useState(
    automation?.schedule.kind === "cron"
      ? automation.schedule.expression
      : "0 8-22/2 * * *",
  );
  const [startsOn, setStartsOn] = useState(
    automation?.schedule.kind !== "once"
      ? (automation?.schedule.startsOn ?? "")
      : "",
  );
  const [endsOn, setEndsOn] = useState(
    automation?.schedule.kind !== "once"
      ? (automation?.schedule.endsOn ?? "")
      : "",
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
  const preview = useMemo(() => {
    try {
      let schedule: Schedule;
      if (kind === "once") {
        if (!at) return { error: "Choose a date and time." };
        schedule = {
          kind,
          at: new Date(at).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      } else {
        const dates = {
          ...(startsOn && { startsOn }),
          ...(endsOn && { endsOn }),
          timezone,
        };
        if (kind === "cron") schedule = { kind, expression, ...dates };
        else if (kind === "interval") schedule = { kind, minutes, ...dates };
        else {
          if (!days.length) return { error: "Choose at least one day." };
          schedule = { kind, time, days, ...dates };
        }
      }
      const runs: number[] = [];
      let after = Date.now();
      for (let i = 0; i < 3; i++) {
        const next = nextOccurrence(schedule, after);
        if (next === null) break;
        runs.push(next);
        after = next;
      }
      return runs.length
        ? { schedule, runs }
        : { error: "No future runs match this schedule and date range." };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Check the schedule.",
      };
    }
  }, [kind, at, expression, timezone, startsOn, endsOn, minutes, time, days]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!preview.schedule) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveAgentAutomation({
        data: {
          agentId,
          id,
          name,
          prompt,
          schedule: preview.schedule,
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
          <option value="cron">Cron expression</option>
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
          </div>
        </>
      )}
      {kind === "cron" && (
        <label {...stylex.props(styles.label)}>
          Cron expression
          <input
            required
            maxLength={200}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            spellCheck={false}
            {...stylex.props(styles.input)}
          />
          <span {...stylex.props(styles.help)}>
            Minute · hour · day of month · month · day of week
          </span>
          <span {...stylex.props(styles.help)}>
            <code>0 8-22/2 * * *</code> runs every two hours from 8 a.m. through
            10 p.m.
          </span>
        </label>
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
      {kind !== "once" && (
        <>
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
          <div {...stylex.props(styles.row)}>
            <label {...stylex.props(styles.label)}>
              Start date (optional)
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                {...stylex.props(styles.input)}
              />
            </label>
            <label {...stylex.props(styles.label)}>
              End date (optional)
              <input
                type="date"
                min={startsOn || undefined}
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                {...stylex.props(styles.input)}
              />
            </label>
          </div>
          <p {...stylex.props(styles.help)}>
            Both dates are included, in the timezone above. Leave blank to start
            now or continue indefinitely. Runs already underway can finish.
          </p>
        </>
      )}
      <div aria-live="polite" {...stylex.props(styles.help)}>
        {preview.error ?? (
          <>
            <strong>Next runs</strong>
            <ul>
              {preview.runs?.map((run) => (
                <li key={run}>
                  {new Date(run).toLocaleString(undefined, {
                    timeZone: preview.schedule?.timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
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
          disabled={busy || !preview.schedule}
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

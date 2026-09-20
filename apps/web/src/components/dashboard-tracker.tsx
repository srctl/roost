import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { DashboardContentAction } from "../features/dashboards/actions";
import { changeDashboardContent } from "../features/dashboards/functions";
import type {
  DashboardBlock,
  DashboardWidget,
} from "../features/dashboards/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

type ActionFields<T> = T extends unknown
  ? Omit<T, "key" | "expectedRevision" | "blockId">
  : never;
type Action = ActionFields<DashboardContentAction>;
type Tracker = Extract<DashboardBlock, { type: "todo-list" | "calorie-log" }>;
type Retry = { input: DashboardContentAction; clearDraft: boolean } | null;
type TrackerDraft = {
  label: string;
  calories: string;
  day: string;
  saving: boolean;
  retry: Retry;
  error: string | null;
  showCompleted: boolean;
  addId: string | null;
};
const emptyDraft: TrackerDraft = {
  label: "",
  calories: "",
  day: "",
  saving: false,
  retry: null,
  error: null,
  showCompleted: false,
  addId: null,
};
type DraftChange =
  | Partial<TrackerDraft>
  | ((current: TrackerDraft) => TrackerDraft);
const DraftContext = createContext<{
  drafts: Record<string, TrackerDraft>;
  update: (key: string, change: DraftChange) => void;
} | null>(null);

// Lives above Juxi and focus filtering: hiding a tracker must not discard a draft
// or lose the exact request that is still awaiting acknowledgement.
export function DashboardTrackerDrafts({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, TrackerDraft>>({});
  const update = useCallback((key: string, change: DraftChange) => {
    setDrafts((current) => {
      const previous = current[key] ?? emptyDraft;
      const next =
        typeof change === "function"
          ? change(previous)
          : { ...previous, ...change };
      return previous === next ? current : { ...current, [key]: next };
    });
  }, []);
  return <DraftContext value={{ drafts, update }}>{children}</DraftContext>;
}

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function DashboardTracker({
  block,
  widget,
  onChange,
  onReload,
}: {
  block: Tracker;
  widget: DashboardWidget;
  onChange: (widget: DashboardWidget) => void;
  onReload: () => Promise<void>;
}) {
  const context = useContext(DraftContext);
  if (!context) throw new Error("Dashboard trackers require a draft owner.");
  const { drafts, update } = context;
  const token = `${widget.key}/${block.type}/${block.id}`;
  const { label, calories, day, saving, retry, error, showCompleted, addId } =
    drafts[token] ?? emptyDraft;
  const setLabel = (label: string) => update(token, { label });
  const setCalories = (calories: string) => update(token, { calories });
  const setDay = (day: string) => update(token, { day });
  const setSaving = (saving: boolean) => update(token, { saving });
  const setRetry = (retry: Retry) => update(token, { retry });
  const setError = (error: string | null) => update(token, { error });
  const setShowCompleted = (showCompleted: boolean) =>
    update(token, { showCompleted });
  useEffect(() => {
    update(token, (current) =>
      current.day ? current : { ...current, day: localDay() },
    );
  }, [token, update]);
  const locked = saving || retry !== null;

  async function change(
    action: Action,
    clearDraft = false,
    exactInput?: DashboardContentAction,
  ) {
    if (saving) return;
    const input = exactInput ?? {
      key: widget.key,
      expectedRevision: widget.revision,
      blockId: block.id,
      ...action,
    };
    setSaving(true);
    setError(null);
    try {
      const result = await changeDashboardContent({
        data: { agentId: widget.agentId, ...input },
      });
      setRetry(null);
      if (result.ok) {
        onChange(result.value);
        if (clearDraft) {
          update(token, { addId: null });
          setLabel("");
          setCalories("");
        }
      } else {
        setError(result.error);
        await onReload();
      }
    } catch {
      setRetry({ input, clearDraft });
      setError(
        "Could not confirm this save. Your entry is still here; try again to check it.",
      );
      await onReload().catch(() => {});
    } finally {
      setSaving(false);
    }
  }
  const fieldId = `tracker-${widget.key}-${block.id}`;
  const completed =
    block.type === "todo-list" ? block.items.filter((item) => item.done) : [];
  const open =
    block.type === "todo-list" ? block.items.filter((item) => !item.done) : [];
  const meals =
    block.type === "calorie-log"
      ? block.entries.filter((entry) => entry.date === day)
      : [];
  const total = meals.reduce((sum, entry) => sum + entry.calories, 0);
  const validCalories = /^\d+$/.test(calories) && Number(calories) <= 20000;

  return (
    <section
      aria-label={block.type === "todo-list" ? "To-do list" : "Calorie log"}
    >
      {block.type === "todo-list" ? (
        <>
          <div {...stylex.props(styles.summary)}>
            <span>
              <strong {...stylex.props(styles.number)}>{open.length}</strong> to
              do
            </span>
            <span {...stylex.props(styles.muted)}>
              {completed.length} completed
            </span>
          </div>
          <ul {...stylex.props(styles.list)}>
            {(showCompleted ? [...open, ...completed] : open).map((item) => (
              <li key={item.id} {...stylex.props(styles.row)}>
                <label {...stylex.props(styles.taskLabel)}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={locked}
                    {...stylex.props(styles.checkbox)}
                    onChange={() =>
                      void change({
                        action: "set-todo",
                        id: item.id,
                        done: !item.done,
                      })
                    }
                  />
                  <span {...stylex.props(item.done && styles.completed)}>
                    {item.label}
                  </span>
                </label>
                <Button
                  aria-label={`Delete task ${item.label}`}
                  disabled={locked}
                  onClick={() =>
                    void change({ action: "delete-todo", id: item.id })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {!open.length && (
            <p {...stylex.props(styles.muted)}>
              {block.items.length
                ? "All caught up."
                : "Start with one small task."}
            </p>
          )}
          {completed.length > 0 && (
            <Button
              onClick={() => setShowCompleted(!showCompleted)}
              aria-expanded={showCompleted}
            >
              {showCompleted
                ? "Hide completed"
                : `Show completed (${completed.length})`}
            </Button>
          )}
        </>
      ) : (
        <>
          <div {...stylex.props(styles.summary)}>
            <div>
              <strong {...stylex.props(styles.number)}>
                {total.toLocaleString()}
              </strong>{" "}
              kcal
              <div {...stylex.props(styles.muted)}>
                {meals.length} {meals.length === 1 ? "entry" : "entries"} logged
              </div>
            </div>
            <label {...stylex.props(styles.dateLabel)}>
              Day
              <input
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                aria-label="Log date"
                value={day}
                disabled={locked}
                {...stylex.props(styles.input, styles.date)}
                onChange={(event) => setDay(event.target.value)}
              />
            </label>
          </div>
          <ul {...stylex.props(styles.list)}>
            {meals.map((entry) => (
              <li key={entry.id} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.entryLabel)}>{entry.label}</span>
                <span {...stylex.props(styles.calories)}>
                  {entry.calories.toLocaleString()} kcal
                </span>
                <Button
                  aria-label={`Delete meal ${entry.label}`}
                  disabled={locked}
                  onClick={() =>
                    void change({ action: "delete-meal", id: entry.id })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {!meals.length && (
            <p {...stylex.props(styles.muted)}>No meals logged for this day.</p>
          )}
        </>
      )}
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            locked ||
            !label.trim() ||
            (block.type === "calorie-log" && (!validCalories || !day))
          )
            return;
          const id = addId ?? crypto.randomUUID();
          update(token, { addId: id });
          void change(
            block.type === "todo-list"
              ? { action: "add-todo", id, label: label.trim() }
              : {
                  action: "add-meal",
                  id,
                  label: label.trim(),
                  date: day,
                  calories: Number(calories),
                },
            true,
          );
        }}
      >
        <label htmlFor={`${fieldId}-label`} {...stylex.props(styles.field)}>
          {block.type === "todo-list" ? "New task" : "Meal or snack"}
          <input
            id={`${fieldId}-label`}
            value={label}
            maxLength={200}
            disabled={locked}
            placeholder={
              block.type === "todo-list"
                ? "What needs doing?"
                : "For example, oatmeal and fruit"
            }
            onChange={(event) => setLabel(event.target.value)}
            {...stylex.props(styles.input)}
          />
        </label>
        {block.type === "calorie-log" && (
          <label
            htmlFor={`${fieldId}-calories`}
            {...stylex.props(styles.calorieField)}
          >
            Calories
            <input
              id={`${fieldId}-calories`}
              type="number"
              inputMode="numeric"
              min={0}
              max={20000}
              step={1}
              value={calories}
              disabled={locked}
              onChange={(event) => setCalories(event.target.value)}
              {...stylex.props(styles.input)}
              placeholder="kcal"
            />
          </label>
        )}
        <Button
          type="submit"
          disabled={
            locked ||
            !label.trim() ||
            (block.type === "calorie-log" && (!validCalories || !day))
          }
          xstyle={styles.add}
        >
          {saving
            ? "Saving…"
            : block.type === "todo-list"
              ? "Add task"
              : "Log meal"}
        </Button>
      </form>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      {retry && (
        <Button
          disabled={saving}
          onClick={() =>
            void change(retry.input, retry.clearDraft, retry.input)
          }
        >
          Retry save
        </Button>
      )}
    </section>
  );
}

const styles = stylex.create({
  summary: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  number: {
    marginRight: 5,
    fontSize: 30,
    fontWeight: 500,
    letterSpacing: "-0.8px",
    color: colors.foreground,
    lineHeight: 1.1,
  },
  muted: { color: colors.muted, fontSize: 12 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingBlock: 4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  taskLabel: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    overflowWrap: "anywhere",
    cursor: "pointer",
  },
  checkbox: {
    width: 18,
    height: 18,
    accentColor: colors.accent,
    flexShrink: 0,
  },
  completed: { color: colors.muted, textDecoration: "line-through" },
  entryLabel: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  calories: {
    fontSize: 12,
    color: colors.muted,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  form: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 20,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: "1 1 180px",
    minWidth: 0,
    fontSize: 12,
    color: colors.muted,
  },
  calorieField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: "0 1 90px",
    minWidth: 70,
    fontSize: 12,
    color: colors.muted,
  },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.background,
    color: colors.foreground,
    paddingInline: 10,
    font: "inherit",
    fontSize: 16,
    outlineOffset: 3,
  },
  dateLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 11,
    color: colors.muted,
  },
  date: { width: 150, fontSize: 14 },
  add: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    minHeight: 44,
    paddingInline: 14,
  },
  error: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginBlock: 10,
  },
});

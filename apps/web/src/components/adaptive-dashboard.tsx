import * as stylex from "@stylexjs/stylex";
import { createRenderer } from "juxi/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { changeDashboardPresentation } from "../features/dashboards/functions";
import {
  DASHBOARD_FOCUS_LABELS,
  type DashboardFocus,
  type DashboardPresentation,
  type DashboardViewProps,
  dashboardFocusSchema,
  dashboardUI,
  filterDashboardWidgets,
  validateDashboardPlan,
} from "../features/dashboards/presentation";
import type {
  DashboardDataset,
  DashboardWidget as Widget,
} from "../features/dashboards/schema";
import { colors } from "../styles/tokens.stylex";
import { DashboardDataSources } from "./dashboard-data";
import { DashboardWidget } from "./dashboard-widget";
import { Button } from "./ui/button";

type DashboardContent = {
  widgets: readonly Widget[];
  datasets: readonly DashboardDataset[];
  agentName: string;
  onDiscuss: (question: string) => void;
  onWidgetChange: (widget: Widget) => void;
  onReload: () => Promise<void>;
};

const ContentContext = createContext<DashboardContent | null>(null);

function DashboardPlanView({
  focus,
  widgetKeys,
  showDataSources,
}: DashboardViewProps) {
  const content = useContext(ContentContext);
  if (!content) return null;
  return (
    <DashboardContents
      {...content}
      widgets={filterDashboardWidgets(content.widgets, focus, widgetKeys)}
      showDataSources={showDataSources}
    />
  );
}

const PlannedDashboard = createRenderer(dashboardUI, {
  DashboardView: DashboardPlanView,
});

function DashboardContents({
  widgets,
  datasets,
  agentName,
  onDiscuss,
  onWidgetChange,
  onReload,
  showDataSources = true,
}: DashboardContent & { showDataSources?: boolean }) {
  return (
    <>
      {showDataSources && datasets.length > 0 && (
        <DashboardDataSources datasets={datasets} />
      )}
      <div {...stylex.props(styles.grid)}>
        {widgets.map((widget) => (
          <DashboardWidget
            key={widget.key}
            widget={widget}
            datasets={datasets}
            agentName={agentName}
            onDiscuss={onDiscuss}
            onChange={onWidgetChange}
            onReload={onReload}
          />
        ))}
      </div>
    </>
  );
}

export function AdaptiveDashboard({
  agentId,
  presentation,
  onPresentation,
  ...content
}: DashboardContent & {
  agentId: string;
  presentation: DashboardPresentation;
  onPresentation: (value: DashboardPresentation) => void;
  onReload: () => Promise<void>;
}) {
  const onReload = content.onReload;
  const [intent, setIntent] = useState("");
  const [describing, setDescribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<{
    text: string;
    revision: number;
  } | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  async function change(input: { focus: DashboardFocus } | { intent: string }) {
    const current = ++request.current;
    setSaving(true);
    setError(null);
    setOperationNotice(null);
    try {
      const result = await changeDashboardPresentation({
        data: {
          agentId,
          revision: presentation.revision,
          ...input,
        },
      });
      if (request.current !== current) return;
      if (result.ok) {
        onPresentation(result.value);
        if (result.value.notice)
          setOperationNotice({
            text: result.value.notice,
            revision: result.value.revision,
          });
        if (!result.value.notice) {
          setIntent("");
          setDescribing(false);
        }
      } else {
        setError(result.error);
      }
      // Refresh both data and revision after a save or conflict. Never reuse a stale plan.
      await onReload();
    } catch {
      if (request.current === current)
        setError(
          "Could not change this view. Your dashboard is still here. Try again.",
        );
    } finally {
      if (request.current === current) setSaving(false);
    }
  }

  const plan =
    presentation.plan &&
    validateDashboardPlan(presentation.plan, content.widgets, content.datasets);
  const invalidPlan = presentation.plan && !plan;
  const selectedWidget =
    plan && presentation.widgetKey
      ? content.widgets.find((widget) => widget.key === presentation.widgetKey)
      : null;
  const notice = invalidPlan
    ? "This view needs refreshing. Showing your complete dashboard."
    : (presentation.notice ??
      (operationNotice?.revision === presentation.revision
        ? operationNotice.text
        : null));
  const ordinary = <DashboardContents {...content} />;
  return (
    <ContentContext value={content}>
      {(presentation.availableFocus.length > 1 ||
        presentation.canAdapt ||
        presentation.widgetKey) && (
        <div {...stylex.props(styles.toolbar)}>
          <div {...stylex.props(styles.controls)}>
            <label htmlFor="dashboard-focus" {...stylex.props(styles.label)}>
              View
            </label>
            <select
              id="dashboard-focus"
              value={presentation.focus ?? "all"}
              disabled={saving}
              {...stylex.props(styles.select)}
              onChange={(event) => {
                const focus = dashboardFocusSchema.safeParse(
                  event.target.value,
                );
                if (focus.success) void change({ focus: focus.data });
              }}
            >
              {presentation.availableFocus.map((focus) => (
                <option key={focus} value={focus}>
                  {DASHBOARD_FOCUS_LABELS[focus]}
                </option>
              ))}
            </select>
            {presentation.canAdapt && (
              <Button
                disabled={saving}
                aria-expanded={describing}
                aria-controls="dashboard-intent"
                onClick={() => setDescribing(!describing)}
              >
                Describe a view
              </Button>
            )}
            {presentation.focus !== null && (
              <Button
                disabled={saving}
                onClick={() => void change({ intent: "" })}
              >
                Reset view
              </Button>
            )}
            {saving && (
              <span role="status" {...stylex.props(styles.status)}>
                Updating view…
              </span>
            )}
          </div>
          {describing && presentation.canAdapt && (
            <form
              id="dashboard-intent"
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault();
                if (intent.trim() && !saving)
                  void change({ intent: intent.trim() });
              }}
            >
              <label
                htmlFor="dashboard-intent-text"
                {...stylex.props(styles.intentLabel)}
              >
                What would you like to see?
              </label>
              <div {...stylex.props(styles.inputRow)}>
                <input
                  id="dashboard-intent-text"
                  value={intent}
                  maxLength={500}
                  disabled={saving}
                  onChange={(event) => setIntent(event.target.value)}
                  {...stylex.props(styles.input)}
                  placeholder="Show my garden progress, or the launch checklist…"
                />
                <Button
                  type="submit"
                  disabled={saving || !intent.trim()}
                  xstyle={styles.submit}
                >
                  Show view
                </Button>
              </div>
            </form>
          )}
          {presentation.intent && (
            <p {...stylex.props(styles.intent)}>For “{presentation.intent}”</p>
          )}
          {selectedWidget && (
            <p {...stylex.props(styles.intent)}>
              Showing {selectedWidget.title}. Reset to see all trackers.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.notice)}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" {...stylex.props(styles.notice)}>
          {notice}
        </p>
      )}
      {plan ? (
        <PlannedDashboard plan={plan} errorFallback={ordinary} />
      ) : (
        ordinary
      )}
    </ContentContext>
  );
}

const styles = stylex.create({
  toolbar: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  controls: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 },
  label: { color: colors.muted, fontSize: 12 },
  select: {
    fontFamily: "inherit",
    fontSize: 13,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    paddingInline: 10,
    minHeight: { default: 32, "@media (max-width: 700px)": 44 },
    maxWidth: "100%",
    outlineOffset: 3,
  },
  status: { fontSize: 12, color: colors.muted },
  form: { marginTop: 16, maxWidth: 580 },
  intentLabel: {
    display: "block",
    fontSize: 13,
    marginBottom: 8,
    color: colors.foreground,
  },
  inputRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  input: {
    flex: "1 1 180px",
    minWidth: 0,
    font: "inherit",
    fontSize: 16,
    minHeight: 44,
    boxSizing: "border-box",
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    paddingInline: 12,
    outlineOffset: 3,
  },
  submit: {
    minHeight: 44,
    paddingInline: 12,
    backgroundColor: colors.accent,
    color: colors.onAccent,
  },
  intent: {
    marginTop: 12,
    marginBottom: 0,
    fontSize: 12,
    color: colors.muted,
    overflowWrap: "anywhere",
  },
  notice: {
    fontSize: 13,
    lineHeight: 1.6,
    color: colors.muted,
    marginBlock: 12,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
    gap: 20,
    alignItems: "start",
  },
});

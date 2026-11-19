import * as stylex from "@stylexjs/stylex";
import { createRenderer } from "juxi/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { changeDashboardPresentation } from "../features/dashboards/functions";
import {
  DASHBOARD_FOCUS_LABELS,
  type DashboardFocus,
  type DashboardPresentation,
  type DashboardViewProps,
  dashboardUI,
  filterDashboardWidgets,
  validateDashboardPlan,
} from "../features/dashboards/presentation";
import type {
  DashboardDataset,
  DashboardWidget as Widget,
} from "../features/dashboards/schema";
import { colors, radii } from "../styles/tokens.stylex";
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
  inline?: boolean;
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
  inline,
  showDataSources = true,
}: DashboardContent & { showDataSources?: boolean }) {
  return (
    <>
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
            inline={inline}
          />
        ))}
      </div>
      {showDataSources && datasets.length > 0 && (
        <DashboardDataSources datasets={datasets} />
      )}
    </>
  );
}

/** Render a validated authored plan without the dashboard's global view controls. */
export function DashboardPlanContent({
  plan,
  ...content
}: DashboardContent & { plan: DashboardPresentation["plan"] }) {
  const valid =
    plan && validateDashboardPlan(plan, content.widgets, content.datasets);
  const ordinary = <DashboardContents {...content} showDataSources={false} />;
  return (
    <ContentContext value={content}>
      {valid ? (
        <PlannedDashboard plan={valid} errorFallback={ordinary} />
      ) : (
        ordinary
      )}
    </ContentContext>
  );
}

export function AdaptiveDashboard({
  agentId,
  presentation,
  onPresentation,
  actions,
  ...content
}: DashboardContent & {
  agentId: string;
  /** Page-level buttons, such as Add tracker, that share the toolbar row. */
  actions?: ReactNode;
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
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.controls)}>
          {presentation.availableFocus.length > 1 && (
            <div
              role="radiogroup"
              aria-label="View"
              {...stylex.props(styles.pills)}
            >
              {presentation.availableFocus.map((focus) => {
                const checked = (presentation.focus ?? "all") === focus;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: Pill buttons read better than native radios here and keep radio semantics.
                  <button
                    key={focus}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={saving}
                    onClick={() => {
                      if (!checked) void change({ focus });
                    }}
                    {...stylex.props(styles.pill, checked && styles.pillOn)}
                  >
                    {DASHBOARD_FOCUS_LABELS[focus]}
                  </button>
                );
              })}
            </div>
          )}
          {presentation.canAdapt && (
            <button
              type="button"
              disabled={saving}
              aria-expanded={describing}
              aria-controls="dashboard-intent"
              onClick={() => setDescribing(!describing)}
              {...stylex.props(styles.pill, styles.describe)}
            >
              Describe a view
            </button>
          )}
          {presentation.focus !== null && (
            <Button
              size="sm"
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
          <span {...stylex.props(styles.spacer)} />
          {actions}
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
      </div>
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
  toolbar: { marginBottom: 22 },
  controls: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  pills: { display: "flex", flexWrap: "wrap", gap: 6 },
  pill: {
    font: "inherit",
    fontSize: 13,
    minHeight: { default: 32, "@media (max-width: 700px)": 40 },
    paddingInline: 14,
    borderRadius: radii.full,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: {
      default: colors.background,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.bubble },
    },
    color: colors.foreground,
    cursor: { default: "pointer", ":disabled": "default" },
    outlineOffset: 2,
  },
  pillOn: {
    borderColor: colors.action,
    backgroundColor: {
      default: colors.action,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.action },
    },
    color: colors.onAccent,
  },
  describe: {
    borderStyle: "dashed",
    borderColor: colors.faint,
    backgroundColor: {
      default: "transparent",
      "@media (hover: hover)": { ":not(:disabled):hover": colors.bubble },
    },
    color: colors.muted,
  },
  spacer: { flex: 1 },
  status: { fontSize: 12, color: colors.muted },
  form: { flexBasis: "100%", order: 2, marginTop: 8, maxWidth: 580 },
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
    flexBasis: "100%",
    order: 2,
    marginTop: 4,
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
  // Each widget is a full-width section; its blocks form the tile grid.
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: 40,
  },
});

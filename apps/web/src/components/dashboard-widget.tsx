// biome-ignore-all lint/suspicious/noArrayIndexKey: Read-only report snapshots allow duplicate labels and cells, with no editable row state to preserve.
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  DashboardBlock,
  DashboardDataset,
  DashboardWidget as Widget,
} from "../features/dashboards/schema";
import { colors, radii } from "../styles/tokens.stylex";
import { MessageContent } from "./conversation/message-content";
import { DashboardChart } from "./dashboard-chart";
import { SvgChart, seriesColors, useElementWidth } from "./dashboard-svg-chart";
import { DashboardTracker } from "./dashboard-tracker";
import { DashboardWeather } from "./dashboard-weather";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cardStyles } from "./ui/card";

type Tone = "neutral" | "positive" | "attention";
type Metric = Extract<DashboardBlock, { type: "metrics" }>["items"][number];
type StatusItem = Extract<
  DashboardBlock,
  { type: "item-status" }
>["items"][number];

const TABLE_PREVIEW_ROWS = 6;

function Chart({
  block,
}: {
  block: Extract<DashboardBlock, { type: "chart" }>;
}) {
  const [container, width] = useElementWidth();
  return (
    <figure {...stylex.props(styles.figure)}>
      <figcaption {...stylex.props(styles.tileTitle)}>{block.title}</figcaption>
      <div ref={container}>
        {width > 0 && (
          <SvgChart
            title={block.title}
            style={block.style}
            width={width}
            labels={block.points.map((point) => point.label)}
            series={[
              {
                label: block.title,
                values: block.points.map((point) => point.value),
              },
            ]}
          />
        )}
      </div>
    </figure>
  );
}

function Sparkline({ values }: { values: readonly (number | null)[] }) {
  const numbers = values.filter((value) => value !== null);
  const min = Math.min(...numbers);
  const range = Math.max(...numbers) - min || 1;
  const segments: string[][] = [[]];
  values.forEach((value, index) => {
    if (value === null) segments.push([]);
    else
      segments
        .at(-1)
        ?.push(
          `${(index / (values.length - 1)) * 100},${26 - ((value - min) / range) * 24}`,
        );
  });
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      {...stylex.props(styles.sparkline)}
    >
      {segments
        .filter((segment) => segment.length > 1)
        .map((segment, index) => (
          <polyline
            key={index}
            points={segment.join(" ")}
            fill="none"
            stroke={seriesColors[0]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}

function Stat({ item }: { item: Metric }) {
  // Placeholder text such as "No entries yet" should not shout like a number.
  const numeric = /\d/.test(item.value);
  const percent = item.progress
    ? Math.min(100, (item.progress.value / item.progress.target) * 100)
    : null;
  return (
    <div
      {...stylex.props(
        cardStyles.card,
        styles.stat,
        item.tone === "attention" && styles.attention,
      )}
    >
      <dt {...stylex.props(styles.statLabel)}>{item.label}</dt>
      <dd
        {...stylex.props(styles.statValue, !numeric && styles.statPlaceholder)}
      >
        {item.value}
      </dd>
      {percent !== null && (
        <dd {...stylex.props(styles.flush)}>
          <div
            // The value and note already say this; the bar is a visual summary.
            aria-hidden="true"
            {...stylex.props(styles.track)}
          >
            <div
              {...stylex.props(
                styles.fill,
                item.tone === "attention" && styles.fillAttention,
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </dd>
      )}
      {item.trend?.some((value) => value !== null) && (
        <dd {...stylex.props(styles.flush)}>
          <Sparkline values={item.trend} />
        </dd>
      )}
      {item.note && (
        <dd
          {...stylex.props(
            styles.statNote,
            item.tone === "attention" && styles.attentionText,
          )}
        >
          {item.note}
        </dd>
      )}
    </div>
  );
}

function TableBlock({
  block,
}: {
  block: Extract<DashboardBlock, { type: "table" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? block.rows : block.rows.slice(0, TABLE_PREVIEW_ROWS);
  return (
    <>
      <div {...stylex.props(styles.tableScroll)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  {...stylex.props(styles.cell, styles.headCell)}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column} {...stylex.props(styles.cell)}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!block.rows.length && (
        <p {...stylex.props(styles.empty)}>Nothing recorded yet.</p>
      )}
      {block.rows.length > TABLE_PREVIEW_ROWS && (
        <Button
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          xstyle={styles.more}
        >
          {expanded ? "Show fewer" : `Show all ${block.rows.length} rows`}
        </Button>
      )}
    </>
  );
}

function NoteBlock({ text }: { text: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () =>
      setOverflows(element.scrollHeight > element.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div
        ref={content}
        {...stylex.props(
          styles.note,
          !expanded && styles.clamped,
          !expanded && overflows && styles.faded,
        )}
      >
        <MessageContent>{text}</MessageContent>
      </div>
      {(overflows || expanded) && (
        <Button
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          xstyle={styles.more}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}

function TasksBlock({
  block,
}: {
  block: Extract<DashboardBlock, { type: "tasks" }>;
}) {
  const done = block.items.filter((item) => item.status === "done").length;
  return (
    <>
      <div {...stylex.props(styles.taskSummary)}>
        <span>
          <strong {...stylex.props(styles.taskCount)}>{done}</strong> of{" "}
          {block.items.length} done
        </span>
      </div>
      <div aria-hidden="true" {...stylex.props(styles.track)}>
        <div
          {...stylex.props(styles.fill)}
          style={{ width: `${(done / block.items.length) * 100}%` }}
        />
      </div>
      <ul {...stylex.props(styles.tasks)}>
        {block.items.map((item, index) => (
          <li key={index} {...stylex.props(styles.task)}>
            <span aria-hidden="true" {...stylex.props(styles.taskMark)}>
              {item.status === "done"
                ? "✓"
                : item.status === "doing"
                  ? "◐"
                  : "○"}
            </span>
            <span {...stylex.props(item.status === "done" && styles.completed)}>
              {item.label}
            </span>
            <span {...stylex.props(styles.taskStatus)}>
              {item.status === "todo"
                ? "To do"
                : item.status === "doing"
                  ? "In progress"
                  : "Done"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const badgeVariant = {
  neutral: "secondary",
  positive: "accent",
  attention: "destructive",
} as const;

function StatusCard({ item }: { item: StatusItem }) {
  const tone: Tone = item.tone ?? "neutral";
  return (
    <article
      aria-label={item.label}
      {...stylex.props(
        cardStyles.card,
        styles.tile,
        tone === "attention" && styles.attention,
      )}
    >
      <div {...stylex.props(styles.statusHeader)}>
        <div {...stylex.props(styles.grow)}>
          <h3 {...stylex.props(styles.tileTitle, styles.flush)}>
            {item.label}
          </h3>
          {item.detail && <p {...stylex.props(styles.detail)}>{item.detail}</p>}
        </div>
        {item.value && (
          <span {...stylex.props(styles.statusValue)}>{item.value}</span>
        )}
      </div>
      <Badge variant={badgeVariant[tone]} xstyle={styles.statusBadge}>
        {item.status}
      </Badge>
      <ol
        aria-label="Progress"
        {...stylex.props(styles.steps)}
        style={{
          gridTemplateColumns: `repeat(${item.steps.length}, minmax(0, 1fr))`,
        }}
      >
        {item.steps.map((step, index) => (
          <li
            key={index}
            aria-current={index === item.current ? "step" : undefined}
          >
            <div
              {...stylex.props(
                styles.stepBar,
                index <= item.current && styles.stepReached,
                index <= item.current &&
                  tone === "attention" &&
                  index === item.current &&
                  styles.fillAttention,
              )}
            />
            <div
              {...stylex.props(
                styles.stepLabel,
                index <= item.current && styles.stepLabelReached,
              )}
            >
              {step.label}
              {index <= item.current && (
                <span {...stylex.props(styles.visuallyHidden)}>
                  {index === item.current ? " (current)" : " (done)"}
                </span>
              )}
            </div>
            {step.note && (
              <div {...stylex.props(styles.stepNote)}>{step.note}</div>
            )}
          </li>
        ))}
      </ol>
      {item.note && <p {...stylex.props(styles.statusNote)}>{item.note}</p>}
      {item.links && item.links.length > 0 && (
        <div {...stylex.props(styles.statusLinks)}>
          {item.links.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.link)}
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function Block({
  block,
  datasets,
  widget,
  onChange,
  onReload,
}: {
  block: DashboardBlock;
  datasets: readonly DashboardDataset[];
  widget: Widget;
  onChange: (widget: Widget) => void;
  onReload: () => Promise<void>;
}) {
  switch (block.type) {
    case "weather":
      return (
        <DashboardWeather
          block={block}
          widget={widget}
          onChange={onChange}
          onReload={onReload}
        />
      );
    case "todo-list":
    case "calorie-log":
      return (
        <DashboardTracker
          block={block}
          widget={widget}
          onChange={onChange}
          onReload={onReload}
        />
      );
    case "markdown":
      return <NoteBlock text={block.text} />;
    case "metrics":
      return (
        <dl {...stylex.props(styles.stats)}>
          {block.items.map((item, index) => (
            <Stat key={index} item={item} />
          ))}
        </dl>
      );
    case "item-status":
      return (
        <div {...stylex.props(styles.statusGrid)}>
          {block.items.map((item, index) => (
            <StatusCard key={index} item={item} />
          ))}
        </div>
      );
    case "table":
      return <TableBlock block={block} />;
    case "dataset-chart":
      return (
        <DashboardChart
          chart={block}
          dataset={datasets.find((dataset) => dataset.key === block.datasetKey)}
        />
      );
    case "chart":
      return <Chart block={block} />;
    case "links":
      return (
        <ul {...stylex.props(styles.links)}>
          {block.items.map((item, index) => (
            <li key={index}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                {...stylex.props(styles.link)}
              >
                {item.label} ↗
              </a>
            </li>
          ))}
        </ul>
      );
    case "tasks":
      return <TasksBlock block={block} />;
  }
}

/** How a block sits on the board: its own card, full width, or both. */
function placement(block: DashboardBlock) {
  switch (block.type) {
    case "metrics":
    case "item-status":
      // These draw their own cards so each item reads as a separate tile.
      return { card: false, wide: true };
    case "table":
      return {
        card: true,
        wide: block.columns.length > 3 && !!block.rows.length,
      };
    default:
      return { card: true, wide: false };
  }
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(timestamp: number, now: number) {
  const minutes = Math.round((timestamp - now) / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, "day");
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Rendered after hydration so the server's clock and time zone never leak in.
function Updated({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      title={now === null ? undefined : new Date(timestamp).toLocaleString()}
      {...stylex.props(styles.updated)}
    >
      {now === null ? "Updated" : `Updated ${relativeTime(timestamp, now)}`}
    </time>
  );
}

export function DashboardWidget({
  widget,
  agentName,
  onDiscuss,
  datasets = [],
  onChange,
  onReload,
  inline = false,
}: {
  widget: Widget;
  datasets?: readonly DashboardDataset[];
  agentName: string;
  onDiscuss: (question: string) => void;
  onChange: (widget: Widget) => void;
  onReload: () => Promise<void>;
  inline?: boolean;
}) {
  return (
    <article
      {...stylex.props(styles.widget, inline && styles.inlineWidget)}
      aria-label={widget.title}
    >
      <header {...stylex.props(styles.header)}>
        <h2 {...stylex.props(styles.title, inline && styles.inlineTitle)}>
          {widget.title}
        </h2>
        <Updated timestamp={widget.updatedAt} />
        <span {...stylex.props(styles.grow)} />
        {!inline && (
          <Button
            size="sm"
            xstyle={styles.discuss}
            onClick={() =>
              onDiscuss(
                `Give me a brief update on the "${widget.title}" dashboard (key: ${widget.key}), including unfinished tasks and suggested next steps. Read the current dashboard data first.`,
              )
            }
          >
            Discuss with {agentName}
          </Button>
        )}
      </header>
      <div {...stylex.props(styles.board, inline && styles.inlineBoard)}>
        {widget.blocks.map((block, index) => {
          const { card, wide } = placement(block);
          const key =
            "id" in block
              ? `interactive:${block.type}:${block.id}`
              : `static:${index}`;
          const content: ReactNode = (
            <Block
              block={block}
              datasets={datasets}
              widget={widget}
              onChange={onChange}
              onReload={onReload}
            />
          );
          return (
            <div
              key={key}
              {...stylex.props(
                styles.slot,
                wide && styles.wide,
                card && cardStyles.card,
                card && styles.tile,
              )}
            >
              {content}
            </div>
          );
        })}
      </div>
      {inline && (
        <footer {...stylex.props(styles.footer)}>
          <span>Live tracker · changes save to Dashboard</span>
          <Link
            to="/agents/$agentId/dashboard"
            params={{ agentId: widget.agentId }}
            {...stylex.props(styles.link)}
          >
            Open dashboard
          </Link>
        </footer>
      )}
    </article>
  );
}

const styles = stylex.create({
  widget: { minWidth: 0 },
  inlineWidget: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 14,
    backgroundColor: colors.background,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    marginBottom: 14,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.3px",
    overflowWrap: "anywhere",
  },
  inlineTitle: { fontSize: 15 },
  updated: { fontSize: 12, color: colors.muted },
  grow: { flex: 1, minWidth: 0 },
  discuss: { color: colors.accent },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
    gap: 14,
  },
  inlineBoard: { gridTemplateColumns: "minmax(0, 1fr)", gap: 10 },
  slot: { minWidth: 0, fontSize: 13, lineHeight: 1.6 },
  wide: { gridColumn: "1 / -1" },
  tile: { padding: { default: 18, "@media (max-width: 700px)": 14 } },
  tileTitle: { margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 600 },
  flush: { margin: 0 },
  empty: { margin: 0, marginTop: 10, color: colors.muted },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
    gap: 14,
    margin: 0,
  },
  stat: {
    paddingBlock: 14,
    paddingInline: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  statLabel: { fontSize: 12, color: colors.muted },
  statValue: {
    margin: 0,
    fontSize: 26,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: "-0.6px",
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },
  statPlaceholder: {
    fontSize: 15,
    fontWeight: 500,
    letterSpacing: 0,
    color: colors.muted,
    paddingBlock: 5,
  },
  statNote: { margin: 0, fontSize: 12, color: colors.muted, lineHeight: 1.5 },
  attention: {
    borderColor: `color-mix(in srgb, ${colors.review} 35%, ${colors.border})`,
    backgroundColor: `color-mix(in srgb, ${colors.review} 7%, ${colors.surface})`,
  },
  attentionText: { color: colors.review },
  track: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.bubble,
    overflow: "hidden",
    marginTop: 4,
  },
  fill: {
    height: "100%",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  fillAttention: { backgroundColor: colors.review },
  sparkline: { display: "block", width: "100%", height: 28, marginTop: 4 },
  note: { position: "relative", overflowWrap: "anywhere" },
  clamped: { maxHeight: "10.5em", overflow: "hidden" },
  faded: {
    maskImage: "linear-gradient(to bottom, black 65%, transparent)",
  },
  more: {
    alignSelf: "flex-start",
    marginTop: 8,
    marginLeft: -8,
    color: colors.accent,
  },
  tableScroll: { overflowX: "auto", maxWidth: "100%" },
  table: {
    // Wide tables scroll sideways instead of crushing columns to a word each.
    width: "max-content",
    minWidth: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    textAlign: "left",
  },
  cell: {
    paddingBlock: 8,
    paddingRight: 16,
    minWidth: 72,
    maxWidth: 280,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    fontWeight: 400,
    verticalAlign: "top",
  },
  headCell: { color: colors.muted, fontSize: 12, fontWeight: 500 },
  figure: { margin: 0 },
  links: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 },
  link: { color: colors.accent, textUnderlineOffset: 3 },
  taskSummary: { marginBottom: 2, color: colors.muted },
  taskCount: {
    fontSize: 26,
    fontWeight: 600,
    letterSpacing: "-0.6px",
    color: colors.foreground,
    marginRight: 4,
  },
  tasks: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    marginTop: 14,
    display: "grid",
    gap: 10,
  },
  task: { display: "flex", alignItems: "baseline", gap: 8 },
  taskMark: { color: colors.accent, width: 14, flexShrink: 0 },
  taskStatus: {
    marginLeft: "auto",
    fontSize: 11,
    color: colors.muted,
    whiteSpace: "nowrap",
  },
  completed: { color: colors.muted, textDecoration: "line-through" },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
    gap: 14,
  },
  statusHeader: { display: "flex", alignItems: "flex-start", gap: 12 },
  detail: { margin: 0, marginTop: -8, fontSize: 12, color: colors.muted },
  statusValue: { fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" },
  statusBadge: { alignSelf: "flex-start", marginTop: 12, fontSize: 11.5 },
  steps: {
    listStyle: "none",
    margin: 0,
    marginTop: 16,
    padding: 0,
    display: "grid",
    gap: 6,
  },
  stepBar: {
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.bubble,
  },
  stepReached: { backgroundColor: colors.accent },
  stepLabel: { fontSize: 12, marginTop: 8, color: colors.muted },
  stepLabelReached: { color: colors.foreground, fontWeight: 500 },
  stepNote: { fontSize: 11.5, color: colors.muted, lineHeight: 1.4 },
  statusNote: { margin: 0, marginTop: 14, fontSize: 13, lineHeight: 1.6 },
  statusLinks: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 10,
    fontSize: 13,
  },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    fontSize: 11,
    color: colors.muted,
    marginTop: 12,
  },
});

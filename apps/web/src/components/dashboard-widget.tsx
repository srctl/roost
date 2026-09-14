// biome-ignore-all lint/suspicious/noArrayIndexKey: Read-only report snapshots allow duplicate labels and cells, with no editable row state to preserve.
import * as stylex from "@stylexjs/stylex";
import type {
  DashboardBlock,
  DashboardDataset,
  DashboardWidget as Widget,
} from "../features/dashboards/schema";
import { colors } from "../styles/tokens.stylex";
import { MessageContent } from "./conversation/message-content";
import { DashboardChart } from "./dashboard-chart";
import { Button } from "./ui/button";

function Chart({
  block,
}: {
  block: Extract<DashboardBlock, { type: "chart" }>;
}) {
  const min = Math.min(0, ...block.points.map((point) => point.value));
  const max = Math.max(0, ...block.points.map((point) => point.value));
  const range = max - min || 1;
  const y = (value: number) => 150 - ((value - min) / range) * 130;

  const x = (index: number) =>
    block.points.length === 1
      ? 230
      : 50 + (index / (block.points.length - 1)) * 380;
  const width = Math.min(30, 340 / block.points.length);
  const axisLabel = (label: string) =>
    label.length > 20 ? `${label.slice(0, 19)}…` : label;
  return (
    <figure {...stylex.props(styles.figure)}>
      <figcaption {...stylex.props(styles.chartTitle)}>
        {block.title}
      </figcaption>
      <svg
        role="img"
        aria-label={`${block.title}: ${block.points.map((point) => `${point.label}: ${point.value}`).join(", ")}`}
        viewBox="0 0 460 185"
        {...stylex.props(styles.chart)}
      >
        <line
          x1="50"
          x2="430"
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          opacity="0.2"
        />
        <text x="42" y="24" textAnchor="end" fontSize="9" fill="currentColor">
          {new Intl.NumberFormat("en", { notation: "compact" }).format(max)}
        </text>
        <text x="42" y="153" textAnchor="end" fontSize="9" fill="currentColor">
          {new Intl.NumberFormat("en", { notation: "compact" }).format(min)}
        </text>
        {block.style === "line" && (
          <polyline
            points={block.points
              .map((point, index) => `${x(index)},${y(point.value)}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {block.points.map((point, index) =>
          block.style === "bar" ? (
            <rect
              key={index}
              x={x(index) - width / 2}
              y={Math.min(y(0), y(point.value))}
              width={width}
              height={Math.max(1, Math.abs(y(point.value) - y(0)))}
              rx="2"
              fill="currentColor"
            >
              <title>
                {point.label}: {point.value}
              </title>
            </rect>
          ) : (
            <circle
              key={index}
              cx={x(index)}
              cy={y(point.value)}
              r="2.5"
              fill="currentColor"
            >
              <title>
                {point.label}: {point.value}
              </title>
            </circle>
          ),
        )}
        <text x="50" y="175" fontSize="10" fill="currentColor">
          {axisLabel(block.points[0]?.label ?? "")}
        </text>
        {block.points.length > 1 && (
          <text
            x="430"
            y="175"
            textAnchor="end"
            fontSize="10"
            fill="currentColor"
          >
            {axisLabel(block.points.at(-1)?.label ?? "")}
          </text>
        )}
      </svg>
      <details {...stylex.props(styles.values)}>
        <summary>View values</summary>
        <table {...stylex.props(styles.table)}>
          <tbody>
            {block.points.map((point, index) => (
              <tr key={index}>
                <th scope="row" {...stylex.props(styles.cell)}>
                  {point.label}
                </th>
                <td {...stylex.props(styles.cell)}>{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Block({
  block,
  datasets,
}: {
  block: DashboardBlock;
  datasets: readonly DashboardDataset[];
}) {
  switch (block.type) {
    case "markdown":
      return <MessageContent>{block.text}</MessageContent>;
    case "metrics":
      return (
        <dl {...stylex.props(styles.metrics)}>
          {block.items.map((item, index) => (
            <div key={index}>
              <dt {...stylex.props(styles.metricLabel)}>{item.label}</dt>
              <dd {...stylex.props(styles.metricValue)}>{item.value}</dd>
              {item.note && (
                <dd {...stylex.props(styles.metricNote)}>{item.note}</dd>
              )}
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div {...stylex.props(styles.tableScroll)}>
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index} scope="col" {...stylex.props(styles.cell)}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
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
      );
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
      return (
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
              <span
                {...stylex.props(item.status === "done" && styles.completed)}
              >
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
      );
  }
}

export function DashboardWidget({
  widget,
  agentName,
  onDiscuss,
  datasets = [],
}: {
  widget: Widget;
  datasets?: readonly DashboardDataset[];
  agentName: string;
  onDiscuss: () => void;
}) {
  return (
    <article {...stylex.props(styles.widget)} aria-label={widget.title}>
      <header {...stylex.props(styles.header)}>
        <h2 {...stylex.props(styles.title)}>{widget.title}</h2>
      </header>
      <div {...stylex.props(styles.blocks)}>
        {widget.blocks.map((block, index) => (
          <Block key={index} block={block} datasets={datasets} />
        ))}
      </div>
      <footer {...stylex.props(styles.footer)}>
        <time dateTime={new Date(widget.updatedAt).toISOString()}>
          Updated{" "}
          {new Date(widget.updatedAt)
            .toISOString()
            .replace("T", " ")
            .slice(0, 16)}{" "}
          UTC
        </time>
        <Button onClick={onDiscuss}>Discuss with {agentName}</Button>
      </footer>
    </article>
  );
}

const styles = stylex.create({
  widget: {
    minWidth: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 12,
    padding: { default: 22, "@media (max-width: 700px)": 16 },
    backgroundColor: colors.surface,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },
  title: { margin: 0, fontSize: 17, fontWeight: 500, overflowWrap: "anywhere" },
  blocks: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    fontSize: 13,
    lineHeight: 1.65,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    fontSize: 10,
    color: colors.muted,
    marginTop: 28,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    gap: 20,
    margin: 0,
  },
  metricLabel: { fontSize: 11, color: colors.muted },
  metricValue: {
    fontSize: 26,
    lineHeight: 1.3,
    margin: 0,
    marginTop: 4,
    letterSpacing: "-0.5px",
    overflowWrap: "anywhere",
  },
  metricNote: { margin: 0, marginTop: 6, fontSize: 11, color: colors.muted },
  tableScroll: { overflowX: "auto", maxWidth: "100%" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    textAlign: "left",
  },
  cell: {
    paddingBlock: 7,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    fontWeight: 400,
    verticalAlign: "top",
  },
  figure: { margin: 0 },
  chartTitle: { fontSize: 12, marginBottom: 8 },
  chart: {
    display: "block",
    width: "100%",
    color: colors.accent,
    overflow: "visible",
  },
  values: { fontSize: 10, color: colors.muted },
  links: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 },
  link: { color: "inherit", textUnderlineOffset: 3 },
  tasks: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 },
  task: { display: "flex", alignItems: "baseline", gap: 8 },
  taskMark: { color: colors.accent, width: 14, flexShrink: 0 },
  taskStatus: {
    marginLeft: "auto",
    fontSize: 10,
    color: colors.muted,
    whiteSpace: "nowrap",
  },
  completed: { color: colors.muted, textDecoration: "line-through" },
});

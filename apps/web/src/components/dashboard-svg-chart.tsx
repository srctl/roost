// biome-ignore-all lint/suspicious/noArrayIndexKey: Chart marks are positional and never reordered.
import * as stylex from "@stylexjs/stylex";
import { type RefObject, useEffect, useRef, useState } from "react";
import { colors, fonts } from "../styles/tokens.stylex";

export type ChartSeries = {
  label: string;
  values: readonly (number | null)[];
};

export type ChartGoal = { min: number; max?: number; label?: string };

// Theme-derived so every preset and manual light/dark mode stays legible.
export const seriesColors = [
  colors.accent,
  colors.review,
  colors.action,
  colors.muted,
];

/** Tracks an element's content width so SVG charts draw at true pixel size. */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T | null>,
  number,
] {
  const element = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const current = element.current;
    if (!current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)),
    );
    observer.observe(current);
    return () => observer.disconnect();
  }, []);
  return [element, width];
}

const HEIGHT = 200;
const TOP = 14;
const BOTTOM = 26;
const LEFT = 40;
const RIGHT = 8;

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function niceStep(range: number, count: number) {
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
  );
}

/** Shortens ISO dates such as 2026-11-18 to "Nov 18"; other labels pass through. */
export function axisLabel(label: string) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (date) {
    const value = new Date(
      Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])),
    );
    return value.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

// Every `every`th label, plus the last one when it will not crowd its neighbour.
function showLabel(index: number, count: number, every: number) {
  if (index % every === 0)
    return count - 1 - index >= every || index === count - 1 || every === 1;
  return index === count - 1;
}

export function SvgChart({
  title,
  labels,
  series,
  style,
  goal,
  width,
}: {
  title: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  style: "line" | "area" | "bar" | "stacked-bar";
  goal?: ChartGoal;
  width: number;
}) {
  const stacked = style === "stacked-bar";
  const totals = labels.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const values = [
    ...(stacked
      ? totals
      : series.flatMap((item) =>
          item.values.filter((value) => value !== null),
        )),
    ...(goal ? [goal.min, goal.max ?? goal.min] : []),
  ];
  const step = niceStep(
    Math.max(...values, 0) - Math.min(...values, 0) || 1,
    3,
  );
  const min = Math.floor(Math.min(0, ...values) / step) * step;
  const max = Math.ceil(Math.max(0, ...values) / step) * step || step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick);
  const plotWidth = Math.max(120, width - LEFT - RIGHT);
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const y = (value: number) =>
    TOP + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const band = plotWidth / Math.max(1, labels.length);
  const center = (index: number) =>
    style === "line" || style === "area"
      ? labels.length === 1
        ? LEFT + plotWidth / 2
        : LEFT + (index / (labels.length - 1)) * plotWidth
      : LEFT + band * index + band / 2;
  const labelCount = Math.max(2, Math.floor(plotWidth / 72));
  const every = Math.max(1, Math.ceil(labels.length / labelCount));
  const zero = y(Math.max(min, Math.min(0, max)));
  const groups = stacked ? 1 : series.length;
  const barWidth = Math.max(
    2,
    Math.min(28, (band * 0.72) / groups - (groups > 1 ? 2 : 0)),
  );
  const missing = labels.map((_, index) =>
    series.every((item) => item.values[index] === null),
  );
  const description = `${title}. ${labels
    .map(
      (label, index) =>
        `${label}: ${series
          .map(
            (item) =>
              `${series.length > 1 ? `${item.label} ` : ""}${
                item.values[index] === null
                  ? "not recorded"
                  : full.format(item.values[index] ?? 0)
              }`,
          )
          .join(", ")}`,
    )
    .join("; ")}${
    goal
      ? `. Goal ${full.format(goal.min)}${goal.max === undefined ? "" : `–${full.format(goal.max)}`}`
      : ""
  }`;

  return (
    <div>
      {(series.length > 1 || goal || missing.some(Boolean)) && (
        <ul {...stylex.props(styles.legend)}>
          {series.length > 1 &&
            series.map((item, index) => (
              <li key={item.label} {...stylex.props(styles.legendItem)}>
                <span
                  aria-hidden="true"
                  {...stylex.props(styles.swatch)}
                  style={{ background: seriesColors[index] }}
                />
                {item.label}
              </li>
            ))}
          {goal && (
            <li {...stylex.props(styles.legendItem)}>
              <span
                aria-hidden="true"
                {...stylex.props(styles.swatch, styles.goalSwatch)}
              />
              {goal.label ?? "Goal"}
            </li>
          )}
          {missing.some(Boolean) && (
            <li {...stylex.props(styles.legendItem)}>
              <span
                aria-hidden="true"
                {...stylex.props(styles.swatch, styles.missingSwatch)}
              />
              Not recorded
            </li>
          )}
        </ul>
      )}
      <svg
        role="img"
        aria-label={description}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        {...stylex.props(styles.svg)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={LEFT}
              x2={LEFT + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke={colors.border}
              strokeDasharray={tick === 0 ? undefined : "2 4"}
            />
            <text
              x={LEFT - 8}
              y={y(tick) + 4}
              textAnchor="end"
              {...stylex.props(styles.tick)}
            >
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {goal &&
          (goal.max !== undefined && goal.max > goal.min ? (
            <rect
              x={LEFT}
              width={plotWidth}
              y={y(goal.max)}
              height={Math.max(2, y(goal.min) - y(goal.max))}
              {...stylex.props(styles.goalBand)}
            />
          ) : (
            <line
              x1={LEFT}
              x2={LEFT + plotWidth}
              y1={y(goal.min)}
              y2={y(goal.min)}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              {...stylex.props(styles.goalLine)}
            />
          ))}
        {(style === "bar" || style === "stacked-bar") &&
          labels.map((label, index) => {
            if (missing[index])
              return (
                <rect
                  key={index}
                  x={center(index) - Math.min(barWidth * groups, 28) / 2}
                  width={Math.min(barWidth * groups, 28)}
                  y={zero - 24}
                  height={24}
                  rx={4}
                  {...stylex.props(styles.missing)}
                >
                  <title>{`${label}: not recorded`}</title>
                </rect>
              );
            let base = 0;
            return series.map((item, seriesIndex) => {
              const value = item.values[index];
              if (value === null || value === undefined) return null;
              const from = stacked ? base : 0;
              const to = from + value;
              if (stacked) base = to;
              const left = stacked
                ? center(index) - barWidth / 2
                : center(index) -
                  (groups * (barWidth + 2) - 2) / 2 +
                  seriesIndex * (barWidth + 2);
              return (
                <rect
                  key={`${index}:${seriesIndex}`}
                  x={left}
                  width={barWidth}
                  y={Math.min(y(from), y(to))}
                  height={Math.max(1, Math.abs(y(to) - y(from)))}
                  rx={Math.min(4, barWidth / 3)}
                  fill={seriesColors[seriesIndex % seriesColors.length]}
                >
                  <title>{`${label} · ${item.label}: ${full.format(value)}`}</title>
                </rect>
              );
            });
          })}
        {(style === "line" || style === "area") &&
          series.map((item, seriesIndex) => {
            const color = seriesColors[seriesIndex % seriesColors.length];
            // Split at missing values so a gap is never drawn through.
            const segments: { x: number; y: number; index: number }[][] = [[]];
            item.values.forEach((value, index) => {
              if (value === null) segments.push([]);
              else
                segments.at(-1)?.push({ x: center(index), y: y(value), index });
            });
            const showDots = labels.length <= 16;
            return (
              <g key={item.label}>
                {segments
                  .filter((segment) => segment.length > 0)
                  .map((segment, index) => (
                    <g key={index}>
                      {style === "area" && segment.length > 1 && (
                        <path
                          d={`M${segment[0]?.x},${zero} ${segment
                            .map((point) => `L${point.x},${point.y}`)
                            .join(" ")} L${segment.at(-1)?.x},${zero}Z`}
                          fill={color}
                          opacity={0.16}
                        />
                      )}
                      {segment.length > 1 && (
                        <polyline
                          points={segment
                            .map((point) => `${point.x},${point.y}`)
                            .join(" ")}
                          fill="none"
                          stroke={color}
                          strokeWidth={2.25}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )}
                      {(showDots || segment.length === 1) &&
                        segment.map((point) => (
                          <circle
                            key={point.index}
                            cx={point.x}
                            cy={point.y}
                            r={3}
                            fill={color}
                          >
                            <title>{`${labels[point.index]} · ${item.label}: ${full.format(item.values[point.index] ?? 0)}`}</title>
                          </circle>
                        ))}
                    </g>
                  ))}
              </g>
            );
          })}
        {labels.map((label, index) =>
          showLabel(index, labels.length, every) ? (
            <text
              key={index}
              x={center(index)}
              y={HEIGHT - 6}
              // Edge labels anchor inward so they never clip at the plot's sides.
              textAnchor={
                labels.length === 1
                  ? "middle"
                  : index === 0
                    ? "start"
                    : index === labels.length - 1
                      ? "end"
                      : "middle"
              }
              {...stylex.props(styles.tick)}
            >
              {axisLabel(label)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

const styles = stylex.create({
  svg: { display: "block", overflow: "visible", maxWidth: "100%" },
  tick: {
    fill: colors.muted,
    fontSize: 11,
    fontFamily: fonts.sans,
    fontVariantNumeric: "tabular-nums",
  },
  legend: {
    listStyle: "none",
    margin: 0,
    marginBottom: 10,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontSize: 12,
    color: colors.muted,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  goalSwatch: {
    backgroundColor: `color-mix(in srgb, ${colors.review} 28%, transparent)`,
  },
  missingSwatch: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.faint,
    boxSizing: "border-box",
  },
  goalBand: {
    fill: `color-mix(in srgb, ${colors.review} 20%, transparent)`,
  },
  goalLine: { stroke: colors.review },
  missing: {
    fill: "none",
    stroke: colors.faint,
    strokeWidth: 1.5,
    strokeDasharray: "3 3",
  },
});

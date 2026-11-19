import * as stylex from "@stylexjs/stylex";
import { Component, lazy, type ReactNode, Suspense } from "react";
import { chartDataError } from "../features/dashboards/chart-data";
import type {
  DashboardDataset,
  DatasetChart,
} from "../features/dashboards/schema";
import { DatasetDetails } from "./dashboard-data";
import { SvgChart, useElementWidth } from "./dashboard-svg-chart";

const FluentChart = lazy(() => import("./dashboard-fluent-chart"));

class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="status">Chart could not render. View the saved data below.</p>
    ) : (
      this.props.children
    );
  }
}

export function DashboardChart({
  chart,
  dataset,
}: {
  chart: DatasetChart;
  dataset?: DashboardDataset;
}) {
  const [container, width] = useElementWidth();
  const error = chartDataError(chart, dataset);
  return (
    <figure {...stylex.props(styles.figure)}>
      <figcaption {...stylex.props(styles.title)}>{chart.title}</figcaption>
      <div ref={container} {...stylex.props(styles.container)}>
        {error ? (
          <p role="status">{error}</p>
        ) : !dataset?.rows.length ? (
          <p>No rows saved yet. Ask your agent to add data.</p>
        ) : (
          <ChartBoundary
            key={JSON.stringify(chart) + dataset.key + dataset.revision}
          >
            {width <= 0 ? (
              <p role="status">Loading chart…</p>
            ) : chart.style === "donut" || chart.style === "scatter" ? (
              <Suspense fallback={<p role="status">Loading chart…</p>}>
                <FluentChart chart={chart} dataset={dataset} width={width} />
              </Suspense>
            ) : (
              <DatasetSvgChart
                chart={chart}
                style={chart.style}
                dataset={dataset}
                width={width}
              />
            )}
          </ChartBoundary>
        )}
      </div>
      {dataset && <DatasetDetails dataset={dataset} />}
    </figure>
  );
}
function DatasetSvgChart({
  chart,
  style,
  dataset,
  width,
}: {
  chart: DatasetChart;
  style: "line" | "area" | "bar" | "stacked-bar";
  dataset: DashboardDataset;
  width: number;
}) {
  const x = dataset.columns.findIndex((column) => column.key === chart.x);
  const rows =
    dataset.columns[x]?.type === "number"
      ? [...dataset.rows].sort((a, b) => Number(a[x]) - Number(b[x]))
      : dataset.rows;
  return (
    <SvgChart
      title={chart.title}
      style={style}
      goal={chart.goal}
      width={width}
      labels={rows.map((row) => String(row[x]))}
      series={chart.series.map((series) => {
        const index = dataset.columns.findIndex(
          (column) => column.key === series.column,
        );
        return {
          label: series.label,
          values: rows.map((row) =>
            typeof row[index] === "number" ? row[index] : null,
          ),
        };
      })}
    />
  );
}

const styles = stylex.create({
  figure: { margin: 0, minWidth: 0 },
  title: { fontSize: 15, fontWeight: 600, marginBottom: 14 },
  container: { width: "100%", minWidth: 0, overflowX: "auto" },
});

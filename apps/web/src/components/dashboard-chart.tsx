import * as stylex from "@stylexjs/stylex";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { chartDataError } from "../features/dashboards/chart-data";
import type {
  DashboardDataset,
  DatasetChart,
} from "../features/dashboards/schema";
import { DatasetDetails } from "./dashboard-data";

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
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
            <Suspense fallback={<p role="status">Loading chart…</p>}>
              {width > 0 ? (
                <FluentChart chart={chart} dataset={dataset} width={width} />
              ) : (
                <p role="status">Loading chart…</p>
              )}
            </Suspense>
          </ChartBoundary>
        )}
      </div>
      {dataset && <DatasetDetails dataset={dataset} />}
    </figure>
  );
}
const styles = stylex.create({
  figure: { margin: 0, minWidth: 0 },
  title: { fontSize: 13, fontWeight: 500, marginBottom: 12 },
  container: { width: "100%", minWidth: 0, overflowX: "auto" },
});

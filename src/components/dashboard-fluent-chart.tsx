import {
  AreaChart,
  DonutChart,
  GroupedVerticalBarChart,
  LineChart,
  ScatterChart,
  VerticalStackedBarChart,
} from "@fluentui/react-charts";
import { FluentProvider } from "@fluentui/react-provider";
import { webDarkTheme, webLightTheme } from "@fluentui/react-theme";
import { type ReactNode, useEffect, useState } from "react";
import type {
  DashboardDataset,
  DatasetChart,
} from "../features/dashboards/schema";

import { useTheme } from "../features/settings/theme-provider";
import { themePalettes } from "../features/settings/themes";

const palette = [
  "#477F70",
  "#596FB5",
  "#B56A35",
  "#9364A3",
  "#A14560",
  "#498493",
];
const darkPalette = [
  "#8FD2B9",
  "#A9B9FA",
  "#F0B584",
  "#D7A7E5",
  "#F19AB4",
  "#8CD5E5",
];

export default function FluentChart({
  chart,
  dataset,
  width,
}: {
  chart: DatasetChart;
  dataset: DashboardDataset;
  width: number;
}) {
  const { current } = useTheme();
  const [deviceDark, setDeviceDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDeviceDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const dark = current.mode === "system" ? deviceDark : current.mode === "dark";
  const activePalette = themePalettes[current.preset][dark ? "dark" : "light"];
  const colors = dark ? darkPalette : palette;
  const xIndex = dataset.columns.findIndex((column) => column.key === chart.x);
  const numericX = dataset.columns[xIndex]?.type === "number";
  const indices = chart.series.map((series) =>
    dataset.columns.findIndex((column) => column.key === series.column),
  );
  const labels = dataset.rows.map((row) => String(row[xIndex]));
  const points = chart.series.map((series, i) => ({
    legend: series.label,
    color: colors[i % colors.length],
    data: dataset.rows
      .map((row, index) => ({
        x: numericX ? Number(row[xIndex]) : index,
        y: Number(row[indices[i]!]),
        xAxisCalloutData: labels[index],
        yAxisCalloutData: String(row[indices[i]!]),
      }))
      .sort((a, b) => a.x - b.x),
  }));
  const values = points.flatMap((series) =>
    series.data.map((point) => point.y),
  );
  const yMin = Math.min(0, ...values);
  const tickCount = Math.min(
    labels.length,
    Math.max(2, Math.floor((width - 80) / 85)),
  );
  const tickIndices = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (labels.length - 1)) / Math.max(1, tickCount - 1)),
  );
  const common = {
    width: Math.max(260, width),
    height: 280,
    margins: { left: 48, right: 36, top: 16, bottom: 44 },
    yMinValue: yMin,
    yAxisTickCount: 4,
    enabledLegendsWrapLines: true,
    svgProps: { "aria-label": chart.title },
    xAxisTitle: dataset.columns[xIndex]?.label,
    showXAxisLablesTooltip: true,
    noOfCharsToTruncate: 12,
  };
  const lineProps = {
    ...common,
    ...(!numericX
      ? {
          tickValues: tickIndices,
          xAxis: {
            tickText: tickIndices.map((i) => labels[i]!),
            tickLayout: "default" as const,
          },
        }
      : {}),
  };
  const data = { lineChartData: points };
  let rendered: ReactNode;
  switch (chart.style) {
    case "line":
      rendered = <LineChart {...lineProps} data={data} />;
      break;
    case "area":
      rendered = <AreaChart {...lineProps} data={data} />;
      break;
    case "scatter":
      rendered = (
        <ScatterChart {...common} data={{ scatterChartData: points }} />
      );
      break;
    case "bar":
      rendered = (
        <GroupedVerticalBarChart
          {...common}
          hideLabels
          data={dataset.rows.map((row, index) => ({
            name: labels[index]!,
            series: chart.series.map((series, i) => ({
              key: series.column,
              legend: series.label,
              color: colors[i],
              data: Number(row[indices[i]!]),
            })),
          }))}
        />
      );
      break;
    case "stacked-bar":
      rendered = (
        <VerticalStackedBarChart
          {...common}
          data={dataset.rows.map((row, index) => ({
            xAxisPoint: labels[index]!,
            chartData: chart.series.map((series, i) => ({
              legend: series.label,
              color: colors[i],
              data: Number(row[indices[i]!]),
            })),
          }))}
        />
      );
      break;
    case "donut":
      rendered = (
        <DonutChart
          {...common}
          innerRadius={65}
          data={{
            chartData: dataset.rows.map((row, index) => ({
              legend: labels[index]!,
              data: Number(row[indices[0]!]),
              color: colors[index % colors.length],
            })),
          }}
        />
      );
      break;
  }
  return (
    <FluentProvider
      theme={{
        ...(dark ? webDarkTheme : webLightTheme),
        colorNeutralForeground1: activePalette.foreground,
        colorNeutralForeground2: activePalette.muted,
        colorNeutralBackground1: activePalette.surface,
        colorNeutralStroke1: activePalette.border,
      }}
      style={{ background: "transparent" }}
    >
      {rendered}
    </FluentProvider>
  );
}

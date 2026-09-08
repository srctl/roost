import type { DashboardDataset, DatasetChart } from "./schema";

// Shared by persistence and rendering so schema changes cannot silently misplot data.
export function chartDataError(
  chart: DatasetChart,
  dataset: DashboardDataset | undefined,
): string | null {
  if (!dataset)
    return "Data source is missing. Ask the agent to restore it or choose another source.";
  const x = dataset.columns.findIndex((column) => column.key === chart.x);
  if (x < 0) return "The chart's label column is missing from its data source.";
  if (chart.style === "scatter" && dataset.columns[x]?.type !== "number")
    return "Scatter charts require a numeric x column.";
  if (
    ["bar", "stacked-bar", "donut"].includes(chart.style) &&
    new Set(dataset.rows.map((row) => String(row[x]))).size !==
      dataset.rows.length
  )
    return "Bar and donut charts require unique category labels. Aggregate duplicate categories first.";
  if (chart.style === "donut" && dataset.rows.length > 24)
    return "Donut charts support up to 24 categories. Aggregate smaller categories or choose another chart.";
  const indices = chart.series.map((series) =>
    dataset.columns.findIndex(
      (column) => column.key === series.column && column.type === "number",
    ),
  );
  if (indices.some((index) => index < 0))
    return "Every chart series must reference a numeric column.";
  if (
    dataset.rows.some(
      (row) =>
        row[x] === null ||
        row[x] === undefined ||
        typeof row[x] !== dataset.columns[x]?.type ||
        (typeof row[x] === "number" && !Number.isFinite(row[x])) ||
        indices.some(
          (index) =>
            typeof row[index] !== "number" || !Number.isFinite(row[index]),
        ),
    )
  )
    return "Chart columns contain missing or invalid values. Ask the agent to complete the data.";
  if (
    ["donut", "area", "stacked-bar"].includes(chart.style) &&
    dataset.rows.some((row) => indices.some((index) => Number(row[index]) < 0))
  )
    return "Donut and stacked charts require nonnegative values. Use line, bar, or scatter for signed data.";
  if (
    chart.style === "donut" &&
    dataset.rows.length &&
    !dataset.rows.some((row) => Number(row[indices[0]!]) > 0)
  )
    return "A donut chart needs at least one positive value.";
  return null;
}

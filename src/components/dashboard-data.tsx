// biome-ignore-all lint/suspicious/noArrayIndexKey: Snapshot rows have no editable state and may repeat.
import * as stylex from "@stylexjs/stylex";
import type { DashboardDataset } from "../features/dashboards/schema";
import { colors } from "../styles/tokens.stylex";

export function DatasetTable({ dataset }: { dataset: DashboardDataset }) {
  return (
    <section
      {...stylex.props(styles.scroll)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Enables keyboard scrolling of wide data tables.
      tabIndex={0}
      aria-label={`${dataset.title} data table`}
    >
      <table {...stylex.props(styles.table)}>
        <caption {...stylex.props(styles.caption)}>
          {dataset.title} · {dataset.rows.length} rows
        </caption>
        <thead>
          <tr>
            {dataset.columns.map((column) => (
              <th key={column.key} scope="col" {...stylex.props(styles.cell)}>
                {column.label}
                <span {...stylex.props(styles.type)}> {column.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, column) => (
                <td key={column} {...stylex.props(styles.cell)}>
                  {value === null ? <span>Missing</span> : String(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!dataset.rows.length && <p>No rows saved yet.</p>}
    </section>
  );
}

export function DatasetDetails({ dataset }: { dataset: DashboardDataset }) {
  return (
    <details {...stylex.props(styles.details)}>
      <summary>View data: {dataset.title}</summary>
      <p {...stylex.props(styles.meta)}>
        Revision {dataset.revision} · Updated{" "}
        {new Date(dataset.updatedAt)
          .toISOString()
          .replace("T", " ")
          .slice(0, 16)}{" "}
        UTC
      </p>
      {dataset.description && <p>{dataset.description}</p>}
      {dataset.sourceUrl && (
        <p>
          <a
            href={dataset.sourceUrl}
            target="_blank"
            rel="noreferrer"
            {...stylex.props(styles.link)}
          >
            Source ↗
          </a>
        </p>
      )}
      <DatasetTable dataset={dataset} />
    </details>
  );
}

export function DashboardDataSources({
  datasets,
}: {
  datasets: readonly DashboardDataset[];
}) {
  return (
    <section aria-label="Saved data sources" {...stylex.props(styles.catalog)}>
      <details>
        <summary>Data sources ({datasets.length})</summary>
        <p>
          Saved snapshots your agent can reuse across charts. Ask your agent to
          create or update a source.
        </p>
        {datasets.length ? (
          datasets.map((dataset) => (
            <DatasetDetails key={dataset.key} dataset={dataset} />
          ))
        ) : (
          <p>No data sources yet.</p>
        )}
      </details>
    </section>
  );
}

const styles = stylex.create({
  catalog: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 12,
    backgroundColor: colors.surface,
  },
  details: { fontSize: 12, marginTop: 12, overflowWrap: "anywhere" },
  meta: { color: colors.muted, fontSize: 11 },
  link: { color: "inherit" },
  scroll: { maxWidth: "100%", overflowX: "auto" },
  caption: { textAlign: "left", paddingBlock: 8 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    textAlign: "left",
  },
  cell: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    minWidth: 90,
  },
  type: {
    display: "block",
    fontSize: 10,
    fontWeight: 400,
    color: colors.muted,
  },
});

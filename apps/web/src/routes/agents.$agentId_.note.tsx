import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { AgentHeader } from "../components/agent-header";
import { NoteWorkspace } from "../components/note-workspace";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { getNote } from "../features/notes/functions";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/note")({
  loader: ({ params }) =>
    getNote({ data: { agentId: params.agentId } }).catch(() => ({
      ok: false as const,
      error: "Could not load this note. Check your connection and reload.",
    })),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  // Show the tab at once with a skeleton while its data loads.
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: NotePending,
  component: NotePage,
});

function NotePage() {
  const { agentId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const agents = RootRoute.useLoaderData();
  const agent = agents.ok
    ? agents.value.find((a) => a.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  return (
    <section {...stylex.props(styles.page)}>
      <AgentHeader agent={agent} />
      {loaded.ok ? (
        <NoteWorkspace key={agentId} initial={loaded.value} />
      ) : (
        <p role="alert">
          {loaded.error}{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}
    </section>
  );
}

function NotePending() {
  const { agentId } = Route.useParams();
  const agents = RootRoute.useLoaderData();
  const agent = agents.ok
    ? agents.value.find((a) => a.id === agentId)
    : undefined;
  if (!agent) return null;
  return (
    <section {...stylex.props(styles.page)}>
      <AgentHeader agent={agent} />
      <SkeletonGroup label="Loading note" xstyle={styles.skeleton}>
        <Skeleton xstyle={styles.skeletonTitle} />
        <Skeleton />
        <Skeleton />
        <Skeleton xstyle={styles.skeletonShort} />
        <Skeleton xstyle={styles.skeletonGap} />
        <Skeleton xstyle={styles.skeletonMedium} />
      </SkeletonGroup>
    </section>
  );
}

const styles = stylex.create({
  // Matches the note paper's measure so content lands where the skeleton was.
  skeleton: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
    maxWidth: 880,
    marginInline: "auto",
    paddingInline: { default: 32, "@media (max-width: 700px)": 16 },
    paddingTop: { default: 24, "@media (max-width: 700px)": 16 },
  },
  skeletonTitle: { height: 24, width: "35%", marginBottom: 8 },
  skeletonShort: { width: "55%" },
  skeletonMedium: { width: "75%" },
  skeletonGap: { marginTop: 12 },
  page: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    // The desktop app shell grows with content. Bound the note so its
    // scroll container owns wheel events instead of trapping body scrolling.
    height: {
      default: "calc(100dvh - 40px)",
      "@media (max-width: 700px)": "100%",
    },
  },
});

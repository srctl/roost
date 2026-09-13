import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AgentHeader } from "../components/agent-header";
import { NoteWorkspace } from "../components/note-workspace";
import { getNote } from "../features/notes/functions";
import { useNotesEnabled } from "../features/notes/preference";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/note")({
  loader: ({ params }) =>
    getNote({ data: { agentId: params.agentId } }).catch(() => ({
      ok: false as const,
      error: "Could not load this note. Check your connection and reload.",
    })),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: NotePage,
});

function NotePage() {
  const notesEnabled = useNotesEnabled();
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
      {!notesEnabled ? (
        <p>
          Notes are off.{" "}
          <Link to="/settings" search={{ group: "features" }}>
            Open settings
          </Link>{" "}
          to enable them.
        </p>
      ) : loaded.ok ? (
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

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
  },
});

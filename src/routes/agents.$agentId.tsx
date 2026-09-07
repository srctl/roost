import { createFileRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { Conversation } from "../components/conversation";
import { getConversationSnapshot } from "../features/chat/functions";

export const Route = createFileRoute("/agents/$agentId")({
  head: ({ params }) => ({
    scripts: [
      {
        // An internally resolved PWA launch must have its canonical URL before
        // hydration. Direct links and in-app Home navigation stay untouched.
        children: `if(location.pathname==="/"&&!location.search)history.replaceState(history.state,"",${JSON.stringify(`/agents/${encodeURIComponent(params.agentId)}`)}+location.hash);`,
      },
    ],
  }),
  loader: ({ params }) =>
    getConversationSnapshot({ data: { agentId: params.agentId } }).catch(
      () => ({
        ok: false as const,
        error: "Could not access this conversation. Check Roost and retry.",
      }),
    ),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: AgentPage,
});

function AgentPage() {
  const { agentId } = Route.useParams();
  const initialConversation = Route.useLoaderData();
  const result = RootRoute.useLoaderData();
  const agent = result.ok
    ? result.value.find((agent) => agent.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  return (
    <Conversation
      key={agentId}
      agent={agent}
      initialConversation={initialConversation}
    />
  );
}

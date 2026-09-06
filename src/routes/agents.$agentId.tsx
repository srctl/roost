import { createFileRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { Conversation } from "../components/conversation";
export const Route = createFileRoute("/agents/$agentId")({
  component: AgentPage,
});
function AgentPage() {
  const { agentId } = Route.useParams();
  const result = RootRoute.useLoaderData();
  const agent = result.ok
    ? result.value.find((agent) => agent.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  return <Conversation key={agentId} agent={agent} />;
}

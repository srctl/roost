import { createFileRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { Conversation } from "../components/conversation";
import { getConversation } from "../features/chat/functions";
import { Button } from "../components/ui/button";
import { useRouter } from "@tanstack/react-router";
export const Route = createFileRoute("/agents/$agentId")({
  loader: ({ params }) => getConversation({ data: params.agentId }),
  component: AgentPage,
});
function AgentPage() {
  const { agentId } = Route.useParams();
  const result = RootRoute.useLoaderData();
  const conversation = Route.useLoaderData();
  const router = useRouter();
  const agent = result.ok
    ? result.value.find((agent) => agent.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  if (!conversation.ok)
    return (
      <div role="alert">
        <p>{conversation.error}</p>
        <Button onClick={() => void router.invalidate()}>Retry</Button>
      </div>
    );
  return (
    <Conversation
      key={agentId}
      agent={agent}
      messages={conversation.value.messages}
    />
  );
}

import type { Message } from "../../features/chat/schema";
import { AgentAutomationSettings } from "../agent-automation-settings";
import { ApprovalRequests } from "../approval-requests";
import { RunInspector } from "../run-details";
import { SoulChangeDetails } from "../soul-change";
import { Inspector } from "../ui/inspector";

export function NoticeDetails({
  agentId,
  message,
  onClose,
}: {
  agentId: string;
  message: Message;
  onClose: () => void;
}) {
  if (message.noticeKind === "approval")
    return (
      <Inspector title="Approval" onClose={onClose}>
        <ApprovalRequests agentId={agentId} id={message.referenceId!} />
      </Inspector>
    );
  if (message.noticeKind === "soul")
    return (
      <SoulChangeDetails
        agentId={agentId}
        id={message.referenceId!}
        onClose={onClose}
      />
    );
  if (message.noticeKind === "run")
    return (
      <RunInspector
        agentId={agentId}
        id={message.referenceId!}
        onClose={onClose}
      />
    );
  return (
    <Inspector title="Automations" onClose={onClose}>
      <AgentAutomationSettings
        agentId={agentId}
        selectedId={message.referenceId}
      />
    </Inspector>
  );
}

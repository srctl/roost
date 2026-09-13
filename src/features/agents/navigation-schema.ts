import { Schema } from "effect";
import { Name } from "./schema";

export const RenameAgentInput = Schema.Struct({
  agentId: Schema.UUID,
  name: Name,
});
export const NavigationChange = Schema.Union(
  Schema.Struct({
    action: Schema.Literal("create"),
    id: Schema.UUID,
    name: Name,
  }),
  Schema.Struct({
    action: Schema.Literal("rename"),
    id: Schema.UUID,
    name: Name,
  }),
  Schema.Struct({ action: Schema.Literal("delete"), id: Schema.UUID }),
  Schema.Struct({
    action: Schema.Literal("collapse"),
    id: Schema.UUID,
    collapsed: Schema.Boolean,
  }),
  Schema.Struct({
    action: Schema.Literal("move"),
    agentId: Schema.UUID,
    sectionId: Schema.NullOr(Schema.UUID),
  }),
);
export type NavigationChange = typeof NavigationChange.Type;
export type AgentNavigation = {
  sections: {
    id: string;
    name: string;
    position: number;
    collapsed: boolean;
  }[];
  memberships: Record<string, string>;
};

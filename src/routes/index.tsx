import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Avatar, Icon } from "../components/ui/primitives";
import { Button } from "../components/ui/button";
import { agentStyles } from "../features/agents/styles";
import { colors } from "../styles/tokens.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const result = RootRoute.useLoaderData();
  const router = useRouter();
  return (
    <section {...stylex.props(agentStyles.page)}>
      <header {...stylex.props(styles.header)}>
        <h1 {...stylex.props(agentStyles.title)}>Your agents</h1>
        {result.ok && result.value.length > 0 && (
          <Link to="/agents/new" {...stylex.props(styles.create)}>
            <Icon name="plus" />
            Create agent
          </Link>
        )}
      </header>
      {!result.ok ? (
        <Button onClick={() => void router.invalidate()}>Try again</Button>
      ) : result.value.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <p {...stylex.props(agentStyles.muted)}>
            Create your first agent to start a conversation.
          </p>
          <Link to="/agents/new" {...stylex.props(agentStyles.primary)}>
            Create an agent
          </Link>
        </div>
      ) : (
        <nav aria-label="Choose an agent" {...stylex.props(styles.list)}>
          {result.value.map((agent) => (
            <Link
              key={agent.id}
              to="/agents/$agentId"
              params={{ agentId: agent.id }}
              {...stylex.props(styles.agent)}
            >
              <Avatar character={agent.character} size={36} />
              <span {...stylex.props(styles.name)}>{agent.name}</span>
              <Icon name="chevron-right" />
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  create: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    color: colors.accent,
    textDecoration: "none",
  },
  list: { display: "flex", flexDirection: "column" },
  agent: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    paddingBlock: 16,
    paddingInline: 8,
    minHeight: 68,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    color: colors.foreground,
    textDecoration: "none",
    backgroundColor: { default: "transparent", ":hover": colors.surface },
    borderRadius: 6,
    outlineOffset: 2,
  },
  name: { flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: 16 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
  },
});

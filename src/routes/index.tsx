import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Avatar } from "../components/ui/primitives";
import { agentStyles as styles } from "../features/agents/styles";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <section {...stylex.props(styles.page)}>
      <Avatar character="moss" size={48} />
      <h1 {...stylex.props(styles.title)}>A home for your agents.</h1>
      <p {...stylex.props(styles.muted)}>
        Give a little teammate a name and a job of its own.
      </p>
      <div {...stylex.props(styles.actions)}>
        <Link to="/agents/new" {...stylex.props(styles.primary)}>
          Create an agent
        </Link>
      </div>
    </section>
  );
}

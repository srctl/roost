import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { CodexConnection } from "../components/codex-connection";
import { Button } from "../components/ui/button";
import { Avatar } from "../components/ui/primitives";
import { createAgent, getConnection } from "../features/agents/functions";
import { Character } from "../features/agents/schema";
import { agentStyles as styles } from "../features/agents/styles";

export const Route = createFileRoute("/agents/new")({
  loader: () => getConnection(),
  component: CreateAgentPage,
});

function CreateAgentPage() {
  const connection = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"assistant" | "coding">("assistant");
  const [error, setError] = useState<string>();
  const attempt = useRef<{ key: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name")).trim(),
      instructions: String(form.get("instructions")).trim(),
      character: String(form.get("character")) as typeof Character.Type,
      model: String(form.get("model")),
      kind,
    };
    if (!values.name || !values.instructions) {
      setError("Give your agent a name and instructions before saving.");

      return;
    }
    const key = JSON.stringify(values);
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    const id = attempt.current.id;
    setBusy(true);
    setError(undefined);
    try {
      const result = await createAgent({ data: { ...values, id } });
      if (!result.ok) {
        setError(result.error);

        return;
      }
      await router.invalidate();
      await navigate({
        to: "/agents/$agentId",
        params: { agentId: result.value.id },
      });
    } catch {
      setError(
        "Could not save the agent. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>Create an agent</h1>
      <p {...stylex.props(styles.muted)}>
        A little teammate. A job of its own.
      </p>
      {!connection.ok ? (
        <div role="alert" {...stylex.props(styles.error)}>
          <p>{connection.error}</p>
          <CodexConnection />
          <Button onClick={() => void router.invalidate()}>
            Retry connection
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} {...stylex.props(styles.form)}>
          <fieldset disabled={busy} {...stylex.props(styles.characters)}>
            <legend>Choose a character</legend>
            {Character.literals.map((character) => (
              <label key={character} {...stylex.props(styles.character)}>
                <input
                  type="radio"
                  name="character"
                  value={character}
                  defaultChecked={character === "moss"}
                />
                <Avatar character={character} />
                <span>{character}</span>
              </label>
            ))}
          </fieldset>
          <label {...stylex.props(styles.field)}>
            Name
            <input
              name="name"
              required
              maxLength={60}
              placeholder="Scout"
              disabled={busy}
              {...stylex.props(styles.input)}
            />
          </label>
          <label {...stylex.props(styles.field)}>
            Agent type
            <select
              name="kind"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "assistant" | "coding")
              }
              disabled={busy}
              {...stylex.props(styles.input)}
            >
              <option value="assistant">General assistant</option>
              <option value="coding">Coding agent</option>
            </select>
            {kind === "coding" && (
              <span {...stylex.props(styles.muted)}>
                Manages coding jobs for a project, with the same soul, memory,
                and reflection as any agent. Configure its project and execution
                profiles in settings after creating it.
              </span>
            )}
          </label>
          <label {...stylex.props(styles.field)}>
            What should your agent help with?
            <textarea
              name="instructions"
              required
              maxLength={8000}
              placeholder={
                kind === "coding"
                  ? "Manage development for my project. Clarify the task, oversee the coding work, and bring back verified results for review…"
                  : "Research ideas, compare options, and bring back a clear recommendation…"
              }
              disabled={busy}
              {...stylex.props(styles.input, styles.textarea)}
            />
          </label>
          <label {...stylex.props(styles.field)}>
            Model
            <select
              name="model"
              disabled={busy}
              defaultValue={
                (
                  connection.value.models.find((model) => model.isDefault) ??
                  connection.value.models[0]
                )?.model
              }
              {...stylex.props(styles.input)}
            >
              {connection.value.models.map((model) => (
                <option key={model.model} value={model.model}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <p {...stylex.props(styles.muted)}>
            Connected to Codex. Creating an agent saves its settings and
            workspace; it won’t start a task.
          </p>
          {error && (
            <p role="alert" {...stylex.props(styles.error)}>
              {error}
            </p>
          )}
          <div {...stylex.props(styles.actions)}>
            <Button
              type="submit"
              disabled={busy}
              {...stylex.props(styles.primary)}
            >
              {busy ? "Creating…" : "Create agent"}
            </Button>
            <Link to="/" {...stylex.props(styles.link)}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}

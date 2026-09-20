import * as stylex from "@stylexjs/stylex";
import { createRenderer } from "juxi/react";
import { createContext, type ReactNode, useContext } from "react";
import {
  CODING_HANDOFF_LABELS,
  type CodingHandoffPresentation,
  type CodingHandoffProps,
  type CodingHandoffView,
  codingHandoffPresentation,
  codingHandoffUI,
  validateCodingHandoffPlan,
} from "../features/coding/presentation";
import type { CodingJob } from "../features/coding/schema";
import {
  type CodingWorkspace,
  previewState,
} from "../features/coding/workspace-schema";
import { jobsStyles as s } from "../styles/jobs.stylex";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

type Job = CodingJob & { workspace: CodingWorkspace };
type Content = { job: Job; now: number; discussion: ReactNode };
const ContentContext = createContext<Content | null>(null);

function HandoffContent({ jobId, view }: CodingHandoffProps) {
  const content = useContext(ContentContext);
  if (!content || content.job.id !== jobId) return null;
  const { job, now, discussion } = content;
  const panels = {
    preview: <Preview job={job} now={now} />,
    changes: <Changes job={job} />,
    review: <Review job={job} />,
  };
  const prominent: (keyof typeof panels)[] =
    view === "review"
      ? ["changes", "review"]
      : view === "try"
        ? ["preview"]
        : [];
  return (
    <div data-coding-handoff={view} {...stylex.props(s.workspace)}>
      {prominent.map((section) => (
        <div key={section} data-handoff-section={section}>
          {panels[section]}
        </div>
      ))}
      <div key="discussion" data-handoff-section="discussion">
        {discussion}
      </div>
      <details key="details" {...stylex.props(s.workspaceDetails)}>
        <summary {...stylex.props(s.workspaceDetailsSummary)}>
          Preview & job details
        </summary>
        {(["preview", "changes", "review"] as const)
          .filter((section) => !prominent.includes(section))
          .map((section) => (
            <div key={section}>{panels[section]}</div>
          ))}
        <TaskDetails job={job} />
      </details>
    </div>
  );
}
const PlannedHandoff = createRenderer(codingHandoffUI, {
  CodingHandoff: HandoffContent,
});

export function CodingHandoff({
  job,
  now,
  discussion,
  presentation,
  selectedView,
  onSelect,
}: Content & {
  presentation?: CodingHandoffPresentation;
  selectedView?: CodingHandoffView;
  onSelect: (view: CodingHandoffView | undefined) => void;
}) {
  const authored =
    presentation ?? codingHandoffPresentation(job, job.workspace, now);
  const view = selectedView ?? authored.defaultView;
  const plan = validateCodingHandoffPlan(authored.plans[view], job.id);
  return (
    <ContentContext value={{ job, now, discussion }}>
      <nav aria-label="Handoff view" {...stylex.props(s.toolbar)}>
        <div {...stylex.props(s.filters)}>
          {authored.availableViews.map((option) => (
            <Button
              key={option}
              aria-pressed={view === option}
              xstyle={view === option ? s.selected : undefined}
              onClick={() => onSelect(option)}
            >
              {CODING_HANDOFF_LABELS[option]}
            </Button>
          ))}
        </div>
        {selectedView && (
          <Button onClick={() => onSelect(undefined)}>Suggested view</Button>
        )}
      </nav>
      {!plan && (
        <p role="status" {...stylex.props(s.muted)}>
          This view needs refreshing. Showing the full handoff.
        </p>
      )}
      {plan ? (
        <PlannedHandoff
          plan={plan}
          errorFallback={<HandoffContent jobId={job.id} view="overview" />}
        />
      ) : (
        <HandoffContent jobId={job.id} view="overview" />
      )}
    </ContentContext>
  );
}

function Changes({ job }: { job: Job }) {
  return (
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.sectionTitle)}>Latest changes</h3>
      <p {...stylex.props(s.summary)}>
        {job.workspace.latestChanges || job.summary || "No update shared yet."}
      </p>
    </section>
  );
}

function Review({ job }: { job: Job }) {
  return (
    <section {...stylex.props(s.section)}>
      <h3 {...stylex.props(s.sectionTitle)}>Verification</h3>
      <p {...stylex.props(s.summary)}>
        {job.workspace.verification ||
          "Implementation verification has not been recorded."}
      </p>
      <p {...stylex.props(s.muted)}>
        Integration verification: {job.workspace.integration}.
      </p>
      <h3 {...stylex.props(s.sectionTitle)}>Pull requests</h3>
      {job.workspace.pullRequests.length ? (
        <div {...stylex.props(s.actions)}>
          {job.workspace.pullRequests.map((url, index) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(s.actionLink)}
            >
              Review PR {index + 1} ↗
            </a>
          ))}
        </div>
      ) : (
        <p {...stylex.props(s.muted)}>No pull request has been shared yet.</p>
      )}
    </section>
  );
}

function Preview({ job, now }: { job: Job; now: number }) {
  const state = previewState(job.workspace, now);
  return (
    <section {...stylex.props(s.section)}>
      <div {...stylex.props(s.sectionHeading)}>
        <h3 {...stylex.props(s.sectionTitle)}>Current preview</h3>
        <span {...stylex.props(s.muted)}>
          {state === "running"
            ? "Reported running"
            : state === "not_needed"
              ? "Not needed"
              : state === "unknown"
                ? "Unknown · report expired"
                : "Unavailable"}
        </span>
      </div>
      <div {...stylex.props(s.preview)}>
        <Icon name="monitor" size={24} />
        <div {...stylex.props(s.previewText)}>
          {job.workspace.previewUrl ? (
            <>
              <p {...stylex.props(s.summary)}>
                Revision {job.workspace.previewRevision || "not recorded"}
              </p>
              <span {...stylex.props(s.muted)}>
                {new URL(job.workspace.previewUrl).host}
              </span>
            </>
          ) : (
            <p {...stylex.props(s.summary)}>No preview has been shared yet.</p>
          )}
        </div>
        {job.workspace.previewUrl && (
          <a
            href={job.workspace.previewUrl}
            target="_blank"
            rel="noreferrer"
            {...stylex.props(s.actionLink)}
          >
            {state === "running" ? "Open preview ↗" : "Try last preview ↗"}
          </a>
        )}
      </div>
      {state !== "running" && (
        <p {...stylex.props(s.muted)}>
          Preview availability does not change this job’s status. Your work and
          feedback remain here.
        </p>
      )}
      {job.workspace.previewReportedAt > 0 && (
        <p {...stylex.props(s.muted)}>
          Last reported{" "}
          {new Date(job.workspace.previewReportedAt).toLocaleString()}. Running
          reports expire after 15 minutes.
        </p>
      )}
    </section>
  );
}

function TaskDetails({ job }: { job: Job }) {
  return (
    <>
      <section {...stylex.props(s.section)}>
        <h3 {...stylex.props(s.sectionTitle)}>Task description</h3>
        <p {...stylex.props(s.summary)}>{job.assignment || job.brief}</p>
        {/^https?:\/\//i.test(job.sourceUrl) && (
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noreferrer"
            {...stylex.props(s.link)}
          >
            Open task source ↗
          </a>
        )}
      </section>
      <details {...stylex.props(s.technical)}>
        <summary {...stylex.props(s.technicalSummary)}>
          Technical details & worker output
        </summary>
        <dl {...stylex.props(s.metadata)}>
          {[
            ["Machine", job.remoteTarget || "Roost host"],
            ["Workspace", job.cwd],
            ["Herdr session", job.sessionName],
            ["Worker", `${job.workerName} · ${job.workerKind}`],
            ["Execution state", job.status],
          ].map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>{key}</dt>
              <dd {...stylex.props(s.value)}>{value}</dd>
            </div>
          ))}
        </dl>
        <pre {...stylex.props(s.output)}>{job.output || "No output yet."}</pre>
      </details>
    </>
  );
}

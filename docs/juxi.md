# Adaptive views and interactive trackers

Roost uses Juxi to select an application-authored dashboard view. The web app renders
that plan with React; the iPhone app renders the same plan with native SwiftUI
components and Swift Charts.

Choose **View** in an agent's dashboard to show Everything, Summary, Charts, Tables,
or Tasks. Only views containing current data appear. The selection is saved on the
server and shared between web and iPhone. **Reset view** restores the complete
dashboard. Selecting a view does not change the underlying widgets or datasets.

## Describe a view

Set `TYPESAFE_API_KEY` in the Roost server process environment to enable **Describe a
view**. `TYPESAFE_MODEL` optionally selects the model; the default is `jev-latest`.
Keep the key on the server. A `VITE_` variable must never contain it. Manual view
selection works without a model credential.

The planner receives the requested intent, widget titles and block types, and dataset
titles and column labels. It does not receive conversation history, dataset rows,
device tokens, or arbitrary component props. Calls have a 12-second timeout. Uncertain
decisions show the complete dashboard with an explanation; service failures preserve
the current selection and data. Loading or refreshing never silently regenerates a
model decision.

A request can select a topic as well as a format: **Show my garden progress** can
show only the garden tracker’s charts, while **Show the launch checklist** can show
only the launch tracker’s task blocks. The selected topic is named on screen.
Choosing a manual view or resetting includes all trackers again. Topic views hide
the general data-source catalog; charts still read their referenced current datasets.

**Discuss** prepares an editable question asking the agent for a brief update on that
tracker, unfinished tasks, and suggested next steps using current data. It does not
send automatically. Existing drafts and attachments are preserved; the browser offers
to append the question when a draft is already present.

## Contract and persistence

`features/dashboards/presentation.ts` defines the `DashboardView` component using
Juxi's shared schema. Its props contain an allowed focus, current widget keys, and
whether to show data sources. Both renderers check those references against the
current authoritative snapshot. Unknown components, unsupported plan versions, or
invalid references fall back to the ordinary dashboard.

`dashboard_presentations` stores the focus, optional widget key, intent, revision, timestamp, and notice
per agent. Reads rebuild safe plan references from current widgets, keeping charts
and data current without copying snapshots into the plan. Writes require the current
revision, so a slow model response or stale client cannot overwrite a newer choice.
Deleting an agent deletes its saved presentation. Removing a selected tracker falls
back to the complete dashboard with a notice. Scoped option identifiers are rebuilt
from the current sorted widget inventory; only the stable widget key is persisted.

## Interactive trackers

Choose **Add tracker** on an enabled dashboard to create a **To-do list** or
**Calorie log** with a name. These are working forms on web and iPhone. Agents can
also compose `todo-list` and `calorie-log` blocks with existing dashboard blocks
through `roost_save_dashboard`.

To-do lists support adding, completing, reopening, and removing tasks with visible
completion state. Calorie logs accept a meal label, an explicit calorie
count, and a calendar date. The total is calculated from the entries for the selected
day. No calorie estimates or targets are generated. Dates are calendar dates in the
user's local day, not timestamps converted to another time zone.

Each block and item has a stable ID. Writes use the current widget revision and
preserve other blocks in that widget. Stale writes return a conflict and refresh
while keeping form text. Lost-response retries retain the original payload and ID;
matching additions and tracker creation are idempotent. The authenticated mobile API
uses `POST dashboard/tracker` for creation and `POST dashboard/action` for bounded
item actions. These share the browser's server implementation and ownership checks.
Existing static `tasks` blocks remain report snapshots; `todo-list` is editable.

## Coding handoff

Coding job workspaces now have **Review**, **Try**, and **Overview** views backed by
the shared `CodingHandoff` Juxi contract. Review brings changes, verification, and PR
links forward. Try brings the current preview and the existing feedback form forward.
Overview starts with the worker discussion. Other job details remain available.

The suggested view follows current job/workspace state without an external planner
call. A manual view choice is kept per job (in the web URL or native workspace
preferences). Status, Stop, errors, and failed-submission inspection remain outside
the adaptive content. Juxi does not invent verification, execute buttons, approve
work, or launch another worker. Feedback save and Continue retain their existing
authenticated behavior and request identities.

## Where generated UI helps Roost

The first useful loop is **ask → focus → inspect → discuss**. Agent-maintained
trackers already hold metrics, charts, records, and tasks. Juxi chooses the relevant
topic and presentation from those authored views; Roost renders the same current data
on web and iPhone. This is especially useful when one agent maintains several trackers.
It does not generate a new summary, transform data, or execute the requested work.

A possible next surface is **Needs attention**: combine unfinished tracked tasks
with blocked coding jobs and pending approvals. That combined surface is not
implemented here. Approvals and required actions must stay visible independently
of any model decision. Trackers have no due-date or priority fields, so a view must
not invent urgency.

Keep navigation, sending, connection management, and approval decisions stable.
Generated views should reduce the work needed to understand agent output and choose
a next step, with familiar controls and explicit user actions.

The authenticated mobile API returns `presentation` alongside the dashboard snapshot.
`POST /api/mobile/v1/agents/:id/dashboard/presentation` accepts exactly one of
`{ focus, revision }` or `{ intent, revision }`. An empty intent resets the view.
Conflicts return HTTP 409. Browser clients use the matching authenticated server
function; mobile credentials retain their existing API boundary.

## Native reliability

The iPhone app supports replacing an expired device token in Settings without
removing drafts for the same server. Old connection responses cannot overwrite new
drafts. Confirmed rejected messages return to an editable draft; uncertain sends keep
the same message identity and payload when retried. Attachment-only follow-ups keep
Send available, text limits match the server, and approvals stay in their owning run.

## Dependency snapshots

Juxi was unpublished when this integration started. This checkout contains a packed
JavaScript dependency and a Swift source snapshot so it builds without an adjacent
Juxi checkout. Provenance is recorded under `packages/juxi-vendor` and
`packages/juxi-swiftui`. Replace them with a verified exact npm version and SwiftPM
revision once the upstream release is available. GitHub/npm publication credentials
are separate from the TypeSafe planner credential.

## Verify

Use the pinned Corepack pnpm toolchain from the repository root:

```sh
corepack pnpm check
corepack pnpm test:dashboard:browser
corepack pnpm test:trackers:browser
corepack pnpm dev:mobile-fixture
```

The browser test launches a disposable built server/database and verifies focus
selection, reload, shared mobile state, conflicts, reset, and viewport geometry.
The tracker browser test creates both tracker types through the UI, checks daily
totals and task completion, and exercises concurrent edits and a lost save response.
It also verifies that form drafts and exact retry requests survive view changes.
Set `ROOST_TEST_CHROME` if using an installed Chrome executable instead of Playwright's
browser. It does not make live model calls. Server tests mock the TypeSafe HTTP
transport while exercising Juxi's actual planner and validation.

With the mobile fixture running on loopback, run the Xcode Roost scheme's unit and
UI tests on an iPhone simulator. Native tests exercise the Juxi binding, connection,
chat/replies, approval scope, rejection and token recovery, attachments/Quick Look,
Stop, dashboard focus, notes, and coding workspace navigation. Fixture workers are
disabled, so these tests do not prove external model execution or physical-device
distribution. Signing, TestFlight/App Store publication, and APNs remain separate
configuration work.

`TrackerUITests` covers creating and editing both trackers, retaining a draft after
a real revision conflict, changing coding handoff views, and restoring the chosen
view after relaunch. Unit tests cover malformed plans and exact-request recovery.

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
**Calorie log** with a name, or **Weather** with an explicitly selected city. These are working forms on web and iPhone. Agents can
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

## Weather

**Current branch status:** weather rendering, configuration, authenticated routes,
and local provider fixtures are implemented. The live Open-Meteo adapter remains
disconnected pending approval to send an explicitly chosen city to that service.
City search and forecasts currently work only with the test fixture. The behavior
below describes that implemented flow; it is not yet available with live weather.

Choose **Add tracker → Weather**, search for a city or postal code, choose a matching
location, and select Celsius or Fahrenheit. The same card works in Dashboard,
Summary, and inline chat on web and iPhone. It shows current conditions, feels-like
temperature, wind in km/h, and a five-day forecast with daily precipitation probability.
**Refresh** requests an update; temperature-unit changes save to the widget.

Weather blocks store only a location ID and unit. The server resolves the city and
fetches actual conditions from [Open-Meteo](https://open-meteo.com/), so the agent
cannot supply invented readings. Forecasts are cached for 15 minutes, with a
60-second cooldown on explicit refreshes. Cached forecasts up to 24 hours old can
remain visible after a provider failure, with a stale-data notice and their original
update time. No-data failures show a retryable message. Loading a forecast never
sends a chat message, requests device location, or calls a language model.

Agent tools `roost_search_weather_locations` and `roost_create_weather_tracker`
resolve and create a weather tracker. `roost_show_dashboard` then places the saved
reference in an active conversation. The authenticated mobile read endpoints are
`GET dashboard/weather/locations?query=…` and
`GET dashboard/weather?key=…&blockId=…`; both enforce enabled dashboards and agent
ownership. The provider layer validates locations and forecasts, bounds its cache, and shares
in-flight requests. The live HTTP adapter has not been added.

The public Open-Meteo service is for non-commercial use; commercial hosting needs
its customer service. See [Open-Meteo pricing and terms](https://open-meteo.com/en/pricing).
The planned adapter will use fixed provider hosts and server-only credentials where
required. No weather credentials are read by this branch. Both renderers include
provider attribution.

## Trackers in chat

Ask the agent to create or show a tracker in the conversation. After saving it,
the agent can call `roost_show_dashboard` with the saved widget key. Roost inserts
an inline tracker in that conversation, including reply threads. To-do controls,
calorie entry forms, weather forecasts, charts, and other supported blocks work on web and iPhone.
Edits update the same saved widget shown in Dashboard, without sending a chat
message or changing the composer's draft.

The message stores a bounded reference to the agent's widget, not a copy of its
data. It shows the latest saved content when reopened and periodically refreshes
while visible. The inline view always shows that widget's complete content,
independently of the dashboard's selected view. Deleted trackers and disabled
dashboards show an unavailable message; they never fall back to another tracker.
Old clients can still read the message's plain-text fallback.

Only an active user-chat run can show a tracker, and the server derives the target
conversation from that run. Repeating the tool for the same run and key does not
duplicate the message. Background saves remain quiet. Both clients validate the
structured reference and Juxi plan; ordinary Markdown is never executed as UI.

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
corepack pnpm test:chat-trackers:browser
corepack pnpm test:weather:browser
corepack pnpm dev:mobile-fixture
```

The browser test launches a disposable built server/database and verifies focus
selection, reload, shared mobile state, conflicts, reset, and viewport geometry.
The tracker browser test creates both tracker types through the UI, checks daily
totals and task completion, and exercises concurrent edits and a lost save response.
It also verifies that form drafts and exact retry requests survive view changes.
The chat tracker test covers inline editing, repeated references, reply threads,
both chat styles, shared dashboard state, and unavailable content.
The weather browser test injects a deterministic local transport into a disposable
copy of the built server. It verifies city selection, saved units, Summary focus,
inline chat, draft preservation, stale recovery, and layouts at 1440, 390, and
320 pixels. The production build stays untouched and external fetches are denied.
Native weather UI tests use the same local provider seam and verify creation,
unit changes, refresh, and the saved card in chat. These are fixture-data checks;
they do not verify a live provider connection.
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

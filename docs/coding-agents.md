# Coding agents

Coding agents manage development assignments through Herdr while keeping the
conversation in Roost. Create one for each project you care about, then use its
conversation to start work, answer questions, and discuss results. Assign a
Notion ticket or describe an ad hoc task; a ticket is optional.

## Enable or disable coding

Settings → Features → Coding controls coding for all agents and devices. It is
on by default. Turning it off hides coding setup, prevents new coding agents,
jobs, and follow-ups, and pauses queued launches and inputs. Work already
submitted can finish; inspection, completion, and stop controls remain available.
Saved agents, configuration, and job history stay intact. Turning coding back on
resumes queued work. This switch controls Roost's managed coding jobs, not the
underlying model's general ability to write code.

## Create and configure an agent

Choose **Coding agent** under **Agent type** when creating an agent. Give it a
name and instructions, then open its settings and choose **Coding**.

- **Project** stores the repository, project instructions, and an optional
  default execution profile. Include setup commands, testing expectations,
  conventions, and what a reviewable result should contain.
- **Task sources** stores optional Notion databases, filter instructions, and
  instructions for progress updates. For example: “Only tickets labeled Roost
  with status Ready.” You can save multiple sources and choose one when assigning
  work.
- **Execution profiles** describes where and how to run coding workers. Profiles
  are shared across coding agents, so an edit applies to every agent that uses
  the profile for future work. Project instructions provide the setup and
  conventions for this particular project.

You can also ask the agent to save or edit these settings in conversation. Your
current request takes precedence over saved defaults. Existing jobs retain the
project and execution instructions captured when they started.

Coding agents retain the same **Soul**, **Memory**, and **Automations** settings
as other agents, including editable souls, agent-driven soul updates, periodic
reflection, revision history, and Undo. Operational configuration is separate
from the soul; reflection does not change repositories, source filters, or
execution profiles. See [Agents and memory](agents-and-memory.md).

## Choose where work runs

A profile runs workers either **On the Roost host** or **On an SSH machine**.
The Roost host is the machine running the server, which may be different from
the computer where you open Roost. A Mac running Roost can run its installed
workers locally; a hosted Roost server needs configured SSH access to reach
another machine.

For an existing SSH machine, save its host alias or `user@host` as the default
destination. For a new remote machine, leave the destination empty and describe
how to provision it in the execution instructions. The coordinating agent uses
its available tools and configured connections to create and prepare the
environment, then supplies the actual SSH destination for the job.

For example, a “New Railway machine” profile can explain which project and
environment to use, how to provision a service, how to connect over SSH, and how
to prepare the repository. This relies on the coordinator's available Railway
tooling and account access; saving instructions alone does not create a service
or install a connection. The execution machine needs Herdr and the selected
coding CLI installed and authenticated. Keep credentials in configured tools
and connections instead of profile text.

Include instructions for worktree isolation, development setup, verification,
and any desired cleanup. Provisioning, publishing, and cleanup follow the
authorization in your request and the tools' existing approval rules.

## Assign a task

Examples of messages to your coding agent:

> Implement a compact mode for the settings screen locally. Use a new worktree,
> run the relevant checks, and bring it back for review.

> Pick up this Notion ticket on a new remote machine. Keep its status and PR link
> updated as you work.

> Look at the project database, only tickets labeled Roost. Show me the Ready
> tickets so I can choose the next assignment.

The agent reads the assignment, prepares its repository or worktree, chooses an
installed worker, and starts a dedicated Herdr session. It can manage multiple
jobs and remains available for conversation while they run. Temporary coding
workers do not become additional Roost agents.

Notion reads and writes use the coordinating agent's available connected tools.
A saved database URL does not connect a Notion account, and a saved source does
not enable automatic ticket pickup. The agent reports unavailable connections
or failed updates separately from the coding result. Ad hoc work can proceed
without Notion when the assignment provides enough context.

## Follow progress and review results

Open **Jobs** under the owning agent to see assignments, progress, worker output,
session information, source links, and completion summaries. This view remains
available when dashboards are off. Active jobs refresh while the page is visible.
Start new assignments and discuss results in the agent's conversation.

Roost records jobs durably and monitors Herdr without keeping a model turn open.
Meaningful worker changes queue a turn for the coordinating agent, which can
inspect the output, continue the same assignment when appropriate, update its
task source, and report the outcome. A worker becoming ready or idle is a prompt
to review its work; it does not prove the assignment is complete. The coordinator
records completion after checking the acceptance criteria.

Jobs can be queued, starting, running, waiting for attention, ready for review,
completed, failed, or cancelled. Codex workers use automatic risk review with
the workspace sandbox and approval policy still enabled. Approval prompts that
remain blocked require the user to resolve them in the worker's own terminal;
the coordinating agent never answers those prompts or sends keys to bypass them.

Use **Stop job** or ask the agent to stop an assignment. Stops are asynchronous
interrupt requests. Stopping preserves the Herdr session, worktree, and
infrastructure; it does not undo code or delete the environment. Ask explicitly
for any later cleanup.

Roost and the execution machine must remain available to monitor work. After a
restart or connection failure, an uncertain launch or missing session requires
inspection instead of blindly submitting the assignment again. Recorded jobs
remain available for recovery and discussion.

If preparation fails before a worker starts, such as a missing Herdr executable,
fix the reported dependency and ask the agent to continue the same job. Roost
retries the initial launch with its original assignment and follow-up, rather
than sending input to a nonexistent worker. This recovery is available only
when Roost knows no worker was launched; uncertain submissions stay blocked.

When an existing job's named Herdr server is unavailable, an authorized
continuation can start that server from the recorded working directory. It
checks the restored worker's identity before sending the follow-up. This does
not create a replacement worker or replay the original assignment. Routine
monitoring remains read-only. A missing worker, changed identity, or uncertain
submission still needs inspection.

The coordinator may also inspect and recover the job-owned server within your
authorized assignment. If the original worker cannot be restored, it can carry
out an explicitly authorized replacement after inspecting saved work and
referencing the original job. Worker approval prompts still require resolution.

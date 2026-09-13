export type WorkState =
  | "Working"
  | "Ready for feedback"
  | "Blocked"
  | "Ready for review"
  | "Completed";
export type Job = {
  id: string;
  title: string;
  state: WorkState;
  update: string;
  age: string;
  preview: "Running" | "Unavailable" | "Not needed";
  revision: string;
  task: string;
  changes: string[];
  pr?: string;
  discussion: string;
};
export const fixtures: Job[] = [
  {
    id: "jobs",
    title: "Make Jobs a place to return to work",
    state: "Ready for feedback",
    update: "Compact list and a workspace for each job are ready to try.",
    age: "2m",
    preview: "Running",
    revision: "03",
    task: "Redesign coding Jobs around ongoing work, live previews, feedback and eventual PRs. Keep the list compact and preserve the original assignment and worker when continuing. Start with an interactive preview for feedback.",
    changes: [
      "A compact list puts the latest update beside each task.",
      "Preview availability is separate from work status.",
      "Feedback stays with this assignment in a dedicated discussion.",
    ],
    discussion:
      "The first preview is ready. Try opening a job and leaving feedback. I’m paused here until you want to continue; the preview stays available.",
  },
  {
    id: "search",
    title: "Add search to the project switcher",
    state: "Working",
    update: "Keyboard navigation is in place; checking small screens.",
    age: "6m",
    preview: "Running",
    revision: "02",
    task: "Make projects easier to find with a searchable switcher, including keyboard navigation and mobile layouts.",
    changes: [
      "Added filtering by project name.",
      "Arrow keys move between results; Escape closes the switcher.",
    ],
    discussion:
      "Search is available in the preview while I check the mobile layout. Feedback can be saved here while work continues.",
  },
  {
    id: "access",
    title: "Improve the repository connection flow",
    state: "Blocked",
    update: "Needs a decision on the permissions explanation.",
    age: "24m",
    preview: "Unavailable",
    revision: "01",
    task: "Explain repository permissions before connecting a project. Keep authorization explicit.",
    changes: [
      "Drafted the connection steps.",
      "Waiting for the approved permissions copy.",
    ],
    discussion:
      "Which permissions should this connection request? I’m waiting for that decision before continuing. The preview is currently unavailable; this assignment is still blocked.",
  },
  {
    id: "threads",
    title: "Keep replies in their own conversation",
    state: "Ready for review",
    update:
      "Standalone checks passed. Integration verification is still pending.",
    age: "1h",
    preview: "Running",
    revision: "05",
    pr: "#22 → #23 → #24",
    task: "Add message threads with stable conversation identity and scoped replies.",
    changes: [
      "Preserved parent context and independent drafts.",
      "Checked desktop and mobile reply navigation.",
      "Stack is unmerged; aggregate integration checks remain pending.",
    ],
    discussion:
      "The implementation is ready for standalone review. The stack still needs integration verification before merge.",
  },
  {
    id: "settings",
    title: "Simplify settings navigation",
    state: "Ready for feedback",
    update: "Layout is ready; preview process needs to be resumed.",
    age: "2h",
    preview: "Unavailable",
    revision: "02",
    task: "Group settings into a clearer navigation without changing existing controls.",
    changes: [
      "Grouped project settings and execution profiles.",
      "Kept the original settings controls intact.",
    ],
    discussion:
      "The layout is waiting for your feedback. The preview has stopped, but the job is not complete. You can still leave feedback here.",
  },
  {
    id: "recovery",
    title: "Protect coding sessions during updates",
    state: "Completed",
    update: "Verified and completed. Changes are preserved in the PR.",
    age: "Yesterday",
    preview: "Not needed",
    revision: "01",
    pr: "#18",
    task: "Preserve owned coding sessions during an application update.",
    changes: [
      "Retained durable worker identity across restarts.",
      "Verified recovery behavior before completing the assignment.",
    ],
    discussion:
      "This assignment is complete. Its discussion and review history remain available.",
  },
];

# Dashboards

Dashboards keep useful trackers outside an agent's conversation. They are **off
by default**. Enable **Settings → Dashboards**, then open an agent and choose
**Dashboard** in its header. Conversation and Dashboard tabs keep both views
within the same agent. On desktop, the existing conversation sits beside the
dashboard. Drag the divider to resize chat, or use **Hide chat** / **Show chat**.
The divider also supports arrow keys, Home, and End. On smaller screens, choose
**Chat** to open it and **Close chat** to
return to the widgets. Each agent has its own dashboard.
The setting is saved on the Roost server and applies to every device.
Turning it off hides the page's content and prevents dashboard reads and updates;
existing widgets remain saved for when you enable it again.

Talk to an agent about what you want to track and which information will be useful.
For example:

- “Build a project dashboard with current status, next steps, and a weekly trend.”
- “Keep a tracker of the cars we're comparing, including price, mileage, and source links.”
- “Track my spending this month with category totals and a chart. Tell me which data you need.”

Each named widget can combine notes, metrics, tables, line or bar charts, source
links, and task lists. Charts include a **View values** option. The page shows each
widget's last saved update time; use **Discuss with…** to
focus the conversation and ask that agent to change or remove it. The agent reads existing widgets before
updating them, so concurrent changes cannot silently overwrite one another.

Widgets are saved reports, not live connections to external services. Their
information changes when an agent checks a source and saves an update. Ask for an
automation if a tracker should refresh on a schedule, and choose whether routine
updates should generate a conversation message. An automation can update the
widget without posting every change in the conversation. The open Dashboard page
checks for saved updates every 15 seconds while visible. If a refresh fails, it
keeps the last loaded content and displays a notice.

Each agent can read and update only its own widgets; its Dashboard page shows
only those widgets. Agents cannot enable dashboards themselves. Dashboard
updates do not grant permission to access a new account or take an external action.
Native blocks render as ordinary Roost UI; executable HTML and scripts are not
supported. Each agent can keep up to 30 widgets, with up to 12 blocks per widget.

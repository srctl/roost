# Run Roost on Railway

Use a **dedicated Railway Cloud Agent VM** for Roost. We tested chat, shell tools,
scheduled work, persistent files, and a shared XFCE/Chrome desktop on this VM
path. Cloud Agents are experimental; [exe.dev](deploy-exe-dev.md) remains the
simpler managed installation with private sign-in already included.

This is a persistent VM setup, not `railway up` for an ordinary container.
Our normal-container test could serve the web app but could not run Codex's
nested Linux sandbox. The working VM test explicitly used the VM as the
isolation boundary. Only use that option on a VM dedicated to your Roost agents.

## 1. Create a VM

Enable **Cloud Agents** in Railway's [Priority Boarding](https://railway.com/account/feature-flags).
Create a project in Railway, then use its project ID and environment name:

```sh
railway ca create roost --project YOUR_PROJECT_ID --environment production --json
railway ca ssh roost --project YOUR_PROJECT_ID --environment production
```

Keep the VM's preview HTTPS URL from Railway handy. It routes to port **8080**.
Use that exact origin for auth; don't change hostnames after creating passkeys.
See [Railway Cloud Agents](https://docs.railway.com/cli/ca) for CLI access and lifecycle.

## 2. Build Roost on the VM

Use a non-root account with Node.js 22.13+, pnpm 9.15.0, Git, and a compatible
Codex CLI. See [source prerequisites](development.md) if these aren't installed.
Keep the checkout and data on the VM's persistent disk:

```sh
git clone https://github.com/srctl/roost.git
cd roost
pnpm install --frozen-lockfile
pnpm build
export ROOST_DATA_DIR="$HOME/roost-data"
node .output/cli/roost.mjs auth setup --origin https://YOUR_VM_HOSTNAME
```

Save the private setup link. If it expires before you start the app, run the last
command again. Do not use `roost setup` here: that installer expects systemd,
which the tested Cloud Agent VM did not run.

## 3. Start it, then create your passkey

In the same shell:

```sh
export ROOST_CODEX_BINARY="$(command -v codex)"
export CODEX_HOME="$HOME/.codex"
export ROOST_CODEX_SANDBOX=danger-full-access
sh scripts/start-railway-vm.sh
```

The explicit sandbox setting grants agent tools the service user's filesystem
and network access inside this dedicated VM. It is **off by default** on all
other installations; exe.dev keeps its existing `workspace-write` sandbox.
Don't place unrelated accounts or secrets in this VM.

Open your saved setup link, choose **Create passkey**, then use
**Settings → Connect Codex**. Ask an agent to create a small file and reload to
check persistence. A signed-out browser should see Roost's passkey login.
[Auth setup and recovery](authentication.md) covers backup passkeys and sign-out.

The start script refuses to expose a fresh installation before auth setup.
Railway supplies HTTPS; keep CDN caching disabled for the private app.

## 4. Keep it running

The foreground command above is useful for the first check. For ongoing use,
run that same command under a process supervisor such as Supervisor, with the
same working directory, non-root account, and environment variables from steps
2–3. Configure automatic restart and rotated logs. Run only one Roost process
against the data directory.

**A sleeping VM does not run schedules.** Keep it awake while you want agents
working. After `railway ca wake roost`, reconnect and restart your supervisor;
a browser visit alone did not recover services in our test. Preserve
`ROOST_DATA_DIR` and `CODEX_HOME`, and back them up separately from the VM.

For updates, stop the supervised app, pull the desired version, rebuild, and
start it with the same data directory. The packaged `roost update` command is
for the systemd release installer, not this source deployment.

## Optional: shared desktop

Follow [Desktop setup](remote-desktop-setup.md) for XFCE, TigerVNC, and Chrome.
Run them as the same non-root user, supervise them alongside Roost, and set:

```sh
export ROOST_DESKTOP_DISPLAY=:1
export ROOST_DESKTOP_ORIGIN=https://YOUR_VM_HOSTNAME
export ROOST_DESKTOP_VNC_PORT=5901
```

Restart Roost with these variables. Keep VNC on `127.0.0.1:5901`; the Roost
computer button carries the desktop over authenticated HTTPS/WebSockets.
There is no need to publish a second noVNC port.

The tested VM also required Chrome's `--no-sandbox` flag. This is a separate,
explicit choice to rely on the dedicated VM for browser isolation. Keep Chrome's
sandbox enabled on hosts where it works. After VM sleep, desktop/browser startup
may need to clean up stale locks after confirming the old processes are gone;
never delete the browser profile to fix a lock.

## Public websites

The marketing and documentation sites are separate static services. See
[docs on Railway](deploy-docs-railway.md) and
[marketing on Railway](deploy-marketing-railway.md). They can use Railway's CDN
and do not need passkey login or a running agent VM.

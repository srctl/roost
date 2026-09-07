# Roost on Railway

Railway is an advanced deployment option for the Roost app. This repository does
not yet include a Railway-ready Dockerfile or a verified Railway app deployment.
Use [the Linux installation](install.md) for the established installation path.
The public marketing and docs sites can be hosted independently; see
[Public websites](public-sites.md).

The requirements below were checked against Railway's documentation on
September 7, 2026. They describe what a deployment must provide, not a claim that
Roost has passed those checks on Railway.

## Check the Codex sandbox first

Roost starts Codex as a child process and requests its `workspace-write` sandbox.
Current Codex uses `bwrap` and `seccomp` on Linux. Container restrictions on
namespaces, setuid execution, or system calls can prevent sandboxed commands
from running even when the web app starts successfully. See
[OpenAI's sandbox documentation](https://learn.chatgpt.com/docs/agent-approvals-security#os-level-sandbox).

Railway's Dockerfile support establishes how to build an image; it does not
establish that the image can perform every Linux sandbox operation. Verify the
chosen Railway runtime with the exact Codex version you intend to ship before
putting agent data there. Do not change Roost to full filesystem access or bypass
approvals to turn a failed compatibility check into a successful deployment.

If sandboxed commands fail, keep this deployment experimental and use a Linux
VM whose sandbox requirements you can satisfy. Installing a `bubblewrap` package
alone cannot change restrictions imposed by the host.

## Persistent service requirements

Use one continuously running service with one persistent volume. Roost's HTTP
server and background worker run in the same Node process; there is no separate
Railway cron service to configure.

| Setting | Required configuration |
| --- | --- |
| Source directory | Repository root |
| Runtime | Linux with Node.js 22.13+ and a compatible Codex executable |
| Build | `corepack pnpm install --frozen-lockfile`, then `corepack pnpm build` |
| Start | `node .output/server/index.mjs` |
| Process count | One instance; no replicas |
| Volume mount | `/data` |
| App data | `ROOST_DATA_DIR=/data/roost` |
| Host Codex login and configuration | `CODEX_HOME=/data/codex-host` |
| Codex executable | `ROOST_CODEX_BINARY` pointing to the executable installed in the image |
| Listener | `HOST=0.0.0.0`, using Railway's `PORT` |
| Health check | `/api/health` |
| Serverless | Disabled |

Railway supplies ephemeral service filesystems by default. A volume preserves
the directories beneath its mount point; it is available at runtime, including
startup, but not during builds or pre-deploy commands. Create the two data
directories during startup and make them writable by the process user. Keep the
host Codex directory private to that user. See
[using volumes](https://docs.railway.com/volumes).

Railway currently permits one volume per service and does not support replicas
for services with volumes. Deploying a new version causes a short interruption
while the volume moves to the replacement deployment. This matches Roost's
single-instance storage model, but it is not a zero-downtime setup. See
[volume constraints](https://docs.railway.com/volumes/reference#caveats).

Keep Serverless disabled: Railway can sleep inactive services, and Roost's
internal timer cannot run while its process is asleep. See
[Railway Serverless](https://docs.railway.com/deployments/serverless).
For proxy routing, Railway expects the server to bind to `0.0.0.0` and its
provided port. See [listener configuration](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond).

## Supply the runtime and protect access

Before deploying, provide a reproducible image that installs Node, pnpm, Codex,
and the command-line tools your agents need. Use the release pins in
[`scripts/runtime-versions.json`](../scripts/runtime-versions.json) as the
repository's reference. A source build does not install Codex automatically.
Railway can build a Dockerfile at the source root or a configured custom path;
see [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles).

Do not run `roost setup`, `roost update`, or the systemd server commands inside a
normal Railway service. Those commands manage a Linux machine installation.
Railway manages the container process and replaces its image for updates.

Roost has no built-in application authentication. Configure an authenticated
HTTPS proxy that protects both HTTP and WebSocket requests before providing
remote access. The Roost service should be reachable only through that proxy or
private access. A generated Railway domain supplies routing and TLS, not a
Roost login; do not leave a direct public route that bypasses the authentication
layer. Desktop origin checks do not replace that layer.

Connect Codex from **Settings → Connect Codex** through the protected app. The
host login must be file-based and stored under the persistent `CODEX_HOME` above.
Roost creates the individual agents' Codex homes under `ROOST_DATA_DIR`; do not
point every agent at the host login directory. Never bake login files into an
image or copy them into the repository. Back up the whole `/data` volume so that
both agent data and the host login/configuration are retained.

Computer use requires additional X11, capture/input, and loopback VNC setup in
the same environment as Roost. A plain Node image does not provide a desktop.
Leave it disabled unless you have separately completed and tested
[shared computer setup](computer.md).

## Railway Cloud Agents as an evaluation host

Railway also offers persistent Cloud Agent VMs through Priority Boarding. These
include Codex and a development toolchain. They are a different product from
ordinary Railway services and may be useful for evaluating Roost on a VM.
Railway currently describes their public URL as a preview facility and directs
production traffic to services. This guide does not treat a Cloud Agent VM as a
verified production installation. See [Cloud Agents](https://docs.railway.com/cloud-agents).

With a current Railway CLI, enable Cloud Agents, sign in, and inspect the target
project before launching. Replace `YOUR_PROJECT_ID` and `YOUR_ENVIRONMENT`:

```sh
railway login
railway ca setup
railway code --codex --keep-awake --project YOUR_PROJECT_ID --environment YOUR_ENVIRONMENT
```

This launch uses your local Codex file-based sign-in and transfers it to the VM.
`--keep-awake` keeps the VM running after disconnect; without it, disconnecting
can put the machine to sleep. Running compute is billed while disconnected.
The CLI reuses an existing agent in the chosen environment when possible. See
[the `railway code` reference](https://docs.railway.com/cli/code).

Inside the VM, inspect its architecture, runtime versions, user, persistent
paths, and service manager. Follow [source setup](development.md#run-from-source)
or the Linux installer only when its prerequisites are present. Keep Roost on
loopback while configuring private access. A Cloud Agent's public port 8080 is
not a substitute for authentication, and its bundled browser is not evidence
that Roost's X11/VNC integration is configured.

## Verify before relying on it

Ask your deployment agent to report these results from the actual environment:

1. The deployed version starts, `/api/health` passes, and unauthorized HTTP and
   WebSocket access is rejected by the private access layer.
2. A disposable Roost agent can run a harmless command and write/read a file in
   its workspace with the normal sandbox and approvals enabled.
3. The same conversation, file, agent settings, and Codex login survive a service
   restart. Treat interrupted work as interrupted; do not replay it automatically.
4. A scheduled test finishes with the browser closed and appears in history.
5. Backups include the app data and host Codex configuration, and their restore
   procedure is recorded.

A green deployment or a successful model response alone does not verify command
execution, persistent login, background work, or desktop access.

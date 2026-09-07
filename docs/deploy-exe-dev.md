# Deploy on exe.dev

Run Roost on an exe.dev VM so your agents can keep working while your laptop is
closed. The installer handles Node, Codex, and starting Roost for you.

You'll need an [exe.dev account](https://exe.dev) and a Codex account. Use the
default VM image; Roost's packaged installer requires Linux x64 with systemd.

## 1. Create a VM

Run this on your computer:

```sh
ssh exe.dev new --name=roost-home
```

Then connect using the SSH command printed in the result. Keep the HTTPS URL
handy—you'll open it in step 4. [exe.dev VM creation](https://exe.dev/docs/cli-new).

Already have a dedicated VM for Roost? Skip creation and use its name instead of
`roost-home` below. If Roost is already installed, use [the update command](install.md#update).

## 2. Install Roost

Inside the VM, replace `X.Y.Z` with the version you want from
[Roost releases](https://github.com/srctl/roost/releases), without the `v` prefix.
Run this as your normal user:

```sh
ROOST_VERSION='X.Y.Z'
ROOST_INSTALLER="$(mktemp)"
curl -fL "https://github.com/srctl/roost/releases/download/v${ROOST_VERSION}/install.sh" \
  -o "$ROOST_INSTALLER" &&
  sh "$ROOST_INSTALLER" srctl/roost "$ROOST_VERSION" --skip-login
```

The installer checks prerequisites, verifies the download, and starts Roost on
port 3000. It also sets Roost to start again after a reboot.

## 3. Connect the private web address

Leave the SSH session with `exit`. Back on your computer, run:

```sh
ssh exe.dev share set-private roost-home
ssh exe.dev share port roost-home 3000
```

Keep this address private: Roost has no app login of its own. exe.dev protects
it with your account sign-in. On a reused VM, review existing access with
`ssh exe.dev share show roost-home` because making it private retains previous
grants. [exe.dev proxy settings](https://exe.dev/docs/proxy),
[sharing](https://exe.dev/docs/sharing).

## 4. Open Roost and connect Codex

Open the HTTPS URL from step 1 and sign into exe.dev. In Roost:

1. Open **Settings → Connect Codex** and finish signing in.
2. Create an agent and ask it to write a small file in its workspace.
3. Reload and confirm the conversation and file are still there.

Check the URL in a signed-out browser too—it should ask you to sign into exe.dev.
Roost now runs independently of your laptop and browser.

## Add computer use when you're ready

Chat and scheduled work are ready after setup. To let agents use a browser,
follow [Remote desktop setup](remote-desktop-setup.md), then
[Shared computer](computer.md). Use the same VM account and set
`ROOST_DESKTOP_ORIGIN` to your Roost HTTPS origin.

## After setup

- [Update and back up Roost](install.md#update).
- [Server commands and logs](install.md#server-commands).
- [Use Roost on your phone](mobile.md).
- [Deploy with an agent](for-agents.md#a-useful-deployment-request), including
  [verification of persistence and scheduled work](deployment.md#acceptance-checks-for-every-platform).

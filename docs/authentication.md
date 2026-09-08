# Sign in with a passkey

Roost is for one owner. Native passkeys let you put it at an HTTPS address
without another account service. Your fingerprint, face recognition, device PIN,
or security key unlocks the passkey; Roost never receives your biometric data.

**Already using exe.dev? Nothing changes.** Leave its private proxy enabled.
Native login is optional and stays off until you run the command below.

## 1. Enable login on your server

Choose the final HTTPS address first. Run this as the account that runs Roost:

```sh
roost auth setup --origin https://roost.example.com
```

Open the printed link within **15 minutes** and choose **Create passkey**.
The link works once. Keep it private: whoever uses it can become the owner.
If it expires before enrollment, run the setup command again.

Setup immediately locks the app, even before enrollment. It takes effect without
restarting Roost. After you finish, ordinary visits show **Sign in with a passkey**.
Set up authentication **before** making the HTTP listener publicly reachable.

For a **source build**, use its bundled CLI and explicitly select the same data
directory as the server:

```sh
ROOST_DATA_DIR=/absolute/path/to/data node .output/cli/roost.mjs \
  auth setup --origin https://roost.example.com
```

These commands require Roost 0.1.33 or newer, or a source build containing native
auth. Update older packaged installations before enabling login.
Packaged installations use `$ROOST_HOME/data` (normally
`~/.local/share/roost/data`). Source servers default to `.roost`; do not omit
`ROOST_DATA_DIR` from the source CLI command and accidentally configure a
different installation. For local development, `http://localhost:PORT` is also
supported; remote addresses require HTTPS.

## 2. Add a backup and manage sessions

Open **Settings → Manage passkeys and signed-in sessions**. Give a second
passkey a recognizable name, then choose **Add a passkey**. You can remove old
passkeys, revoke another browser's session, or sign out of this browser.

Sessions expire after 30 days. Changing passkeys or revoking sessions requires
a sign-in within the last five minutes; choose **Verify with a passkey** when
prompted. Removing a passkey also revokes the sessions created with it. You
cannot remove your last passkey through the web.

Roost sign-in is separate from **Settings → Connect Codex**, which connects the
account your agents use.

## Lost your passkeys?

Connect to the server over SSH and run:

```sh
roost auth recover
```

Open the new setup link and register a passkey. Recovery immediately revokes
**all existing passkeys and browser sessions**; agents, conversations, and files
remain intact. Source builds use the same `ROOST_DATA_DIR` and bundled CLI as
above, with `auth recover` in place of `auth setup ...`.

Passkeys belong to a hostname. To move Roost to another hostname, run
`roost auth recover --origin https://new.example.com` and register a new passkey.

## Proxy and backup details

- Forward the original `Host`, cookies, `Origin`, and WebSocket upgrades. Terminate
  HTTPS at your trusted proxy. Keep any internal HTTP listener on loopback or a
  private network, and do not cache app pages or API responses at the proxy/CDN.
- Configure `ROOST_DESKTOP_ORIGIN` to the same public origin for computer use.
  Login protects app pages, server functions, files, and desktop connections.
  Revocation closes a desktop connection within about a second; it does not stop
  the persistent desktop or running agents.
- `/api/health` and static application assets remain public; they contain no
  conversations or credentials. Agent data is never included in the login page.
- Back up the **whole data directory**, including `auth.sqlite`, while the app is
  stopped. It stores public passkeys, hashed session/setup tokens, and the chosen
  origin. Keep SSH access for recovery. Restoring an old backup can restore old
  sessions; run recovery afterward if those should remain revoked.
- Do not delete `auth.sqlite` to recover access: its absence selects the original
  private-proxy mode. Protect the filesystem and backups like the rest of Roost.
  An existing but damaged auth database fails closed.

This is a single-owner login, not separate accounts or agent isolation. Use a
separate installation for another owner.

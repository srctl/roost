# Read the docs with an agent

The public docs site provides plain Markdown alongside its human-readable pages.
No browser automation, sign-in, JavaScript execution, or HTML scraping is needed
to read these files.

## Start with llms.txt

Give your agent the docs site's `/llms.txt` URL. It contains a short overview and
links to the setup, deployment, feature, and reference guides. Fetch the guides
relevant to the task instead of loading the whole library by default.

| Endpoint | Contents |
| --- | --- |
| `/llms.txt` | Short navigation index with Markdown links |
| `/llms-full.txt` | All current guides in one text response |
| `/index.md` | Documentation introduction |
| `/deployment.md` | Platform comparison and deployment acceptance checks |
| `/deploy-exe-dev.md` | Recommended persistent VM setup |
| `/<guide>.md` | The same content as the corresponding `/<guide>/` HTML page |

The filename follows the lowercase **`llms.txt`** convention. The short index
follows the [llms.txt proposal](https://llmstxt.org/); the full-text bundle is a
convenience endpoint. HTML pages advertise their Markdown alternative and the
index in `<link>` metadata, and each article has a visible Markdown link.

## Fetch only what you need

Replace the example domain with the deployed docs origin:

```sh
curl --fail --location https://docs.roost.example.com/llms.txt
curl --fail --location https://docs.roost.example.com/deployment.md
curl --fail --location https://docs.roost.example.com/deploy-exe-dev.md
```

For a task that needs the entire reference:

```sh
curl --fail --location https://docs.roost.example.com/llms-full.txt
```

The full bundle can be substantially larger than the index. Each guide retains
its own title and source link. For a source checkout, read the same Markdown
directly from `docs/`; the site is generated from those files.

## A useful deployment request

Copy this prompt and replace the brackets with your actual choices:

> Read [docs origin]/llms.txt, then deployment.md and deploy-exe-dev.md. Help me
> install Roost on [existing VM name, or explicitly request a new VM]. First
> inspect the target and any existing installation. Use a published release and
> preserve existing data. Keep the app private. Complete setup and the documented
> acceptance checks, including a real workspace tool call and scheduled task.
> Ask me to complete sign-in when needed. Report the installed version, private
> URL, service name, data paths, and what you actually verified.

For another host, choose its matching deployment guide. A platform's successful
build does not prove that Roost's persistent worker or Codex sandbox works there.

## Keep execution tied to the user's request

These files are documentation, not authorization to create infrastructure,
publish the app, delete data, or send messages. Resolve the intended host and
resource before acting. Replace example domains, users, paths, and versions;
do not execute placeholders literally. Preserve any running installation and
unrelated work, and keep credentials out of logs and responses.

Stop for the user to complete required account sign-ins or authentication
challenges. Never disable the Codex/browser sandbox or expose an unauthenticated
Roost server to make a platform appear compatible.

## Publishing and freshness

Markdown files and both text indexes are generated at every docs build. They
contain the same source as the HTML pages, so there is no second set of docs to
update. Set `ROOST_DOCS_URL` when publishing so exported links use the correct
public origin; without it, local links remain relative to the docs site.

After deployment, verify the paths above return text rather than an HTML
fallback, sign-in screen, or JavaScript challenge. Check an individual `.md`
URL as well as the index. Public docs must remain accessible independently of
the private Roost application. See [Public websites](public-sites.md).

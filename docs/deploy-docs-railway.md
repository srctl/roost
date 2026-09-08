# Documentation on Railway

Deploy the public docs as a standalone Railway service with Railway's built-in
CDN. This does **not** deploy the private Roost app. No database, volume, Codex
credentials, or agent data is needed. Deploy the
[marketing website](deploy-marketing-railway.md) as a separate service and set
both services' public URL variables to connect their navigation.

## Configure the service

Create a project and an empty service named `docs`. Keep its source root at the
**repository root**: the docs build uses the root package manifest, lockfile, and
`docs/` Markdown files. Configure these service settings before deploying:

| Setting | Value |
| --- | --- |
| Service variable `RAILWAY_DOCKERFILE_PATH` | `sites/docs/Dockerfile` (enables Dockerfile detection) |
| Dockerfile path | `sites/docs/Dockerfile` |
| Health check path | `/healthz` |
| Health check timeout | 60 seconds |
| Watch paths | `/docs/**`, `/sites/docs/**`, `/package.json`, `/pnpm-lock.yaml`, `/.dockerignore` |

Leave build/start command overrides empty; the Dockerfile supplies both. Do not
set the source root to `sites/docs` or use the app's default build/start commands.
Railway no longer accepts legacy `railway.json`/`railway.toml` configuration for
new services; configure these settings in Railway instead.

The image builds with Node.js 24.15.0 and the pinned pnpm version, then copies only
the static output into Caddy. The Docker build context is restricted by the root
`.dockerignore`, excluding local environment files and unrelated app sources. Caddy
listens on Railway's `PORT` (8080 locally), serves real directory indexes, and
returns the generated error page with HTTP 404 for missing paths.

Generate a Railway public domain targeting port 8080. For a custom domain, add it
in Railway and complete the DNS records Railway provides. HTTPS terminates at
Railway's edge; Caddy serves HTTP inside the service.

Set these optional **build-time** variables before deploying:

- `ROOST_DOCS_URL`: the docs' public origin, such as `https://docs.example.com`.
  If omitted, the Docker build uses `https://$RAILWAY_PUBLIC_DOMAIN` when available.
- `ROOST_WEBSITE_URL`: the marketing site's public origin. If omitted, navigation
  links to the public GitHub repository until the marketing site is hosted.

Rebuild after changing either address. Never supply app secrets to this service.

From the repository root, with the project linked:

```sh
railway up --service docs --environment production --ci
```

For automatic GitHub deployments, first commit and push the deployment files,
then connect the repository and intended branch in Railway. Keep the Dockerfile
path and watch paths above. A CLI upload alone does not enable GitHub autodeploys.

## Enable the CDN

Railway's CDN is available on all plans at no additional CDN charge, but is
**off by default**. The origin service still incurs normal Railway usage charges.
After the public domain is applied, run these in the linked project:

```sh
railway cdn enable --service docs --environment production
railway cdn update --service docs --environment production \
  --html-caching auto --purge-on-deploy all
railway cdn status --service docs --environment production --json
```

These are service-level settings; configure them for every new
service/environment. If Railway reports the feature is unavailable,
enable CDN access through Priority Boarding in the dashboard before retrying.

The Caddy configuration supplies explicit caching headers:

| Response | Browser cache | Railway edge cache |
| --- | --- | --- |
| HTML, Markdown, `llms*.txt`, search JSON, unversioned CSS/images | Revalidate (`max-age=0`) | Five minutes (`s-maxage=300`) |
| Existing fingerprinted JS/CSS under `/assets/` | One year, immutable | One year |
| Health checks and errors | Do not store | Do not store |

Use **purge all on successful deploy**, not just purge HTML: Markdown, search
JSON, and `assets/docs.css` also have stable URLs. Purges propagate across edge
locations in seconds (typically around ten seconds), not instantly. Browser
caches remain safe because only fingerprinted assets are immutable. Railway
provides Brotli/gzip compression at the edge.

Do not enable browser challenges or sign-in requirements for this public service;
agent clients need direct access to the Markdown and `llms*.txt` resources.
Never copy these public caching rules onto the private Roost app.

## Verify a deployment

Wait for Railway to report `SUCCESS`, then run the HTTP smoke check:

```sh
node scripts/check-docs-deployment.mjs https://YOUR-DOMAIN --cdn
```

It checks direct article routing, cache headers, agent-readable MIME types,
search JSON, real 404s, and CDN hits on HTML, CSS, JavaScript, and Markdown.
Without `--cdn`, it also works against a local Caddy container:

```sh
docker build -f sites/docs/Dockerfile -t roost-docs .
docker run --rm -p 8080:8080 roost-docs
# In another terminal:
node scripts/check-docs-deployment.mjs http://localhost:8080
```

Check `https://YOUR-DOMAIN/.railway/cdn-trace?json` to see the serving edge location.
A repeated GET should return `x-cache: HIT` and an `age` header. CDN hits bypass
origin logs, so service request counts undercount real visits. Open the site in a
browser too and check search, the mobile menu, and code copying.

To clear the cache manually:

```sh
railway cdn purge all --service docs --environment production
```

See [Railway CDN](https://docs.railway.com/networking/cdn),
[Dockerfile builds](https://docs.railway.com/builds/dockerfiles), and
[Public websites](public-sites.md). The experimental private app deployment is
covered separately in [Roost on Railway](deploy-railway.md).

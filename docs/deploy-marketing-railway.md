# Marketing website on Railway

Deploy the public marketing site as a separate `marketing` service alongside the
[docs service](deploy-docs-railway.md). Both are static sites; neither runs the
private Roost app or needs databases, volumes, or credentials.

## Service settings

Create an empty service and configure it before deploying:

| Setting | Value |
| --- | --- |
| Source root | Repository root, not `sites/marketing` |
| Service variable `RAILWAY_DOCKERFILE_PATH` | `sites/marketing/Dockerfile` |
| Dockerfile path | `sites/marketing/Dockerfile` |
| Health check | `/healthz`, timeout 60 seconds |
| Watch paths | `/sites/marketing/**`, `/package.json`, `/pnpm-lock.yaml`, `/.dockerignore` |
| Public domain target port | 8080 |

Leave build and start overrides empty. The Dockerfile builds only the marketing
site using the root package manifest and lockfile, then copies its `dist` output
into Caddy. The root `.dockerignore` excludes app sources and local environment
files. Caddy listens on Railway's `PORT`; Railway handles HTTPS and compression.
Missing files return HTTP 404, not a fallback to the home page.

Set `ROOST_DOCS_URL` to the docs service's HTTPS origin. Set
`ROOST_WEBSITE_URL` to the marketing site's origin; if omitted, its Docker build
uses `https://$RAILWAY_PUBLIC_DOMAIN`. Set these same two public URL variables on
the docs service too and rebuild both so their navigation connects correctly.
Use origins without subdirectories. No app secrets are required.

With the correct project linked, deploy from the repository root:

```sh
railway up --service marketing --environment production --ci
```

For GitHub autodeploys, first commit and push the deployment files, then connect
the intended repository and branch in Railway. Keep the Dockerfile and watch
paths above. A CLI deployment does not automatically enable GitHub autodeploys.

## CDN caching

After applying the public domain, enable the CDN for this service separately:

```sh
railway cdn enable --service marketing --environment production
railway cdn update --service marketing --environment production \
  --html-caching auto --purge-on-deploy all
railway cdn status --service marketing --environment production --json
```

The cache policy matches the docs service: HTML, SVGs, Markdown, and `llms.txt`
revalidate in browsers and cache for five minutes at Railway's edge. Existing
fingerprinted CSS and JavaScript cache for one year with `immutable`. Health
checks and errors use `no-store`. Purge-all on successful deploy refreshes stable
URLs too; purges may take around ten seconds to propagate. CDN access has no
additional CDN charge, but the separate origin service incurs Railway usage.

## Verify

Wait for `SUCCESS`, then run:

```sh
node scripts/check-marketing-deployment.mjs https://MARKETING-DOMAIN https://DOCS-DOMAIN --cdn
```

This checks public links and canonical URLs, local assets, agent-readable text,
real 404s, the docs backlink, and actual CDN hits. Use the same command without
`--cdn` for a local Caddy deployment. For browser verification, switch between
Moss, Wisp, and Peach, toggle Take control, download the example launch plan,
and check the layout on mobile.

Custom domains require adding Railway's DNS records and rebuilding both sites
with their new public origins. See [Public websites](public-sites.md) and
[Railway's CDN documentation](https://docs.railway.com/networking/cdn).

FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY packages/typescript-config ./packages/typescript-config
COPY packages/site-analytics ./packages/site-analytics
RUN corepack pnpm --filter @roost/docs... install --frozen-lockfile
COPY docs ./docs
COPY apps/docs ./apps/docs
ARG VITE_DATADOG_APPLICATION_ID
ARG VITE_DATADOG_CLIENT_TOKEN
ARG VITE_DATADOG_SITE
ARG VITE_DATADOG_ENV
ARG ROOST_WEBSITE_URL
ARG ROOST_DOCS_URL
ARG RAILWAY_PUBLIC_DOMAIN
RUN ROOST_DOCS_URL="${ROOST_DOCS_URL:-${RAILWAY_PUBLIC_DOMAIN:+https://${RAILWAY_PUBLIC_DOMAIN}}}" corepack pnpm build:docs

FROM caddy:2.11.2-alpine
COPY apps/docs/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/docs/dist /srv
ENV PORT=8080
EXPOSE 8080

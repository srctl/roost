FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY docs ./docs
COPY sites/docs ./sites/docs
ARG ROOST_WEBSITE_URL
ARG ROOST_DOCS_URL
ARG RAILWAY_PUBLIC_DOMAIN
RUN ROOST_DOCS_URL="${ROOST_DOCS_URL:-${RAILWAY_PUBLIC_DOMAIN:+https://${RAILWAY_PUBLIC_DOMAIN}}}" corepack pnpm build:docs

FROM caddy:2.11.2-alpine
COPY sites/docs/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/sites/docs/dist /srv
ENV PORT=8080
EXPOSE 8080

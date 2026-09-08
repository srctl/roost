FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY sites/marketing ./sites/marketing
ARG ROOST_WEBSITE_URL
ARG ROOST_DOCS_URL
ARG RAILWAY_PUBLIC_DOMAIN
RUN ROOST_WEBSITE_URL="${ROOST_WEBSITE_URL:-${RAILWAY_PUBLIC_DOMAIN:+https://${RAILWAY_PUBLIC_DOMAIN}}}" corepack pnpm build:marketing

FROM caddy:2.11.2-alpine
COPY sites/marketing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/sites/marketing/dist /srv
ENV PORT=8080
EXPOSE 8080

# Hosted build (Railway): API + MCP + dashboard in one process on $PORT.
# Secrets come from Railway Variables at runtime; nothing secret is baked into the image.
FROM node:22-bookworm-slim

# Toolchain for native modules (better-sqlite3) if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Same-origin API calls from the browser.
ENV NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ttp/web build

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/ttp.sqlite
EXPOSE 4000
CMD ["pnpm", "--filter", "@ttp/api", "start:hosted"]

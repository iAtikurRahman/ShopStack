# Matches the local Node version (v24). Prisma downloads its engine for
# debian-openssl-3.0.x via the "native" binaryTarget on this base image.
FROM node:24-bookworm-slim

# slim images ship without the `openssl` binary; Prisma's engine detection
# shells out to it and mis-defaults to openssl-1.1.x without it, which then
# fails with an empty "Schema engine error" on every migrate command.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Dependencies first for better layer caching. `npm ci` runs the postinstall
# hook (prisma:generate), so the Prisma schemas have to be present already.
# The generated clients land in /src/generated, which is also in
# .dockerignore so a later COPY can't overwrite them with host copies.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# The build evaluates route modules, and src/lib/auth.ts throws at import
# time when SESSION_SECRET is unset. A throwaway placeholder satisfies that
# check - the real secret is injected at runtime (see docker-compose.yml).
RUN SESSION_SECRET=build-placeholder npm run build

# The full node_modules (including the Prisma CLI and tsx) stays in the
# image on purpose: tenant provisioning shells out to `npx prisma migrate
# deploy` at runtime, which the Next.js "standalone" output wouldn't carry.

ENV NODE_ENV=production
EXPOSE 30051

# Waits for MySQL, applies central + tenant migrations, seeds the central
# admin (idempotent), then starts the app on port 30051 (see server.js).
ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]

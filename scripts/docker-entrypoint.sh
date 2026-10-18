#!/bin/sh
# Container entrypoint: wait for MySQL -> migrate -> seed -> start the app.
# `migrate deploy` (not `migrate dev`) is used on purpose - it only applies
# committed migrations and needs no shadow database.
set -e

echo "==> Waiting for MySQL at ${MYSQL_HOST:-db}:${MYSQL_PORT:-3306} ..."
node scripts/wait-for-db.js

echo "==> Applying central migrations ..."
npm run prisma:deploy:central

echo "==> Applying tenant migrations to the scratch database ..."
npm run prisma:deploy:tenant

echo "==> Seeding central database (idempotent - skips if admin exists) ..."
npm run prisma:seed:central

echo "==> Starting app on http://0.0.0.0:30051 ..."
exec node server.js

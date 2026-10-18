# ShopStack
Multi-shop inventory, sales, and expense management system with real-time stock tracking and analytics.

# To-run (local, npm):

Needs a MySQL server on localhost:3306 (credentials in .env).

1. npm install                     (postinstall runs prisma:generate)
2. npm run prisma:migrate:central  (creates sornagro_central + tables; uses `migrate dev`, so the DB user needs CREATE privilege for the shadow DB)
3. npm run prisma:migrate:tenant   (applies tenant migrations to the scratch DB named by DATABASE_URL)
4. npm run prisma:seed:central     (creates the project admin, idempotent - default admin@shopstack.dev / changeme123)
5. npm run dev                     (http://localhost:3000)

When a new tenant migration is added later:
- npm run prisma:deploy:central / npm run prisma:deploy:tenant - apply committed migrations only (`migrate deploy`, no shadow DB needed)
- npm run prisma:deploy:tenants - re-apply tenant migrations to every already-provisioned company database

# To-run (docker compose - MySQL + app both in Docker):

1. docker compose up --build
2. App: http://localhost:30051 (port hardcoded in server.js). MySQL is only reachable over the compose network; see docker-compose.yml for how to temporarily publish its port for host tools.

The app container waits for MySQL to accept connections, runs `prisma migrate deploy` for both schemas, seeds the central admin, then starts the app. Data persists in the `mysql_data` / `uploads` volumes; `docker compose down -v` wipes them. DB credentials live in docker-compose.yml (mirrors .env - keep both in sync).

# To-deploy (server / production):
Servers usually only grant the DB user access to specific existing databases (no global CREATE privilege), so `prisma migrate dev` fails with P3014/P1010 because it can't create a shadow database. Use `migrate deploy` instead — it applies existing migration files without needing a shadow database:
1. npm install
2. npm run prisma:generate
3. npm run prisma:deploy   (or prisma:deploy:central / prisma:deploy:tenant individually)
4. npm run build && npm start
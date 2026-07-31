# ShopStack
Multi-shop inventory, sales, and expense management system with real-time stock tracking and analytics.

# To-run:
1. npm install
2. npm run prisma:generate
3. npm run prisma:migrate:central
4. npm run dev

# To-deploy (server / production):
Servers usually only grant the DB user access to specific existing databases (no global CREATE privilege), so `prisma migrate dev` fails with P3014/P1010 because it can't create a shadow database. Use `migrate deploy` instead — it applies existing migration files without needing a shadow database:
1. npm install
2. npm run prisma:generate
3. npm run prisma:deploy   (or prisma:deploy:central / prisma:deploy:tenant individually)
4. npm run build && npm start
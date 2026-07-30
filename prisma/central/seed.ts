import { PrismaClient } from "@/generated/central";
import { hashPassword } from "@/lib/auth";

const centralDb = new PrismaClient();

async function main() {
  const email = process.env.SEED_PROJECT_ADMIN_EMAIL ?? "admin@shopstack.dev";
  const password = process.env.SEED_PROJECT_ADMIN_PASSWORD ?? "changeme123";

  const existing = await centralDb.projectAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(`ProjectAdmin ${email} already exists, skipping.`);
    return;
  }

  await centralDb.projectAdmin.create({
    data: {
      name: "Project Admin",
      email,
      password: await hashPassword(password),
    },
  });
  console.log(`Seeded ProjectAdmin ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await centralDb.$disconnect();
  });

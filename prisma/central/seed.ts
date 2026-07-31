import { PrismaClient } from "@/generated/central";
import { hashPassword } from "@/lib/auth";

const centralDb = new PrismaClient();

async function seedProjectAdmin() {
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

async function seedSubscriptionDefaults() {
  await centralDb.subscriptionPlan.upsert({
    where: { name: "Monthly" },
    update: {},
    create: { name: "Monthly", duration: "monthly", durationDays: 30, price: 100 },
  });
  await centralDb.subscriptionPlan.upsert({
    where: { name: "Yearly" },
    update: {},
    create: { name: "Yearly", duration: "yearly", durationDays: 365, price: 1000 },
  });

  await Promise.all(
    [
      { method: "bkash" as const, displayName: "bKash" },
      { method: "nagad" as const, displayName: "Nagad" },
      { method: "rocket" as const, displayName: "Rocket" },
    ].map(({ method, displayName }) =>
      centralDb.paymentMethodConfig.upsert({ where: { method }, update: {}, create: { method, displayName } })
    )
  );

  await centralDb.advertisementSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  console.log("Seeded default subscription plans (Monthly ৳100, Yearly ৳1000), payment methods, and ad settings.");
}

async function main() {
  await seedProjectAdmin();
  await seedSubscriptionDefaults();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await centralDb.$disconnect();
  });

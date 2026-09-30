/**
 * Applies the committed tenant migrations to every tenant database that is
 * already registered in the central DB.
 *
 * Why this exists: `npm run prisma:deploy:tenant` targets only the single
 * database named by DATABASE_URL, which is a scratch/dev database. Companies
 * provisioned afterwards get their tenant database migrated by
 * provisionCompany(), but companies that were already provisioned never get
 * re-migrated - so a new migration in prisma/tenant/migrations silently fails
 * to reach them and their features break at runtime against a missing table
 * or column.
 *
 * Usage: npm run prisma:deploy:tenants
 */
import { centralDb } from "@/lib/central-db";
import { buildTenantDbUrl } from "@/lib/provisioning/create-database";
import { runTenantMigrations } from "@/lib/provisioning/run-tenant-migrations";

async function main(): Promise<void> {
  const companies = await centralDb.company.findMany({
    include: { tenantDb: true },
    orderBy: { id: "asc" },
  });

  if (companies.length === 0) {
    console.log("No companies are registered in the central database.");
    return;
  }

  const targets = companies.filter((c) => c.tenantDb !== null);
  const unmapped = companies.filter((c) => c.tenantDb === null);

  for (const company of unmapped) {
    console.log(`SKIP  ${company.name} (${company.slug}): no tenant database is mapped`);
  }

  if (targets.length === 0) {
    console.log("No mapped tenant databases to migrate.");
    return;
  }

  const failed: string[] = [];

  for (const company of targets) {
    const tenantDatabase = company.tenantDb!;
    console.log(`\n=== ${company.name} (${company.slug}) -> ${tenantDatabase.dbName} ===`);

    try {
      const result = await runTenantMigrations(buildTenantDbUrl(tenantDatabase.dbName));

      // Prisma's own progress lines, so a failure here is diagnosable.
      const detail = `${result.stdout}${result.stderr}`.trim();
      if (detail) console.log(detail);

      console.log(
        result.applied.length > 0
          ? `OK    applied ${result.applied.length} migration(s) to ${tenantDatabase.dbName}`
          : `OK    ${tenantDatabase.dbName} was already up to date`
      );
    } catch (err) {
      failed.push(tenantDatabase.dbName);
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`FAIL  ${tenantDatabase.dbName}: ${reason}`);
    }
  }

  console.log(
    `\nMigrated ${targets.length - failed.length}/${targets.length} tenant database(s).`
  );

  if (failed.length > 0) {
    console.error(`Still needing attention: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await centralDb.$disconnect();
  });
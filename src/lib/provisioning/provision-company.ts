import { centralDb } from "@/lib/central-db";
import { PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import { hashPassword } from "@/lib/auth";
import { PERMISSION_CATALOG } from "@/lib/permission-catalog";
import { createTenantDatabase, dropTenantDatabase, buildTenantDbUrl } from "@/lib/provisioning/create-database";
import { runTenantMigrations } from "@/lib/provisioning/run-tenant-migrations";

export interface ProvisionCompanyInput {
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface ProvisionCompanyResult {
  companyId: number;
}

/**
 * End-to-end company provisioning saga. Spans two databases (central +
 * the new tenant database), so it cannot be one atomic transaction -
 * instead it advances an explicit status state machine on TenantDatabase
 * (pending -> creating_db -> migrating -> seeding -> ready, or failed)
 * so a partial failure is inspectable and resumable rather than requiring
 * manual SQL cleanup.
 */
export async function provisionCompany(
  input: ProvisionCompanyInput
): Promise<ProvisionCompanyResult> {
  const { company, tenantDatabase } = await centralDb.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: input.companyName, slug: input.slug, status: "provisioning" },
    });
    const tenantDatabase = await tx.tenantDatabase.create({
      data: {
        companyId: company.id,
        dbName: `shopstack_tenant_${company.id}`,
        status: "pending",
      },
    });
    return { company, tenantDatabase };
  });

  try {
    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "creating_db" },
    });
    await createTenantDatabase(tenantDatabase.dbName);

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "migrating" },
    });
    const tenantUrl = buildTenantDbUrl(tenantDatabase.dbName);
    await runTenantMigrations(tenantUrl);

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "seeding" },
    });
    await seedTenantDatabase(tenantUrl, {
      companyId: company.id,
      companyName: company.name,
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      adminPassword: input.adminPassword,
    });

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "ready" },
    });
    await centralDb.company.update({
      where: { id: company.id },
      data: { status: "active" },
    });
    await centralDb.centralAuditLog.create({
      data: {
        action: "company.provisioned",
        targetType: "Company",
        targetId: company.id,
      },
    });

    return { companyId: company.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "failed", lastError: message },
    });
    await centralDb.company.update({
      where: { id: company.id },
      data: { status: "failed" },
    });
    // Best-effort cleanup; provisioning can be retried from a clean slate.
    await dropTenantDatabase(tenantDatabase.dbName).catch(() => undefined);
    throw err;
  }
}

/**
 * Retries a failed provisioning attempt for an existing Company row.
 * Simplified MVP resumption: rather than resuming from the exact failed
 * step, it drops any partially-created tenant database for a clean slate
 * and re-runs creation/migration/seeding. Requires the original admin
 * credentials again since they aren't persisted anywhere before the
 * tenant User row is created.
 */
export async function retryCompanyProvisioning(
  companyId: number,
  adminInput: { adminName: string; adminEmail: string; adminPassword: string }
): Promise<ProvisionCompanyResult> {
  const company = await centralDb.company.findUnique({
    where: { id: companyId },
    include: { tenantDb: true },
  });
  if (!company || !company.tenantDb) {
    throw new Error(`Company ${companyId} has no provisioning record to retry`);
  }
  if (company.tenantDb.status === "ready") {
    throw new Error(`Company ${companyId} is already provisioned`);
  }

  const tenantDatabase = company.tenantDb;
  await dropTenantDatabase(tenantDatabase.dbName).catch(() => undefined);

  try {
    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "creating_db", lastError: null },
    });
    await createTenantDatabase(tenantDatabase.dbName);

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "migrating" },
    });
    const tenantUrl = buildTenantDbUrl(tenantDatabase.dbName);
    await runTenantMigrations(tenantUrl);

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "seeding" },
    });
    await seedTenantDatabase(tenantUrl, {
      companyId: company.id,
      companyName: company.name,
      ...adminInput,
    });

    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "ready" },
    });
    await centralDb.company.update({ where: { id: company.id }, data: { status: "active" } });
    await centralDb.centralAuditLog.create({
      data: { action: "company.provisioning_retried", targetType: "Company", targetId: company.id },
    });

    return { companyId: company.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await centralDb.tenantDatabase.update({
      where: { id: tenantDatabase.id },
      data: { status: "failed", lastError: message },
    });
    await centralDb.company.update({ where: { id: company.id }, data: { status: "failed" } });
    await dropTenantDatabase(tenantDatabase.dbName).catch(() => undefined);
    throw err;
  }
}

async function seedTenantDatabase(
  tenantUrl: string,
  opts: {
    companyId: number;
    companyName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }
) {
  const tenantDb = new TenantPrismaClient({ datasources: { db: { url: tenantUrl } } });
  try {
    await tenantDb.tenantConfig.create({
      data: { id: 1, companyId: opts.companyId, companyName: opts.companyName },
    });

    await tenantDb.permission.createMany({
      data: PERMISSION_CATALOG.map(({ key, label, description }) => ({ key, label, description })),
    });

    const mainStore = await tenantDb.store.create({
      data: { name: "Main Store" },
    });
    await tenantDb.warehouse.create({
      data: { name: "Main Warehouse", storeId: mainStore.id },
    });

    await tenantDb.user.create({
      data: {
        name: opts.adminName,
        email: opts.adminEmail,
        password: await hashPassword(opts.adminPassword),
        role: "company_admin",
      },
    });
  } finally {
    await tenantDb.$disconnect();
  }
}

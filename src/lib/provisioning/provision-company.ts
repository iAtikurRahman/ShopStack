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

function tenantDbNameForSlug(slug: string): string {
  return `sornagro_tenant_${slug.replace(/-/g, "_")}`;
}

/**
 * End-to-end company provisioning. Nothing is written to the central DB
 * until the tenant database is confirmed reachable (this host's DB user
 * has no CREATE privilege, so createTenantDatabase() either creates it,
 * when possible, or verifies one was already created manually and throws
 * a "create this database" error otherwise). Any failure - including
 * after central rows exist - rolls everything back completely (drops the
 * tenant db best-effort, deletes the Company/TenantDatabase rows), so a
 * failed attempt leaves no trace and the exact same request can just be
 * resubmitted once the underlying problem is fixed.
 */
export async function provisionCompany(
  input: ProvisionCompanyInput
): Promise<ProvisionCompanyResult> {
  const existing = await centralDb.company.findUnique({ where: { slug: input.slug } });
  if (existing) {
    if (existing.status === "active") {
      throw new Error("A company with this slug already exists");
    }
    // Leftover row from a previous failed attempt (e.g. from before this
    // rollback behavior existed) - clear it so this is a clean retry.
    await centralDb.tenantDatabase.deleteMany({ where: { companyId: existing.id } });
    await centralDb.company.delete({ where: { id: existing.id } });
  }

  const dbName = tenantDbNameForSlug(input.slug);
  await createTenantDatabase(dbName);

  try {
    const { company, tenantDatabase } = await centralDb.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: input.companyName, slug: input.slug, status: "provisioning" },
      });
      const tenantDatabase = await tx.tenantDatabase.create({
        data: { companyId: company.id, dbName, status: "migrating" },
      });
      return { company, tenantDatabase };
    });

    const tenantUrl = buildTenantDbUrl(dbName);
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
      data: { action: "company.provisioned", targetType: "Company", targetId: company.id },
    });

    return { companyId: company.id };
  } catch (err) {
    await centralDb.tenantDatabase.deleteMany({
      where: { dbName },
    });
    await centralDb.company.deleteMany({ where: { slug: input.slug } });
    await dropTenantDatabase(dbName).catch(() => undefined);
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

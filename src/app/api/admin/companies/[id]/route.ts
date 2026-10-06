import { NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import type { CompanyStatus } from "@/generated/central";
import { withAuth } from "@/lib/api-guard";
import { buildTenantDbUrl } from "@/lib/provisioning/create-database";
import { validatePassword } from "@/lib/validate-password";
import { hashPassword } from "@/lib/auth";

// Statuses a Project Admin can set by hand. The other two (provisioning and
// failed) are lifecycle states owned by the provisioning pipeline.
const EDITABLE_STATUSES: CompanyStatus[] = ["active", "suspended", "archived"];

type CompanyAdmin = { id: number; name: string; email: string };

/** The tenant DB holds the company admin account. Read it only when the DB
 * exists - a company still being provisioned (or a broken one) simply has no
 * admin row to show, so this never throws at the caller. */
async function loadCompanyAdmin(dbName: string | null): Promise<CompanyAdmin | null> {
  if (!dbName) return null;
  try {
    const tenant = new TenantPrismaClient({
      datasources: { db: { url: buildTenantDbUrl(dbName) } },
    });
    try {
      const admin = await tenant.user.findFirst({
        where: { role: "company_admin" },
        select: { id: true, name: true, email: true },
      });
      return admin ?? null;
    } finally {
      await tenant.$disconnect();
    }
  } catch {
    return null;
  }
}

export const GET = withAuth<{ id: string }>(
  async (_request, { params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ message: "Invalid company id" }, { status: 400 });
    }

    const company = await centralDb.company.findUnique({
      where: { id },
      include: { tenantDb: true },
    });
    if (!company) {
      return NextResponse.json({ message: "Company not found" }, { status: 404 });
    }

    const admin = await loadCompanyAdmin(company.tenantDb?.dbName ?? null);
    return NextResponse.json({ company, admin });
  },
  { scope: "project_admin" }
);

export const PATCH = withAuth<{ id: string }>(
  async (request, { params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ message: "Invalid company id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const { companyName, slug, status, adminName, adminEmail, adminPassword } = body ?? {};

    const company = await centralDb.company.findUnique({
      where: { id },
      include: { tenantDb: true },
    });
    if (!company) {
      return NextResponse.json({ message: "Company not found" }, { status: 404 });
    }

    const companyData: { name?: string; slug?: string; status?: CompanyStatus } = {};
    if (typeof companyName === "string" && companyName.trim()) {
      companyData.name = companyName.trim();
    }
    if (typeof slug === "string" && slug.trim() && slug.trim() !== company.slug) {
      const newSlug = slug.trim();
      if (!/^[a-z0-9-]+$/.test(newSlug)) {
        return NextResponse.json(
          { message: "slug must be lowercase letters, numbers, and hyphens only" },
          { status: 400 }
        );
      }
      const duplicate = await centralDb.company.findUnique({ where: { slug: newSlug } });
      if (duplicate) {
        return NextResponse.json({ message: "A company with this slug already exists" }, { status: 400 });
      }
      companyData.slug = newSlug;
    }
    if (typeof status === "string" && (EDITABLE_STATUSES as string[]).includes(status)) {
      companyData.status = status as CompanyStatus;
    }

    let newPassword: string | null = null;
    if (adminPassword != null && adminPassword !== "") {
      const passwordError = validatePassword(adminPassword);
      if (passwordError) {
        return NextResponse.json({ message: passwordError }, { status: 400 });
      }
      newPassword = adminPassword;
    }

    const updated = await centralDb.company.update({ where: { id }, data: companyData });

    // Mirror the edit into the tenant database - the company name it seeds into
    // tenantConfig, and the admin's own account fields. A tenant DB that cannot
    // be reached keeps the central row it already got; the Project Admin can
    // retry the admin fields once the DB is healthy again.
    if (company.tenantDb?.dbName) {
      try {
        const tenant = new TenantPrismaClient({
          datasources: { db: { url: buildTenantDbUrl(company.tenantDb.dbName) } },
        });
        try {
          if (companyData.name) {
            await tenant.tenantConfig.update({
              where: { id: 1 },
              data: { companyName: companyData.name },
            });
          }
          const adminUser = await tenant.user.findFirst({ where: { role: "company_admin" } });
          if (adminUser) {
            const adminData: { name?: string; email?: string; password?: string } = {};
            if (typeof adminName === "string" && adminName.trim()) adminData.name = adminName.trim();
            if (typeof adminEmail === "string" && adminEmail.trim()) adminData.email = adminEmail.trim();
            if (newPassword) adminData.password = await hashPassword(newPassword);
            if (Object.keys(adminData).length > 0) {
              await tenant.user.update({ where: { id: adminUser.id }, data: adminData });
            }
          }
        } finally {
          await tenant.$disconnect();
        }
      } catch {
        // Keep the central update; the tenant mirror is best-effort.
      }
    }

    await centralDb.centralAuditLog.create({
      data: {
        action: "company.updated",
        targetType: "Company",
        targetId: updated.id,
        metadata: { fields: Object.keys(companyData) },
      },
    });

    return NextResponse.json({ company: updated });
  },
  { scope: "project_admin" }
);
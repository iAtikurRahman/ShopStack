import { NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { provisionCompany } from "@/lib/provisioning/provision-company";
import { withAuth } from "@/lib/api-guard";
import { validatePassword } from "@/lib/validate-password";

export const GET = withAuth(async () => {
  const companies = await centralDb.company.findMany({
    include: { tenantDb: true, subscription: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ companies });
}, { scope: "project_admin" });

export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { companyName, slug, adminName, adminEmail, adminPassword } = body ?? {};

  if (!companyName || !slug || !adminName || !adminEmail || !adminPassword) {
    return NextResponse.json(
      { message: "companyName, slug, adminName, adminEmail, adminPassword are all required" },
      { status: 400 }
    );
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { message: "slug must be lowercase letters, numbers, and hyphens only" },
      { status: 400 }
    );
  }
  const passwordError = validatePassword(adminPassword);
  if (passwordError) {
    return NextResponse.json({ message: passwordError }, { status: 400 });
  }

  const existing = await centralDb.company.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ message: "A company with this slug already exists" }, { status: 409 });
  }

  try {
    const result = await provisionCompany({ companyName, slug, adminName, adminEmail, adminPassword });
    return NextResponse.json({ companyId: result.companyId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provisioning failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}, { scope: "project_admin" });

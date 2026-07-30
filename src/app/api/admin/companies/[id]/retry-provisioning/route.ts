import { NextResponse } from "next/server";
import { retryCompanyProvisioning } from "@/lib/provisioning/provision-company";
import { withAuth } from "@/lib/api-guard";

export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const companyId = Number(params.id);
  if (!Number.isInteger(companyId)) {
    return NextResponse.json({ message: "Invalid company id" }, { status: 400 });
  }

  const body = await request.json();
  const { adminName, adminEmail, adminPassword } = body ?? {};
  if (!adminName || !adminEmail || !adminPassword) {
    return NextResponse.json(
      { message: "adminName, adminEmail, adminPassword are required to retry provisioning" },
      { status: 400 }
    );
  }

  try {
    const result = await retryCompanyProvisioning(companyId, { adminName, adminEmail, adminPassword });
    return NextResponse.json({ companyId: result.companyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}, { scope: "project_admin" });

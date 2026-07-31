import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ suppliers });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, phone, email, address } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const supplier = await db.supplier.create({
    data: { name, phone: phone || null, email: email || null, address: address || null },
  });
  await writeAuditLog(db, session, {
    action: "supplier.created",
    entityType: "Supplier",
    entityId: supplier.id,
    after: { name: supplier.name },
  });
  return NextResponse.json({ supplier }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });

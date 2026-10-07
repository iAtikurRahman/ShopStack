import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { parseOpeningDue } from "@/lib/due";
import { reportLetterhead } from "@/lib/reports/letterhead";

export const GET = withAuth(async (_request, { session, db }) => {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
  });
  // Letterhead rides along so the client can print the list with the shop's
  // own name at the top, the same way the reports print.
  return NextResponse.json({ suppliers, letterhead: await reportLetterhead(db, session) });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, phone, email, address, previousDue } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  // Optional opening balance - what we already owed this supplier. Absent
  // means 0, so an existing caller that never heard of the field is unaffected.
  const due = parseOpeningDue(previousDue);
  if ("error" in due) {
    return NextResponse.json({ message: due.error }, { status: 400 });
  }

  const supplier = await db.supplier.create({
    data: {
      name,
      phone: phone || null,
      email: email || null,
      address: address || null,
      dueAmount: due.value,
    },
  });
  await writeAuditLog(db, session, {
    action: "supplier.created",
    entityType: "Supplier",
    entityId: supplier.id,
    // The opening due is money, so it belongs in the audit trail alongside the
    // name - it is the figure someone would later query for.
    after: { name: supplier.name, dueAmount: due.value },
  });
  return NextResponse.json({ supplier }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

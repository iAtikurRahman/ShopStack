import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore } from "@/lib/tenant-access";

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const storeId = Number(params.id);
  if (!Number.isInteger(storeId) || storeId < 1) {
    return NextResponse.json({ message: "Invalid store id" }, { status: 400 });
  }
  // A store manager may only edit their own store; answering 404 rather than
  // 403 keeps the existence of any other store hidden from them.
  if (!canAccessStore(session, storeId)) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const before = await db.store.findUnique({ where: { id: storeId } });
  if (!before) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  // imageUrl is deliberately absent from this list - the picture is only ever
  // written by the /image route, which validates the file itself.
  const { name, address, phone, isActive } = body ?? {};

  const store = await db.store.update({
    where: { id: storeId },
    data: { name, address, phone, isActive },
  });

  await writeAuditLog(db, session, {
    action: "store.updated",
    entityType: "Store",
    entityId: store.id,
    before: { name: before.name, isActive: before.isActive },
    after: { name: store.name, isActive: store.isActive },
  });

  return NextResponse.json({ store });
}, { scope: "tenant", roles: ["company_admin"] });

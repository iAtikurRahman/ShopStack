import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

// Tenant-wide warehouse list (read-only) so a store can pick a transfer
// destination in another store. GET is intentionally not store-scoped -
// see POST below for the store-scoped creation path.
export const GET = withAuth(async (_request, { db }) => {
  const warehouses = await db.warehouse.findMany({
    where: { isActive: true },
    include: { store: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ warehouses });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

// A Store Manager may create warehouses under their OWN store only -
// storeId always comes from the session, never a client-supplied value,
// so a manager can't provision a warehouse into another store. Company-wide
// roles may pass an explicit storeId.
export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, location, storeId: suppliedStoreId } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }
  const storeId = session.storeId ?? (suppliedStoreId ? Number(suppliedStoreId) : null);
  if (!storeId) {
    return NextResponse.json({ message: "storeId is required for company-wide roles" }, { status: 400 });
  }

  const warehouse = await db.warehouse.create({
    data: { name, location, storeId },
  });

  await writeAuditLog(db, session, {
    action: "warehouse.created",
    entityType: "Warehouse",
    entityId: warehouse.id,
    after: { name: warehouse.name, storeId },
  });

  return NextResponse.json({ warehouse }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

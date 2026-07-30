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
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

// A Store Manager may create warehouses under their OWN store only -
// storeId always comes from the session, never a client-supplied value,
// so a manager can't provision a warehouse into another store.
export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, location } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }
  if (!session.storeId) {
    return NextResponse.json({ message: "No store assigned to this account" }, { status: 400 });
  }

  const warehouse = await db.warehouse.create({
    data: { name, location, storeId: session.storeId },
  });

  await writeAuditLog(db, session, {
    action: "warehouse.created",
    entityType: "Warehouse",
    entityId: warehouse.id,
    after: { name: warehouse.name, storeId: session.storeId },
  });

  return NextResponse.json({ warehouse }, { status: 201 });
}, { scope: "tenant", roles: ["store_manager"] });

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth<{ id: string }>(async (_request, { db, params }) => {
  const storeId = Number(params.id);
  if (!Number.isInteger(storeId)) {
    return NextResponse.json({ message: "Invalid store id" }, { status: 400 });
  }

  const warehouses = await db.warehouse.findMany({
    where: { storeId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ warehouses });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const storeId = Number(params.id);
  if (!Number.isInteger(storeId)) {
    return NextResponse.json({ message: "Invalid store id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const { name } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const warehouse = await db.warehouse.create({ data: { name, storeId } });
  await writeAuditLog(db, session, {
    action: "warehouse.created",
    entityType: "Warehouse",
    entityId: warehouse.id,
    after: { name: warehouse.name, storeId },
  });
  return NextResponse.json({ warehouse }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });

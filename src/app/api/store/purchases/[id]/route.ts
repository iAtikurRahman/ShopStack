import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { storeScopeWhere } from "@/lib/tenant-access";

export const GET = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const purchaseId = Number(params.id);
  if (!Number.isInteger(purchaseId)) {
    return NextResponse.json({ message: "Invalid purchase id" }, { status: 400 });
  }

  // Same store-scoping as the list: a purchase can span several warehouses, so
  // it is visible to a store when any one line landed in one of its warehouses.
  // A company_admin sees everything (storeScopeWhere returns {} for them).
  const warehouses = await db.warehouse.findMany({ where: storeScopeWhere(session) });
  const warehouseIds = warehouses.map((w) => w.id);

  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, purchasePrice: true } },
          warehouse: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!purchase) {
    return NextResponse.json({ message: "Purchase not found" }, { status: 404 });
  }

  const visible =
    (purchase.warehouseId != null && warehouseIds.includes(purchase.warehouseId)) ||
    purchase.items.some((i) => warehouseIds.includes(i.warehouseId));
  if (!visible) {
    return NextResponse.json({ message: "Purchase not found" }, { status: 404 });
  }

  return NextResponse.json({ purchase });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });
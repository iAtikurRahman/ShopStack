import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { session, db }) => {
  const warehouses = await db.warehouse.findMany({ where: { storeId: session.storeId ?? -1 } });
  const warehouseIds = warehouses.map((w) => w.id);

  const supplierReturns = await db.supplierReturn.findMany({
    where: { warehouseId: { in: warehouseIds } },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ supplierReturns });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { supplierId, warehouseId, productId, quantity, reason } = body ?? {};

  if (!supplierId || !warehouseId || !productId || !quantity) {
    return NextResponse.json(
      { message: "supplierId, warehouseId, productId, and quantity are required" },
      { status: 400 }
    );
  }
  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    return NextResponse.json({ message: "quantity must be a positive whole number" }, { status: 400 });
  }

  const warehouse = await db.warehouse.findUnique({ where: { id: Number(warehouseId) } });
  if (!warehouse || warehouse.storeId !== session.storeId) {
    return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
  }
  const supplier = await db.supplier.findUnique({ where: { id: Number(supplierId) } });
  if (!supplier) {
    return NextResponse.json({ message: "Supplier not found" }, { status: 404 });
  }

  try {
    const supplierReturn = await db.$transaction(async (tx) => {
      const stock = await tx.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId: Number(warehouseId), productId: Number(productId) } },
      });
      if (!stock || stock.quantity < parsedQuantity) {
        throw new Error("Insufficient stock for this product in the selected warehouse");
      }

      await tx.warehouseStock.update({
        where: { warehouseId_productId: { warehouseId: Number(warehouseId), productId: Number(productId) } },
        data: { quantity: { decrement: parsedQuantity } },
      });

      return tx.supplierReturn.create({
        data: {
          supplierId: Number(supplierId),
          warehouseId: Number(warehouseId),
          productId: Number(productId),
          quantity: parsedQuantity,
          reason: reason || null,
          processedById: session.userId,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });
    });

    return NextResponse.json({ supplierReturn }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supplier return failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "can_manage_inventory" });

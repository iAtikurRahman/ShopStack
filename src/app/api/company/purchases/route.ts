import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

// Company-wide purchase (stock-in) recording - unlike /api/store/purchases,
// not restricted to the requesting user's own store/warehouse.
export const GET = withAuth(async (_request, { db }) => {
  const purchases = await db.purchase.findMany({
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { purchasedAt: "desc" },
  });

  return NextResponse.json({ purchases });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { supplierId, warehouseId, reference, items, purchasedAt } = body ?? {};

  if (!supplierId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { message: "supplierId and a non-empty items array are required" },
      { status: 400 }
    );
  }

  // Every line picks its own warehouse so one supplier delivery can be split
  // across warehouses; a single top-level warehouseId is still accepted.
  const requestedWarehouseIds = [
    ...new Set(
      items
        .map((item: { warehouseId?: number }) => Number(item.warehouseId ?? warehouseId))
        .map((id: number) => (Number.isInteger(id) && id > 0 ? id : 0))
    ),
  ];
  if (requestedWarehouseIds.some((id) => id === 0)) {
    return NextResponse.json({ message: "Each item requires a warehouseId" }, { status: 400 });
  }

  const warehouseCount = await db.warehouse.count({ where: { id: { in: requestedWarehouseIds } } });
  if (warehouseCount !== requestedWarehouseIds.length) {
    return NextResponse.json({ message: "Warehouse not found" }, { status: 404 });
  }

  const supplier = await db.supplier.findUnique({ where: { id: Number(supplierId) } });
  if (!supplier) {
    return NextResponse.json({ message: "Supplier not found" }, { status: 404 });
  }

  let parsedPurchasedAt = new Date();
  if (purchasedAt) {
    parsedPurchasedAt = new Date(purchasedAt);
    if (Number.isNaN(parsedPurchasedAt.getTime())) {
      return NextResponse.json({ message: "Invalid purchasedAt date" }, { status: 400 });
    }
    if (parsedPurchasedAt.getTime() > Date.now()) {
      return NextResponse.json({ message: "purchasedAt cannot be in the future" }, { status: 400 });
    }
  }

  try {
    const purchase = await db.$transaction(async (tx) => {
      let totalCost = 0;
      const lineItems: { productId: number; quantity: number; unitCost: number; warehouseId: number }[] = [];

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        const unitCost = Number(item.unitCost);
        const lineWarehouseId = Number(item.warehouseId ?? warehouseId);
        if (!productId || !quantity || quantity <= 0 || Number.isNaN(unitCost) || unitCost < 0) {
          throw new Error("Each item requires a valid productId, positive quantity, and non-negative unitCost");
        }

        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: lineWarehouseId, productId } },
          update: { quantity: { increment: quantity } },
          create: { warehouseId: lineWarehouseId, productId, quantity },
        });

        totalCost += quantity * unitCost;
        lineItems.push({ productId, quantity, unitCost, warehouseId: lineWarehouseId });
      }

      const warehouseIdsUsed = [...new Set(lineItems.map((i) => i.warehouseId))];
      const primaryWarehouseId = warehouseIdsUsed.length === 1 ? warehouseIdsUsed[0] : null;

      return tx.purchase.create({
        data: {
          supplierId: Number(supplierId),
          warehouseId: primaryWarehouseId,
          receivedById: session.userId,
          reference: reference || null,
          totalCost,
          purchasedAt: parsedPurchasedAt,
          items: { create: lineItems },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true } },
              warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
            },
          },
          supplier: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json({ purchase }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Purchase failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

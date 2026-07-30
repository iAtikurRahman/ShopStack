import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { session, db }) => {
  const warehouses = await db.warehouse.findMany({ where: { storeId: session.storeId ?? -1 } });
  const warehouseIds = warehouses.map((w) => w.id);

  const transfers = await db.stockTransfer.findMany({
    where: {
      OR: [{ fromWarehouseId: { in: warehouseIds } }, { toWarehouseId: { in: warehouseIds } }],
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ transfers });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { fromWarehouseId, toWarehouseId, items } = body ?? {};

  if (!fromWarehouseId || !toWarehouseId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { message: "fromWarehouseId, toWarehouseId, and a non-empty items array are required" },
      { status: 400 }
    );
  }
  if (Number(fromWarehouseId) === Number(toWarehouseId)) {
    return NextResponse.json({ message: "Source and destination warehouse must differ" }, { status: 400 });
  }

  const fromWarehouse = await db.warehouse.findUnique({ where: { id: Number(fromWarehouseId) } });
  if (!fromWarehouse || fromWarehouse.storeId !== session.storeId) {
    return NextResponse.json({ message: "Source warehouse not found in your store" }, { status: 404 });
  }
  const toWarehouse = await db.warehouse.findUnique({ where: { id: Number(toWarehouseId) } });
  if (!toWarehouse) {
    return NextResponse.json({ message: "Destination warehouse not found" }, { status: 404 });
  }

  try {
    const transfer = await db.$transaction(async (tx) => {
      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);
        if (!productId || !quantity || quantity <= 0) {
          throw new Error("Each item requires a valid productId and a positive quantity");
        }

        const sourceStock = await tx.warehouseStock.findUnique({
          where: { warehouseId_productId: { warehouseId: Number(fromWarehouseId), productId } },
        });
        if (!sourceStock || sourceStock.quantity < quantity) {
          throw new Error(`Insufficient stock for product ${productId} in the source warehouse`);
        }

        await tx.warehouseStock.update({
          where: { warehouseId_productId: { warehouseId: Number(fromWarehouseId), productId } },
          data: { quantity: { decrement: quantity } },
        });
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: Number(toWarehouseId), productId } },
          update: { quantity: { increment: quantity } },
          create: { warehouseId: Number(toWarehouseId), productId, quantity },
        });
      }

      return tx.stockTransfer.create({
        data: {
          fromWarehouseId: Number(fromWarehouseId),
          toWarehouseId: Number(toWarehouseId),
          status: "completed",
          requestedById: session.userId,
          completedById: session.userId,
          completedAt: new Date(),
          items: {
            create: items.map((item: { productId: number; quantity: number }) => ({
              productId: Number(item.productId),
              quantity: Number(item.quantity),
            })),
          },
        },
        include: { items: true },
      });
    });

    return NextResponse.json({ transfer }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "can_manage_inventory" });

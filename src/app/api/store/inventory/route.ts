import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { session, db }) => {
  const warehouses = await db.warehouse.findMany({
    where: { storeId: session.storeId ?? -1 },
    orderBy: { createdAt: "asc" },
  });
  const warehouseIds = warehouses.map((w) => w.id);

  const [products, stock] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      include: { category: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.warehouseStock.findMany({ where: { warehouseId: { in: warehouseIds } } }),
  ]);

  return NextResponse.json({ warehouses, products, stock });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

export const PATCH = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { warehouseId, productId, quantity, lowStockThreshold } = body ?? {};

  if (!warehouseId || !productId || quantity === undefined) {
    return NextResponse.json(
      { message: "warehouseId, productId, and quantity are required" },
      { status: 400 }
    );
  }

  const warehouse = await db.warehouse.findUnique({ where: { id: Number(warehouseId) } });
  if (!warehouse || warehouse.storeId !== session.storeId) {
    return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
  }

  const stock = await db.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId: Number(warehouseId), productId: Number(productId) } },
    update: {
      quantity: Number(quantity),
      ...(lowStockThreshold !== undefined ? { lowStockThreshold: Number(lowStockThreshold) } : {}),
    },
    create: {
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantity: Number(quantity),
      lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : 5,
    },
  });

  return NextResponse.json({ stock });
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "can_manage_inventory" });

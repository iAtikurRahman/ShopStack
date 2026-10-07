import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { convertQuantity, normalizeUnit } from "@/lib/units";

// Company-wide stock transfers between any two warehouses (unlike
// /api/store/transfers, which restricts the source warehouse to the
// requesting store_manager/store_user's own store).
export const GET = withAuth(async (_request, { db }) => {
  const transfers = await db.stockTransfer.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ transfers });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

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

  const [fromWarehouse, toWarehouse] = await Promise.all([
    db.warehouse.findUnique({ where: { id: Number(fromWarehouseId) } }),
    db.warehouse.findUnique({ where: { id: Number(toWarehouseId) } }),
  ]);
  if (!fromWarehouse) {
    return NextResponse.json({ message: "Source warehouse not found" }, { status: 404 });
  }
  if (!toWarehouse) {
    return NextResponse.json({ message: "Destination warehouse not found" }, { status: 404 });
  }

  const productIds = [...new Set(items.map((item: { productId?: number }) => Number(item.productId)))];
  const transferProducts = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, unit: true, unitValue: true },
  });
  if (transferProducts.length !== productIds.length) {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }
  const productById = new Map(transferProducts.map((p) => [p.id, p]));

  try {
    const transfer = await db.$transaction(async (tx) => {
      const lineItems: { productId: number; quantity: number; unit: string; stockQuantity: number }[] = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Each item requires a valid productId and a positive quantity");
        }

        const product = productById.get(productId);
        if (!product) throw new Error(`Product ${productId} not found`);
        const unit = normalizeUnit(item.unit ?? product.unit);
        const packFactor = product.unitValue ? Number(product.unitValue) : null;
        const stockQuantity = convertQuantity(quantity, unit, product.unit, packFactor);
        if (stockQuantity === null) throw new Error(`Unit ${unit} does not match product ${productId}`);

        const sourceStock = await tx.warehouseStock.findUnique({
          where: { warehouseId_productId: { warehouseId: Number(fromWarehouseId), productId } },
        });
        if (!sourceStock || Number(sourceStock.quantity) < stockQuantity) {
          throw new Error(`Insufficient stock for product ${productId} in the source warehouse`);
        }

        await tx.warehouseStock.update({
          where: { warehouseId_productId: { warehouseId: Number(fromWarehouseId), productId } },
          data: { quantity: { decrement: stockQuantity } },
        });
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: Number(toWarehouseId), productId } },
          update: { quantity: { increment: stockQuantity } },
          create: { warehouseId: Number(toWarehouseId), productId, quantity: stockQuantity },
        });

        lineItems.push({ productId, quantity, unit, stockQuantity });
      }

      return tx.stockTransfer.create({
        data: {
          fromWarehouseId: Number(fromWarehouseId),
          toWarehouseId: Number(toWarehouseId),
          status: "completed",
          requestedById: session.userId,
          completedById: session.userId,
          completedAt: new Date(),
          items: { create: lineItems },
        },
        include: { items: true },
      });
    });

    return NextResponse.json({ transfer }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

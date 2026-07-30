import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

async function assertAccessibleFromMyStore(
  db: import("@/generated/tenant").PrismaClient,
  storeId: number | null,
  productId: number
) {
  const myWarehouses = await db.warehouse.findMany({ where: { storeId: storeId ?? -1 }, select: { id: true } });
  const stock = await db.warehouseStock.findFirst({
    where: { productId, warehouseId: { in: myWarehouses.map((w) => w.id) } },
  });
  return stock;
}

export const PUT = withAuth<{ productId: string }>(async (request, { session, db, params }) => {
  const productId = Number(params.productId);
  if (!Number.isInteger(productId)) {
    return NextResponse.json({ message: "Invalid product id" }, { status: 400 });
  }

  const stock = await assertAccessibleFromMyStore(db, session.storeId, productId);
  if (!stock) {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }

  const before = await db.product.findUnique({ where: { id: productId } });
  const body = await request.json().catch(() => null);
  const { name, purchasePrice, salePrice, taxRate, categoryId } = body ?? {};

  const product = await db.product.update({
    where: { id: productId },
    data: {
      name,
      purchasePrice,
      salePrice,
      taxRate,
      categoryId: categoryId !== undefined ? (categoryId ? Number(categoryId) : null) : undefined,
    },
  });

  await writeAuditLog(db, session, {
    action: "product.updated",
    entityType: "Product",
    entityId: product.id,
    before: { name: before?.name, salePrice: before?.salePrice?.toString() },
    after: { name: product.name, salePrice: product.salePrice.toString() },
  });

  return NextResponse.json({ product });
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "product.update" });

// De-stocks the product from the caller's own store's warehouse(s) rather
// than deleting the global catalog Product outright - the same product
// may still be stocked in other stores' warehouses, or referenced by past
// SaleItem/StockTransferItem rows, so a hard delete would either break
// referential history or silently affect other stores. If this was the
// product's last remaining stock anywhere in the tenant, the catalog
// entry itself is soft-deactivated too.
export const DELETE = withAuth<{ productId: string }>(async (_request, { session, db, params }) => {
  const productId = Number(params.productId);
  if (!Number.isInteger(productId)) {
    return NextResponse.json({ message: "Invalid product id" }, { status: 400 });
  }

  const myWarehouses = await db.warehouse.findMany({
    where: { storeId: session.storeId ?? -1 },
    select: { id: true },
  });
  const myWarehouseIds = myWarehouses.map((w) => w.id);

  const stockInMyStore = await db.warehouseStock.findMany({
    where: { productId, warehouseId: { in: myWarehouseIds } },
  });
  if (stockInMyStore.length === 0) {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }

  await db.warehouseStock.deleteMany({
    where: { productId, warehouseId: { in: myWarehouseIds } },
  });

  const remaining = await db.warehouseStock.count({ where: { productId } });
  if (remaining === 0) {
    await db.product.update({ where: { id: productId }, data: { isActive: false } });
  }

  await writeAuditLog(db, session, {
    action: "product.removed_from_warehouse",
    entityType: "Product",
    entityId: productId,
    after: { removedFromWarehouseIds: myWarehouseIds, catalogDeactivated: remaining === 0 },
  });

  return NextResponse.json({ ok: true });
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "product.delete" });

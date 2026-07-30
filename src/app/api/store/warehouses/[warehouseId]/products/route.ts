import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

async function loadOwnWarehouse(
  db: import("@/generated/tenant").PrismaClient,
  storeId: number | null,
  warehouseId: number
) {
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse || warehouse.storeId !== storeId) return null;
  return warehouse;
}

export const GET = withAuth<{ warehouseId: string }>(async (_request, { session, db, params }) => {
  const warehouseId = Number(params.warehouseId);
  if (!Number.isInteger(warehouseId)) {
    return NextResponse.json({ message: "Invalid warehouse id" }, { status: 400 });
  }

  const warehouse = await loadOwnWarehouse(db, session.storeId, warehouseId);
  if (!warehouse) {
    return NextResponse.json({ message: "Warehouse not found" }, { status: 404 });
  }

  const stock = await db.warehouseStock.findMany({
    where: { warehouseId },
    include: { product: { include: { category: { select: { name: true } } } } },
    orderBy: { product: { name: "asc" } },
  });

  return NextResponse.json({
    products: stock.map((s) => ({
      warehouseStockId: s.id,
      productId: s.productId,
      sku: s.product.sku,
      name: s.product.name,
      category: s.product.category?.name ?? null,
      purchasePrice: s.product.purchasePrice,
      salePrice: s.product.salePrice,
      taxRate: s.product.taxRate,
      quantity: s.quantity,
      lowStockThreshold: s.lowStockThreshold,
    })),
  });
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "product.view" });

// Creates a catalog Product (or reuses one by SKU) and stocks it into this
// warehouse. The Product itself is a tenant-wide catalog entry (see
// prisma/tenant/schema.prisma) shared across warehouses/stores; per-
// warehouse quantity lives on WarehouseStock, which is what this route
// actually scopes access through.
export const POST = withAuth<{ warehouseId: string }>(async (request, { session, db, params }) => {
  const warehouseId = Number(params.warehouseId);
  if (!Number.isInteger(warehouseId)) {
    return NextResponse.json({ message: "Invalid warehouse id" }, { status: 400 });
  }

  const warehouse = await loadOwnWarehouse(db, session.storeId, warehouseId);
  if (!warehouse) {
    return NextResponse.json({ message: "Warehouse not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { sku, name, purchasePrice, salePrice, taxRate = 0, quantity = 0, categoryId } = body ?? {};
  if (!sku || !name || purchasePrice === undefined || salePrice === undefined) {
    return NextResponse.json(
      { message: "sku, name, purchasePrice, and salePrice are required" },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    let product = await tx.product.findUnique({ where: { sku } });
    if (!product) {
      product = await tx.product.create({
        data: { sku, name, purchasePrice, salePrice, taxRate, categoryId: categoryId ? Number(categoryId) : null },
      });
    }

    const existingStock = await tx.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId, productId: product.id } },
    });
    if (existingStock) {
      throw new Error(`Product ${sku} already exists in this warehouse`);
    }

    const stock = await tx.warehouseStock.create({
      data: { warehouseId, productId: product.id, quantity: Number(quantity) },
    });

    await writeAuditLog(tx, session, {
      action: "product.created",
      entityType: "Product",
      entityId: product.id,
      after: { sku, name, warehouseId, quantity: Number(quantity) },
    });

    return { product, stock };
  }).catch((err) => {
    if (err instanceof Error) return { error: err.message };
    throw err;
  });

  if ("error" in result) {
    return NextResponse.json({ message: result.error }, { status: 409 });
  }

  return NextResponse.json(
    { product: result.product, quantity: result.stock.quantity },
    { status: 201 }
  );
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "product.create" });

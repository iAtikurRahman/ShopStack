import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const products = await db.product.findMany({
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      stock: {
        where: { quantity: { gt: 0 } },
        select: {
          quantity: true,
          warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const withTotals = products.map(({ stock, ...product }) => ({
    ...product,
    totalStock: stock.reduce((sum, s) => sum + s.quantity, 0),
    stockByStore: stock.map((s) => ({
      warehouseId: s.warehouse.id,
      warehouseName: s.warehouse.name,
      storeId: s.warehouse.store.id,
      storeName: s.warehouse.store.name,
      quantity: s.quantity,
    })),
  }));

  return NextResponse.json({ products: withTotals });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { sku, name, categoryId, supplierId, purchasePrice, salePrice, taxRate, warehouseId, quantity } = body ?? {};

  if (!sku || !name || purchasePrice === undefined || salePrice === undefined) {
    return NextResponse.json(
      { message: "sku, name, purchasePrice, and salePrice are required" },
      { status: 400 }
    );
  }
  if (quantity !== undefined && quantity !== null && quantity !== "" && !warehouseId) {
    return NextResponse.json({ message: "warehouseId is required when setting an initial quantity" }, { status: 400 });
  }

  const existing = await db.product.findUnique({ where: { sku } });
  if (existing) {
    return NextResponse.json({ message: "A product with this SKU already exists" }, { status: 409 });
  }

  const parsedQuantity =
    quantity !== undefined && quantity !== null && quantity !== "" ? Number(quantity) : null;
  if (parsedQuantity !== null && (!Number.isInteger(parsedQuantity) || parsedQuantity < 0)) {
    return NextResponse.json({ message: "quantity must be a non-negative whole number" }, { status: 400 });
  }

  const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        sku,
        name,
        categoryId: categoryId ? Number(categoryId) : null,
        supplierId: supplierId ? Number(supplierId) : null,
        purchasePrice,
        salePrice,
        taxRate: taxRate ?? 0,
      },
    });

    if (parsedQuantity !== null) {
      await tx.warehouseStock.create({
        data: { warehouseId: Number(warehouseId), productId: created.id, quantity: parsedQuantity },
      });
    }

    return created;
  });

  await writeAuditLog(db, session, {
    action: "product.created",
    entityType: "Product",
    entityId: product.id,
    after: { sku: product.sku, name: product.name },
  });
  return NextResponse.json({ product }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });

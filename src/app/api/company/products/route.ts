import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const products = await db.product.findMany({
    include: {
      category: { select: { id: true, name: true } },
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

// Catalog-only creation: name/SKU/category/unit. Price is set later per
// store via /store/warehouses/[id]/products (defaults to 0 here), and
// initial stock is recorded via /company/purchases or /store/purchases.
export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { sku, name, categoryId, taxRate, unitValue, unit } = body ?? {};

  if (!sku || !name) {
    return NextResponse.json({ message: "sku and name are required" }, { status: 400 });
  }

  const existing = await db.product.findUnique({ where: { sku } });
  if (existing) {
    return NextResponse.json({ message: "A product with this SKU already exists" }, { status: 409 });
  }

  const product = await db.product.create({
    data: {
      sku,
      name,
      categoryId: categoryId ? Number(categoryId) : null,
      purchasePrice: 0,
      salePrice: 0,
      taxRate: taxRate ?? 0,
      unitValue: unitValue !== undefined && unitValue !== null && unitValue !== "" ? Number(unitValue) : null,
      unit: unit || null,
    },
  });

  await writeAuditLog(db, session, {
    action: "product.created",
    entityType: "Product",
    entityId: product.id,
    after: { sku: product.sku, name: product.name },
  });
  return NextResponse.json({ product }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });

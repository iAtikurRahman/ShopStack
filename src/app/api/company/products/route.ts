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
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

// Catalog creation. Cost and sale price are optional so a catalog can be
// entered before any cost is known, but anything supplied is validated - the
// old behaviour hardcoded 0 here and left every product unsellable in POS.
export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { sku, name, categoryId, taxRate, unitValue, unit } = body ?? {};

  if (!sku || !name) {
    return NextResponse.json({ message: "sku and name are required" }, { status: 400 });
  }

  const pricing: Record<string, number> = {};
  for (const key of ["purchasePrice", "salePrice"] as const) {
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return NextResponse.json({ message: `${key} must be zero or greater` }, { status: 400 });
    }
    pricing[key] = value;
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
      purchasePrice: pricing.purchasePrice ?? 0,
      salePrice: pricing.salePrice ?? 0,
      taxRate: taxRate ?? 0,
      unitValue: unitValue !== undefined && unitValue !== null && unitValue !== "" ? Number(unitValue) : null,
      unit: unit || null,
    },
  });

  await writeAuditLog(db, session, {
    action: "product.created",
    entityType: "Product",
    entityId: product.id,
    after: {
      sku: product.sku,
      name: product.name,
      salePrice: product.salePrice.toString(),
    },
  });
  return NextResponse.json({ product }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

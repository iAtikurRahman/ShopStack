import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const products = await db.product.findMany({
    include: {
      category: { select: { id: true, name: true } },
      stock: { select: { quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const withTotals = products.map(({ stock, ...product }) => ({
    ...product,
    totalStock: stock.reduce((sum, s) => sum + s.quantity, 0),
  }));

  return NextResponse.json({ products: withTotals });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { sku, name, categoryId, purchasePrice, salePrice, taxRate } = body ?? {};

  if (!sku || !name || purchasePrice === undefined || salePrice === undefined) {
    return NextResponse.json(
      { message: "sku, name, purchasePrice, and salePrice are required" },
      { status: 400 }
    );
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
      purchasePrice,
      salePrice,
      taxRate: taxRate ?? 0,
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

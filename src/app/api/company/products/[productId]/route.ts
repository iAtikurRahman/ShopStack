import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

/**
 * Edits the catalog pricing of a single product. Purchase cost and sale price
 * live on the tenant-wide Product, so one price applies to every store - this
 * is the company-wide "set my selling prices" screen, not a per-store override.
 */
export const PATCH = withAuth<{ productId: string }>(async (request, { session, db, params }) => {
  const productId = Number(params.productId);
  if (!Number.isInteger(productId)) {
    return NextResponse.json({ message: "Invalid product id" }, { status: 400 });
  }

  const before = await db.product.findUnique({ where: { id: productId } });
  if (!before) {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  const fields: { purchasePrice?: number; salePrice?: number; taxRate?: number } = {};
  for (const key of ["purchasePrice", "salePrice", "taxRate"] as const) {
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return NextResponse.json({ message: `${key} must be zero or greater` }, { status: 400 });
    }
    if (key === "taxRate" && value > 100) {
      return NextResponse.json({ message: "taxRate cannot exceed 100" }, { status: 400 });
    }
    fields[key] = value;
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { message: "purchasePrice, salePrice, or taxRate is required" },
      { status: 400 }
    );
  }

  const product = await db.product.update({
    where: { id: productId },
    data: fields,
  });

  // Only the numbers - never a plaintext credential lives in the product, but
  // keep the audit row to pricing so the trail reads as a price change.
  await writeAuditLog(db, session, {
    action: "product.price_updated",
    entityType: "Product",
    entityId: productId,
    before: {
      sku: before.sku,
      purchasePrice: before.purchasePrice.toString(),
      salePrice: before.salePrice.toString(),
    },
    after: {
      sku: product.sku,
      purchasePrice: product.purchasePrice.toString(),
      salePrice: product.salePrice.toString(),
    },
  });

  return NextResponse.json({
    product: {
      id: product.id,
      purchasePrice: product.purchasePrice.toString(),
      salePrice: product.salePrice.toString(),
      taxRate: product.taxRate.toString(),
    },
  });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

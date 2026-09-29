import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Bulk pricing for a whole catalog. Applies a percentage markup on top of the
 * purchase cost, which is how a company that entered all its purchases in one
 * go then sets selling prices for everything without opening each row.
 *
 * Products with no purchase cost are skipped and reported back - there is no
 * cost to mark up, so a guessed price would be worse than none.
 */
export const PUT = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { markupPercent, taxRate, includePriced } = body ?? {};

  const markup = Number(markupPercent);
  if (!Number.isFinite(markup) || markup <= 0) {
    return NextResponse.json({ message: "markupPercent must be a number greater than 0" }, { status: 400 });
  }

  let parsedTaxRate: number | null = null;
  if (taxRate !== undefined && taxRate !== null && taxRate !== "") {
    parsedTaxRate = Number(taxRate);
    if (!Number.isFinite(parsedTaxRate) || parsedTaxRate < 0 || parsedTaxRate > 100) {
      return NextResponse.json({ message: "taxRate must be between 0 and 100" }, { status: 400 });
    }
  }

  const candidates = await db.product.findMany({
    where: {
      purchasePrice: { gt: 0 },
      isActive: true,
      ...(includePriced ? {} : { salePrice: { equals: 0 } }),
    },
    select: { id: true, sku: true, name: true, purchasePrice: true, salePrice: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ updated: 0, skipped: [] });
  }

  const updates = candidates.map((product) => ({
    id: product.id,
    sku: product.sku,
    newSalePrice: round2(Number(product.purchasePrice) * (1 + markup / 100)),
  }));

  await db.$transaction(
    updates.map((update) =>
      db.product.update({
        where: { id: update.id },
        data: {
          salePrice: update.newSalePrice,
          ...(parsedTaxRate !== null ? { taxRate: parsedTaxRate } : {}),
        },
      })
    )
  );

  await writeAuditLog(db, session, {
    action: "product.pricing_bulk_updated",
    entityType: "Product",
    after: {
      markupPercent: markup,
      taxRate: parsedTaxRate,
      updatedCount: updates.length,
      skus: updates.map((u) => u.sku),
    },
  });

  const skipped = await db.product.findMany({
    where: { isActive: true, purchasePrice: { equals: 0 } },
    select: { id: true, sku: true, name: true },
  });

  return NextResponse.json({
    updated: updates.length,
    updatedProducts: updates,
    skipped: skipped.map((p) => ({ ...p, reason: "No purchase cost recorded" })),
  });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

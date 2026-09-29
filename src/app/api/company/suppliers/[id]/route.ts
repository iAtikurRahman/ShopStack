import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth<{ id: string }>(async (_request, { db, params }) => {
  const supplierId = Number(params.id);
  if (!Number.isInteger(supplierId)) {
    return NextResponse.json({ message: "Invalid supplier id" }, { status: 400 });
  }

  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    return NextResponse.json({ message: "Supplier not found" }, { status: 404 });
  }

  // Company-wide view, matching /api/company/purchases: purchases are not
  // restricted to one store, so a supplier's whole history is shown here.
  const [purchases, supplierReturns] = await Promise.all([
    db.purchase.findMany({
      where: { supplierId },
      include: {
        warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
            warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { purchasedAt: "desc" },
    }),
    db.supplierReturn.findMany({
      where: { supplierId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ supplier, purchases, supplierReturns });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

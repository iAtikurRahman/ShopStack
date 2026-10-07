import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { reportLetterhead } from "@/lib/reports/letterhead";

export const GET = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
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
  // Payments come along for the ride for the same reason - the ledger is
  // company-wide. Voided rows are included so the history reads true.
  const [purchases, supplierReturns, payments] = await Promise.all([
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
    db.payment.findMany({
      where: { type: "supplier", customerSupplierId: supplierId },
      orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
    }),
  ]);

  // Letterhead rides along so the client can print the account with the shop's
  // own name at the top, the same way the reports print.
  const letterhead = await reportLetterhead(db, session);

  return NextResponse.json({ supplier, purchases, supplierReturns, payments, letterhead });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

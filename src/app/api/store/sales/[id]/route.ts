import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { canAccessStore } from "@/lib/tenant-access";
import { reportLetterhead } from "@/lib/reports/letterhead";

export const GET = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const saleId = Number(params.id);
  if (!Number.isInteger(saleId)) {
    return NextResponse.json({ message: "Invalid sale id" }, { status: 400 });
  }

  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      // Each line keeps the warehouse its stock left from, so the receipt can
      // show where a multi-warehouse sale drew from.
      items: { include: { warehouse: { select: { name: true } } } },
      payments: true,
      returns: { include: { items: true } },
      customer: { select: { id: true, name: true, dueAmount: true } },
    },
  });

  // storeId is always compared against the caller's own session.storeId
  // (or skipped for company-wide roles) - never trusting the URL param
  // alone - this is what stops a store_user from reaching another store's
  // sale by guessing an id.
  if (!sale || !canAccessStore(session, sale.storeId)) {
    return NextResponse.json({ message: "Sale not found" }, { status: 404 });
  }

  // Letterhead rides along so the client can print the receipt with the shop's
  // own name on it, the same way the reports print.
  const letterhead = await reportLetterhead(db, session);

  return NextResponse.json({ sale, letterhead });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

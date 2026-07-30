import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const saleId = Number(params.id);
  if (!Number.isInteger(saleId)) {
    return NextResponse.json({ message: "Invalid sale id" }, { status: 400 });
  }

  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      items: true,
      payments: true,
      returns: { include: { items: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  // storeId is always compared against the caller's own session.storeId,
  // never trusting the URL param alone - this is what stops a store_user
  // from reaching another store's sale by guessing an id.
  if (!sale || sale.storeId !== session.storeId) {
    return NextResponse.json({ message: "Sale not found" }, { status: 404 });
  }

  return NextResponse.json({ sale });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

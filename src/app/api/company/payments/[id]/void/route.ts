import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { PaymentError, voidPayment } from "@/lib/payments";

// Void is a delete rather than a hard DELETE because a booked payment is part
// of the financial record - it is reversed and kept, never removed.
export const POST = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid payment id" }, { status: 400 });
  }
  try {
    return NextResponse.json(await voidPayment(db, session, id));
  } catch (err) {
    if (err instanceof PaymentError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

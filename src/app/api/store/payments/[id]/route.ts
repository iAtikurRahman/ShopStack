import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { PaymentError, updatePayment } from "@/lib/payments";

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid payment id" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await updatePayment(db, session, id, body ?? {}));
  } catch (err) {
    if (err instanceof PaymentError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_manage_payments" });

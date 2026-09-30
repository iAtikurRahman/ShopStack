import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import {
  PaymentError,
  createPayment,
  listPaymentParties,
  listPayments,
  type ListPaymentsFilters,
} from "@/lib/payments";

export const GET = withAuth(async (request, { db }) => {
  const params = request.nextUrl.searchParams;
  const filters: ListPaymentsFilters = {
    type: params.get("type"),
    transactionType: params.get("transactionType"),
    search: params.get("search"),
    // Voided rows stay hidden by default - they are history, not live entries.
    includeVoided: params.get("includeVoided") === "true",
  };

  const [payments, parties] = await Promise.all([listPayments(db, filters), listPaymentParties(db)]);
  return NextResponse.json({ payments, ...parties });
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  try {
    const result = await createPayment(db, session, body ?? {});
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

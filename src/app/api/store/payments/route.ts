import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import {
  PaymentError,
  createPayment,
  listPaymentParties,
  listPayments,
  type ListPaymentsFilters,
} from "@/lib/payments";

// Customers and suppliers aren't store-scoped in the schema (either can deal
// with any store in the company), and Payment carries no storeId, so this is
// intentionally the same company-wide ledger as /api/company/payments rather
// than a per-store slice. The difference is the audience: a store_user can
// settle a due at the counter, while supplier *records* stay company-managed.
export const GET = withAuth(async (request, { db }) => {
  const params = request.nextUrl.searchParams;
  const filters: ListPaymentsFilters = {
    type: params.get("type"),
    transactionType: params.get("transactionType"),
    search: params.get("search"),
    includeVoided: params.get("includeVoided") === "true",
  };

  const [payments, parties] = await Promise.all([listPayments(db, filters), listPaymentParties(db)]);
  return NextResponse.json({ payments, ...parties });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_manage_payments" });

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
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_manage_payments" });

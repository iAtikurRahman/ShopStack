import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore } from "@/lib/tenant-access";

/**
 * Lets staff correct a refund after the fact. Discounts are negotiated at the
 * till, so the computed amount is a starting point rather than the final word
 * - but the edit is capped at what the sale actually collected so a typo can
 * never push more money out of the till than came in, and every change is
 * written to the audit log with the before/after amounts.
 */
export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const returnId = Number(params.id);
  if (!Number.isInteger(returnId)) {
    return NextResponse.json({ message: "Invalid return id" }, { status: 400 });
  }

  const existing = await db.return.findUnique({
    where: { id: returnId },
    include: { sale: { select: { id: true, totalAmount: true } } },
  });
  if (!existing || !canAccessStore(session, existing.storeId)) {
    return NextResponse.json({ message: "Return not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { refundAmount, reason }: { refundAmount?: number; reason?: string | null } = body ?? {};
  if (refundAmount === undefined) {
    return NextResponse.json({ message: "refundAmount is required" }, { status: 400 });
  }

  const amount = Number(refundAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ message: "refundAmount must be zero or greater" }, { status: 400 });
  }

  // Never refund more than the sale brought in. Partial returns mean a single
  // return can sit well under this, so this is a ceiling, not a target.
  const saleTotal = Number(existing.sale.totalAmount);
  if (amount > saleTotal) {
    return NextResponse.json(
      { message: `Refund cannot exceed the sale total of $${saleTotal.toFixed(2)}` },
      { status: 400 }
    );
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.return.update({
      where: { id: returnId },
      data: {
        refundAmount: Math.round(amount * 100) / 100,
        reason: reason === undefined ? existing.reason : reason,
      },
    });

    await writeAuditLog(tx, session, {
      action: "return.refund_edited",
      entityType: "Return",
      entityId: returnId,
      before: { refundAmount: existing.refundAmount.toString(), reason: existing.reason },
      after: { refundAmount: result.refundAmount.toString(), reason: result.reason },
    });

    return result;
  });

  return NextResponse.json({ return: updated });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_process_returns" });

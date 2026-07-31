import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";
import { invalidateSubscriptionStatus } from "@/lib/subscription";

export const POST = withAuth<{ id: string }>(async (request, { session, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "Invalid payment id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const { action, note } = body ?? {};
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ message: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const payment = await centralDb.subscriptionPayment.findUnique({
    where: { id },
    include: { plan: true },
  });
  if (!payment) {
    return NextResponse.json({ message: "Payment not found" }, { status: 404 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ message: "This payment has already been reviewed" }, { status: 400 });
  }

  if (action === "reject") {
    await centralDb.$transaction(async (tx) => {
      await tx.subscriptionPayment.update({
        where: { id },
        data: { status: "rejected", reviewedById: session.projectAdminId, reviewedAt: new Date(), reviewNote: note || null },
      });
      await tx.notification.create({
        data: {
          companyId: payment.companyId,
          type: "payment_rejected",
          message: `Your payment (TX: ${payment.transactionId}) was rejected.${note ? ` Reason: ${note}` : ""}`,
        },
      });
      await tx.centralAuditLog.create({
        data: {
          actorId: session.projectAdminId,
          action: "subscription.payment_rejected",
          targetType: "SubscriptionPayment",
          targetId: payment.id,
        },
      });
    });
    return NextResponse.json({ message: "Payment rejected" });
  }

  if (!payment.plan) {
    return NextResponse.json({ message: "Payment has no associated plan; cannot approve" }, { status: 400 });
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + payment.plan.durationDays * 86_400_000);

  await centralDb.$transaction(async (tx) => {
    await tx.subscriptionPayment.update({
      where: { id },
      data: { status: "approved", reviewedById: session.projectAdminId, reviewedAt: new Date(), reviewNote: note || null },
    });
    await tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: "active",
        planId: payment.planId,
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        amount: payment.amount,
        startDate,
        endDate,
      },
    });
    await tx.notification.create({
      data: {
        companyId: payment.companyId,
        type: "payment_approved",
        message: `Your payment of ৳${payment.amount} has been approved. Premium is active until ${endDate.toDateString()}.`,
      },
    });
    await tx.centralAuditLog.create({
      data: {
        actorId: session.projectAdminId,
        action: "subscription.payment_approved",
        targetType: "SubscriptionPayment",
        targetId: payment.id,
      },
    });
  });

  invalidateSubscriptionStatus(payment.companyId);

  return NextResponse.json({ message: "Payment approved" });
}, { scope: "project_admin" });

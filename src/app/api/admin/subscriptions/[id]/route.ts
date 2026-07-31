import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";
import { invalidateSubscriptionStatus } from "@/lib/subscription";

const STATUSES = ["pending", "active", "expired", "cancelled"] as const;

export const PATCH = withAuth<{ id: string }>(async (request, { params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "Invalid subscription id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const { status, endDate, planId } = body ?? {};

  if (status !== undefined && !STATUSES.includes(status)) {
    return NextResponse.json({ message: "Invalid status" }, { status: 400 });
  }

  const existing = await centralDb.subscription.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ message: "Subscription not found" }, { status: 404 });
  }

  const subscription = await centralDb.subscription.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...(planId !== undefined ? { planId: planId ? Number(planId) : null } : {}),
    },
  });

  invalidateSubscriptionStatus(existing.companyId);

  return NextResponse.json({ subscription });
}, { scope: "project_admin" });

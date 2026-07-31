import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const PATCH = withAuth<{ id: string }>(async (request, { params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "Invalid plan id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const { price, durationDays, isActive } = body ?? {};

  const existing = await centralDb.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ message: "Plan not found" }, { status: 404 });
  }

  const plan = await centralDb.subscriptionPlan.update({
    where: { id },
    data: {
      ...(price !== undefined ? { price: Number(price) } : {}),
      ...(durationDays !== undefined ? { durationDays: Number(durationDays) } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
    },
  });

  return NextResponse.json({ plan });
}, { scope: "project_admin" });

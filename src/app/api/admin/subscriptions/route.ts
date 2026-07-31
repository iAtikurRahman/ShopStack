import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const paymentMethod = searchParams.get("paymentMethod");

  const subscriptions = await centralDb.subscription.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(paymentMethod ? { paymentMethod: paymentMethod as never } : {}),
    },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      plan: { select: { id: true, name: true, price: true, durationDays: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ subscriptions });
}, { scope: "project_admin" });

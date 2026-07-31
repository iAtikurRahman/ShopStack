import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const paymentMethod = searchParams.get("paymentMethod");

  const payments = await centralDb.subscriptionPayment.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(paymentMethod ? { paymentMethod: paymentMethod as never } : {}),
    },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      plan: { select: { id: true, name: true, price: true, durationDays: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ payments });
}, { scope: "project_admin" });

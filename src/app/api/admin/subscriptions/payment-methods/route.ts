import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

const DEFAULT_METHODS: { method: "bkash" | "nagad" | "rocket"; displayName: string }[] = [
  { method: "bkash", displayName: "bKash" },
  { method: "nagad", displayName: "Nagad" },
  { method: "rocket", displayName: "Rocket" },
];

export const GET = withAuth(async () => {
  // Auto-provision the three fixed methods on first read, like AdvertisementSettings' singleton row.
  await Promise.all(
    DEFAULT_METHODS.map(({ method, displayName }) =>
      centralDb.paymentMethodConfig.upsert({
        where: { method },
        update: {},
        create: { method, displayName },
      })
    )
  );

  const paymentMethods = await centralDb.paymentMethodConfig.findMany({ orderBy: { method: "asc" } });
  return NextResponse.json({ paymentMethods });
}, { scope: "project_admin" });

export const PATCH = withAuth(async (request) => {
  const body = await request.json().catch(() => null);
  const { method, displayName, instructions, isEnabled } = body ?? {};
  if (!method) {
    return NextResponse.json({ message: "method is required" }, { status: 400 });
  }

  const existing = await centralDb.paymentMethodConfig.findUnique({ where: { method } });
  if (!existing) {
    return NextResponse.json({ message: "Payment method not found" }, { status: 404 });
  }

  const paymentMethod = await centralDb.paymentMethodConfig.update({
    where: { method },
    data: {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
    },
  });

  return NextResponse.json({ paymentMethod });
}, { scope: "project_admin" });

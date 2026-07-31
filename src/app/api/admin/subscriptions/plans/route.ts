import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

const DURATIONS = ["monthly", "quarterly", "yearly", "custom"] as const;

export const GET = withAuth(async () => {
  const plans = await centralDb.subscriptionPlan.findMany({ orderBy: { price: "asc" } });
  return NextResponse.json({ plans });
}, { scope: "project_admin" });

export const POST = withAuth(async (request) => {
  const body = await request.json().catch(() => null);
  const { name, duration, durationDays, price } = body ?? {};

  if (!name || !duration || !durationDays || price === undefined) {
    return NextResponse.json(
      { message: "name, duration, durationDays, and price are required" },
      { status: 400 }
    );
  }
  if (!DURATIONS.includes(duration)) {
    return NextResponse.json({ message: "Invalid duration" }, { status: 400 });
  }
  const parsedDays = Number(durationDays);
  const parsedPrice = Number(price);
  if (!Number.isInteger(parsedDays) || parsedDays <= 0) {
    return NextResponse.json({ message: "durationDays must be a positive whole number" }, { status: 400 });
  }
  if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return NextResponse.json({ message: "price must be a non-negative number" }, { status: 400 });
  }

  try {
    const plan = await centralDb.subscriptionPlan.create({
      data: { name, duration, durationDays: parsedDays, price: parsedPrice },
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ message: "A plan with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}, { scope: "project_admin" });

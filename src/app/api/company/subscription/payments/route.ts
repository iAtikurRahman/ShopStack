import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

const PAYMENT_METHODS = ["bkash", "nagad", "rocket"] as const;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ALLOWED_SCREENSHOT_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export const GET = withAuth(async (_request, { session }) => {
  const payments = await centralDb.subscriptionPayment.findMany({
    where: { companyId: session.companyId },
    include: { plan: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ payments });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session }) => {
  const body = await request.json().catch(() => null);
  const { planId, paymentMethod, transactionId, amount, screenshotBase64 } = body ?? {};

  if (!planId || !paymentMethod || !transactionId || amount === undefined) {
    return NextResponse.json(
      { message: "planId, paymentMethod, transactionId, and amount are required" },
      { status: 400 }
    );
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return NextResponse.json({ message: "Invalid payment method" }, { status: 400 });
  }
  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ message: "amount must be a positive number" }, { status: 400 });
  }

  const plan = await centralDb.subscriptionPlan.findUnique({ where: { id: Number(planId) } });
  if (!plan || !plan.isActive) {
    return NextResponse.json({ message: "Selected plan is not available" }, { status: 404 });
  }
  const methodConfig = await centralDb.paymentMethodConfig.findUnique({ where: { method: paymentMethod } });
  if (methodConfig && !methodConfig.isEnabled) {
    return NextResponse.json({ message: "This payment method is currently disabled" }, { status: 400 });
  }

  let screenshotPath: string | null = null;
  if (screenshotBase64) {
    const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/.exec(screenshotBase64);
    if (!match) {
      return NextResponse.json({ message: "screenshot must be a PNG or JPEG data URL" }, { status: 400 });
    }
    const [, mime, data] = match;
    const buffer = Buffer.from(data, "base64");
    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ message: "Screenshot must be under 2MB" }, { status: 400 });
    }
    const dir = path.join(process.cwd(), "public", "uploads", "subscription-payments");
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.${ALLOWED_SCREENSHOT_MIME[mime]}`;
    await writeFile(path.join(dir, filename), buffer);
    screenshotPath = `/uploads/subscription-payments/${filename}`;
  }

  try {
    const subscription = await centralDb.subscription.upsert({
      where: { companyId: session.companyId },
      update: {},
      create: { companyId: session.companyId, status: "pending" },
    });

    const payment = await centralDb.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        companyId: session.companyId,
        planId: plan.id,
        paymentMethod,
        transactionId: String(transactionId).trim(),
        amount: parsedAmount,
        screenshotPath,
        status: "pending",
      },
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ message: "This transaction ID has already been submitted" }, { status: 409 });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin"] });

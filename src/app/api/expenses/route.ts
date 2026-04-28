import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    requireAuth(request);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const expenses = await prisma.expense.findMany({
    include: { shop: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  try {
    requireAuth(request);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const body = await request.json();
  const { shopId, title, amount } = body;

  if (!shopId || !title || amount == null) {
    return NextResponse.json({ message: "Shop, title and amount are required." }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
  if (!shop) {
    return NextResponse.json({ message: "Shop not found." }, { status: 404 });
  }

  const expense = await prisma.expense.create({
    data: {
      shopId: Number(shopId),
      title,
      amount: Number(amount),
    },
    include: { shop: true },
  });

  return NextResponse.json(expense, { status: 201 });
}

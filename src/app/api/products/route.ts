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

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const filter = shopId ? { shopId: Number(shopId) } : {};

  const products = await prisma.product.findMany({
    where: filter,
    include: { shop: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(products);
}

export async function POST(request: Request) {
  try {
    requireAuth(request, ["admin", "manager"]);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const body = await request.json();
  const { shopId, name, quantity, purchasePrice, salePrice } = body;

  if (!shopId || !name || quantity == null || purchasePrice == null || salePrice == null) {
    return NextResponse.json({ message: "All product fields are required." }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
  if (!shop) {
    return NextResponse.json({ message: "Shop not found." }, { status: 404 });
  }

  const product = await prisma.product.create({
    data: {
      shopId: Number(shopId),
      name,
      quantity: Number(quantity),
      purchasePrice: Number(purchasePrice),
      salePrice: Number(salePrice),
    },
    include: { shop: true },
  });

  return NextResponse.json(product, { status: 201 });
}

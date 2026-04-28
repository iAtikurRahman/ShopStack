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

  const sales = await prisma.sale.findMany({
    include: {
      shop: true,
      items: {
        include: { product: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(sales);
}

export async function POST(request: Request) {
  try {
    requireAuth(request);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const body = await request.json();
  const { shopId, items } = body;

  if (!shopId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ message: "shopId and items are required." }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
  if (!shop) {
    return NextResponse.json({ message: "Shop not found." }, { status: 404 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item: any) => Number(item.productId)) } },
  });

  const saleItems = items.map((item: any) => {
    const product = products.find((product) => product.id === Number(item.productId));
    if (!product) {
      throw new Error("One or more products were not found.");
    }

    if (product.quantity < Number(item.quantity)) {
      throw new Error(`Not enough stock for ${product.name}.`);
    }

    return {
      productId: product.id,
      quantity: Number(item.quantity),
      price: product.salePrice,
    };
  });

  const totalAmount = saleItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);

  const sale = await prisma.$transaction(async (tx) => {
    const createdSale = await tx.sale.create({
      data: {
        shopId: Number(shopId),
        totalAmount,
        items: {
          create: saleItems,
        },
      },
      include: { items: true },
    });

    for (const item of saleItems) {
      await tx.product.update({
        where: { id: item.productId },
        data: { quantity: { decrement: item.quantity } },
      });
    }

    return createdSale;
  });

  return NextResponse.json(sale, { status: 201 });
}

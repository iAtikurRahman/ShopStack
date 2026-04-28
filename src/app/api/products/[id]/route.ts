import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    requireAuth(request, ["admin", "manager"]);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const body = await request.json();
  const { name, quantity, purchasePrice, salePrice, shopId } = body;

  const updatedProduct = await prisma.product.update({
    where: { id: Number(params.id) },
    data: {
      name: name ?? undefined,
      quantity: quantity != null ? Number(quantity) : undefined,
      purchasePrice: purchasePrice != null ? Number(purchasePrice) : undefined,
      salePrice: salePrice != null ? Number(salePrice) : undefined,
      shopId: shopId != null ? Number(shopId) : undefined,
    },
    include: { shop: true },
  });

  return NextResponse.json(updatedProduct);
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    requireAuth(request, ["admin", "manager"]);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  await prisma.product.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ message: "Product deleted." });
}

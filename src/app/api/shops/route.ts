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

  const shops = await prisma.shop.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(shops);
}

export async function POST(request: Request) {
  try {
    requireAuth(request, ["admin", "manager"]);
  } catch (error) {
    const status = (error as any).status || 401;
    return NextResponse.json({ message: (error as Error).message }, { status });
  }

  const body = await request.json();
  const { name, address } = body;

  if (!name || !address) {
    return NextResponse.json({ message: "Name and address are required." }, { status: 400 });
  }

  const shop = await prisma.shop.create({
    data: {
      name,
      address,
    },
  });

  return NextResponse.json(shop, { status: 201 });
}

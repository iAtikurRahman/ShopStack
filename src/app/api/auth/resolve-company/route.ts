import { NextRequest, NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  if (isRateLimited(`resolve-company:${getClientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ message: "Too many requests, try again shortly" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const slug = body?.slug;

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ message: "Company slug is required" }, { status: 400 });
  }

  const company = await centralDb.company.findUnique({ where: { slug } });

  if (!company || company.status !== "active") {
    return NextResponse.json({ message: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ companyName: company.name, slug: company.slug });
}

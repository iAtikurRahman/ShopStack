import { NextRequest, NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { getTenantClient, TenantNotProvisionedError } from "@/lib/tenant-db";
import { verifyPassword, signSessionToken, setSessionCookie, type TenantSession } from "@/lib/auth";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

const GENERIC_ERROR = "Invalid company, email, or password";

export async function POST(request: NextRequest) {
  if (isRateLimited(`login:${getClientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ message: "Too many login attempts, try again shortly" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const { slug, email, password } = body ?? {};

  if (!slug || !email || !password) {
    return NextResponse.json({ message: "slug, email, and password are required" }, { status: 400 });
  }

  const company = await centralDb.company.findUnique({ where: { slug } });
  if (!company || company.status !== "active") {
    return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
  }

  let db;
  try {
    db = await getTenantClient(company.id);
  } catch (err) {
    if (err instanceof TenantNotProvisionedError) {
      return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
    }
    throw err;
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
  }

  const validPassword = await verifyPassword(password, user.password);
  if (!validPassword) {
    return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
  }

  const session: TenantSession = {
    kind: "tenant",
    userId: user.id,
    companyId: company.id,
    storeId: user.storeId,
    role: user.role,
    email: user.email,
    name: user.name,
  };

  const token = await signSessionToken(session);
  await setSessionCookie(token);

  return NextResponse.json({
    user: { name: user.name, email: user.email, role: user.role, storeId: user.storeId },
    company: { name: company.name, slug: company.slug },
  });
}

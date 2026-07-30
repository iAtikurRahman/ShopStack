import { NextRequest, NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { verifyPassword, signSessionToken, setSessionCookie, type ProjectAdminSession } from "@/lib/auth";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

const GENERIC_ERROR = "Invalid email or password";

export async function POST(request: NextRequest) {
  if (isRateLimited(`admin-login:${getClientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ message: "Too many login attempts, try again shortly" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const { email, password } = body ?? {};

  if (!email || !password) {
    return NextResponse.json({ message: "email and password are required" }, { status: 400 });
  }

  const admin = await centralDb.projectAdmin.findUnique({ where: { email } });
  if (!admin || !admin.isActive) {
    return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
  }

  const validPassword = await verifyPassword(password, admin.password);
  if (!validPassword) {
    return NextResponse.json({ message: GENERIC_ERROR }, { status: 401 });
  }

  const session: ProjectAdminSession = {
    kind: "project_admin",
    projectAdminId: admin.id,
    email: admin.email,
    name: admin.name,
  };

  const token = await signSessionToken(session);
  await setSessionCookie(token);

  return NextResponse.json({ name: admin.name, email: admin.email });
}

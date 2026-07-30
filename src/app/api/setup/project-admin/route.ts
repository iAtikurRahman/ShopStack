import { NextRequest, NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { hashPassword, signSessionToken, setSessionCookie, type ProjectAdminSession } from "@/lib/auth";
import { validatePassword } from "@/lib/validate-password";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

// One-time setup route: only works while zero ProjectAdmin rows exist.
// Locks itself out permanently after the first successful call - there is
// no way to create a second Project Admin through this route, only via
// direct database access or a future dedicated admin-management endpoint.
export async function POST(request: NextRequest) {
  if (isRateLimited(`setup-project-admin:${getClientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ message: "Too many requests, try again shortly" }, { status: 429 });
  }

  const existingCount = await centralDb.projectAdmin.count();
  if (existingCount > 0) {
    return NextResponse.json(
      { message: "Setup has already been completed. Sign in at /admin/login instead." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const { name, email, password } = body ?? {};

  if (!name || !email || !password) {
    return NextResponse.json({ message: "name, email, and password are required" }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ message: passwordError }, { status: 400 });
  }

  // Guards a race between two concurrent first-run requests: the unique
  // count check above is optimistic, so re-check for zero rows inside a
  // transaction immediately before the insert.
  const admin = await centralDb.$transaction(async (tx) => {
    const recheck = await tx.projectAdmin.count();
    if (recheck > 0) {
      throw new Error("ALREADY_SET_UP");
    }
    return tx.projectAdmin.create({
      data: { name, email, password: await hashPassword(password) },
    });
  }).catch((err) => {
    if (err instanceof Error && err.message === "ALREADY_SET_UP") return null;
    throw err;
  });

  if (!admin) {
    return NextResponse.json(
      { message: "Setup has already been completed. Sign in at /admin/login instead." },
      { status: 403 }
    );
  }

  await centralDb.centralAuditLog.create({
    data: { actorId: admin.id, action: "project_admin.setup", targetType: "ProjectAdmin", targetId: admin.id },
  });

  const session: ProjectAdminSession = {
    kind: "project_admin",
    projectAdminId: admin.id,
    email: admin.email,
    name: admin.name,
  };
  const token = await signSessionToken(session);
  await setSessionCookie(token);

  return NextResponse.json({ name: admin.name, email: admin.email }, { status: 201 });
}

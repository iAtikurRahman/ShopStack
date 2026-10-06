import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validate-password";
import { writeAuditLog } from "@/lib/audit";

/**
 * Passwords are stored as one-way bcrypt hashes, so an existing password can
 * never be read back. This endpoint is the supported alternative: a company
 * admin sets a brand new password for a user instead of viewing the old one.
 *
 * Restricted to company_admin on purpose - letting a store_manager reset a
 * password would let them log in as any user in the company, including a
 * company_admin, which is a full privilege escalation.
 */
export const PUT = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { password } = body ?? {};

  if (!password) {
    return NextResponse.json({ message: "password is required" }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ message: passwordError }, { status: 400 });
  }

  await db.user.update({
    where: { id: userId },
    data: { password: await hashPassword(password) },
  });

  // Never log the password itself - only that a reset happened and who it hit.
  await writeAuditLog(db, session, {
    action: "user.password_reset",
    entityType: "User",
    entityId: userId,
    before: { email: user.email, role: user.role },
    after: { email: user.email, role: user.role, passwordResetBy: session.email },
  });

  return NextResponse.json({ ok: true });
}, { scope: "tenant", roles: ["company_admin"] });

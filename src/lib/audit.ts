import type { Prisma, PrismaClient } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";

type TenantDbOrTx = PrismaClient | Prisma.TransactionClient;

export async function writeAuditLog(
  db: TenantDbOrTx,
  session: TenantSession,
  entry: {
    action: string;
    entityType: string;
    entityId?: number;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }
) {
  await db.auditLog.create({
    data: {
      userId: session.userId,
      userEmail: session.email,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
    },
  });
}

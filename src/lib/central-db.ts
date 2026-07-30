import { PrismaClient } from "@/generated/central";

const globalForPrisma = globalThis as unknown as {
  centralDb: PrismaClient | undefined;
};

export const centralDb =
  globalForPrisma.centralDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.centralDb = centralDb;
}

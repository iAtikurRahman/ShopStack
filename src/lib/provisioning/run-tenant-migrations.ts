import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(process.cwd());
const TENANT_SCHEMA_PATH = "prisma/tenant/schema.prisma";

/**
 * Applies the committed tenant migration history to a freshly created
 * database by shelling out to the Prisma CLI with DATABASE_URL overridden
 * for this one invocation. Uses `migrate deploy` (not `migrate dev`) so it
 * only applies existing migrations - it never generates new ones or
 * prompts interactively, and keeps Prisma's own `_prisma_migrations`
 * bookkeeping so `prisma migrate status` still works against a tenant DB.
 *
 * Assumes a persistent Node host where spawning a subprocess and invoking
 * the Prisma CLI is available (not a restrictive serverless runtime).
 */
export async function runTenantMigrations(tenantDatabaseUrl: string): Promise<void> {
  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", `--schema=${TENANT_SCHEMA_PATH}`],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tenantDatabaseUrl },
      // On Windows, npx resolves to npx.cmd, which CreateProcess cannot
      // exec directly without going through a shell.
      shell: process.platform === "win32",
    }
  );
}

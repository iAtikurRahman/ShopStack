import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "path";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(process.cwd());
const TENANT_SCHEMA_PATH = "prisma/tenant/schema.prisma";

export interface TenantMigrationResult {
  stdout: string;
  stderr: string;
  /** Migration names Prisma reported applying during this invocation. */
  applied: string[];
}

/**
 * Applies the committed tenant migration history to a tenant database by
 * shelling out to the Prisma CLI with DATABASE_URL overridden for this one
 * invocation. Uses `migrate deploy` (not `migrate dev`) so it only applies
 * existing migrations - it never generates new ones or prompts
 * interactively, and keeps Prisma's own `_prisma_migrations` bookkeeping so
 * `prisma migrate status` still works against a tenant DB.
 *
 * Safe to re-run: migrations already applied are skipped, so callers can use
 * this to bring an already-provisioned tenant database up to date.
 *
 * Assumes a persistent Node host where spawning a subprocess and invoking
 * the Prisma CLI is available (not a restrictive serverless runtime).
 */
export async function runTenantMigrations(
  tenantDatabaseUrl: string
): Promise<TenantMigrationResult> {
  const { stdout, stderr } = await execFileAsync(
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

  const applied = [...`${stdout}\n${stderr}`.matchAll(/Applying migration `([^`]+)`/g)].map(
    (match) => match[1]
  );

  return { stdout, stderr, applied };
}
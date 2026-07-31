import mysql from "mysql2/promise";

/**
 * Creates a new MySQL database on the shared tenant host. Uses a plain
 * mysql2 connection rather than Prisma, since Prisma's MySQL connector
 * requires the target database to already exist in its connection URL.
 *
 * This DB user only has grants on specific pre-existing databases (no
 * global CREATE privilege - typical of shared cPanel hosting), so
 * `CREATE DATABASE` itself is expected to fail with access denied. In
 * that case, fall back to checking whether the database was already
 * created out-of-band (e.g. manually via cPanel) and is reachable; if
 * not, surface a clear, actionable error instead of the raw MySQL one.
 */
export async function createTenantDatabase(dbName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Refusing to create database with unsafe name: ${dbName}`);
  }

  const baseConfig = {
    host: process.env.TENANT_DB_HOST,
    port: Number(process.env.TENANT_DB_PORT ?? 3306),
    user: process.env.TENANT_DB_USER,
    password: process.env.TENANT_DB_PASSWORD,
  };

  const connection = await mysql.createConnection(baseConfig);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
    return;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ER_DBACCESS_DENIED_ERROR" && code !== "ER_ACCESS_DENIED_ERROR") {
      throw err;
    }
  } finally {
    await connection.end();
  }

  // No CREATE privilege - check if the database already exists and is
  // reachable (created manually ahead of time) before giving up.
  try {
    const probe = await mysql.createConnection({ ...baseConfig, database: dbName });
    await probe.end();
  } catch {
    throw new Error(
      `This hosting account can't auto-create databases. Please create database "${dbName}" manually ` +
        `(cPanel -> MySQL(R) Databases, granting user "${baseConfig.user}" ALL PRIVILEGES on it), then retry.`
    );
  }
}

/** Best-effort cleanup used when a later provisioning step fails. */
export async function dropTenantDatabase(dbName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Refusing to drop database with unsafe name: ${dbName}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.TENANT_DB_HOST,
    port: Number(process.env.TENANT_DB_PORT ?? 3306),
    user: process.env.TENANT_DB_USER,
    password: process.env.TENANT_DB_PASSWORD,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  } finally {
    await connection.end();
  }
}

export function buildTenantDbUrl(dbName: string): string {
  const host = process.env.TENANT_DB_HOST;
  const port = process.env.TENANT_DB_PORT ?? "3306";
  const user = process.env.TENANT_DB_USER;
  const password = process.env.TENANT_DB_PASSWORD;

  if (!host || !user || password === undefined) {
    throw new Error("Tenant DB host/user/password env vars are not configured");
  }

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?connection_limit=${process.env.TENANT_DB_CONNECTION_LIMIT ?? 3}`;
}

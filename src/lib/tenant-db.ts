import { LRUCache } from "lru-cache";
import { PrismaClient } from "@/generated/tenant";
import { centralDb } from "@/lib/central-db";

type TenantMapping = {
  dbName: string;
  dbHost: string | null;
  dbPort: number | null;
};

const MAPPING_TTL_MS = 5 * 60_000; // 5 min - repointing a tenant db takes effect within this window
const CLIENT_IDLE_TTL_MS = 15 * 60_000; // evict idle tenant clients after 15 min
const MAX_CACHED_CLIENTS = Number(process.env.TENANT_CLIENT_CACHE_MAX ?? 50);
const TENANT_CONNECTION_LIMIT = Number(process.env.TENANT_DB_CONNECTION_LIMIT ?? 3);

type Caches = {
  mappingCache: LRUCache<number, TenantMapping>;
  clientCache: LRUCache<string, PrismaClient>;
};

const globalForTenantDb = globalThis as unknown as { tenantDbCaches: Caches | undefined };

function createCaches(): Caches {
  return {
    mappingCache: new LRUCache<number, TenantMapping>({
      max: 500,
      ttl: MAPPING_TTL_MS,
    }),
    clientCache: new LRUCache<string, PrismaClient>({
      max: MAX_CACHED_CLIENTS,
      ttl: CLIENT_IDLE_TTL_MS,
      dispose: (client) => {
        void client.$disconnect();
      },
    }),
  };
}

const caches = globalForTenantDb.tenantDbCaches ?? createCaches();
if (process.env.NODE_ENV !== "production") {
  globalForTenantDb.tenantDbCaches = caches;
}

export class TenantNotProvisionedError extends Error {
  constructor(companyId: number) {
    super(`No ready tenant database mapping found for company ${companyId}`);
    this.name = "TenantNotProvisionedError";
  }
}

async function loadMapping(companyId: number): Promise<TenantMapping> {
  const record = await centralDb.tenantDatabase.findUnique({
    where: { companyId },
  });

  if (!record || record.status !== "ready") {
    throw new TenantNotProvisionedError(companyId);
  }

  const mapping: TenantMapping = {
    dbName: record.dbName,
    dbHost: record.dbHost,
    dbPort: record.dbPort,
  };
  caches.mappingCache.set(companyId, mapping);
  return mapping;
}

function buildTenantUrl(mapping: TenantMapping): string {
  const host = mapping.dbHost ?? process.env.TENANT_DB_HOST;
  const port = mapping.dbPort ?? Number(process.env.TENANT_DB_PORT ?? 3306);
  const user = process.env.TENANT_DB_USER;
  const password = process.env.TENANT_DB_PASSWORD;

  if (!host || !user || password === undefined) {
    throw new Error("Tenant DB host/user/password env vars are not configured");
  }

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${mapping.dbName}?connection_limit=${TENANT_CONNECTION_LIMIT}`;
}

/**
 * Resolves the tenant database for a company and returns a cached,
 * connection-pooled PrismaClient for it. Never expose a shared/ambient
 * client to tenant-scoped routes - always resolve through here so a
 * request can only ever reach the one database it's authorized for.
 */
export async function getTenantClient(companyId: number): Promise<PrismaClient> {
  const mapping = caches.mappingCache.get(companyId) ?? (await loadMapping(companyId));
  const cacheKey = mapping.dbName;

  let client = caches.clientCache.get(cacheKey);
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: buildTenantUrl(mapping) } },
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
    caches.clientCache.set(cacheKey, client);
  }
  return client;
}

/** Forces the next lookup for a company to re-read the mapping from the central DB. */
export function invalidateTenantMapping(companyId: number) {
  caches.mappingCache.delete(companyId);
}

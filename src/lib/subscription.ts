import { LRUCache } from "lru-cache";
import { centralDb } from "@/lib/central-db";

export type SubscriptionStatusSummary = {
  status: "pending" | "active" | "expired" | "cancelled" | "none";
  isPremium: boolean;
  daysRemaining: number | null;
  startDate: Date | null;
  endDate: Date | null;
  plan: { id: number; name: string; price: string; durationDays: number } | null;
};

const STATUS_TTL_MS = 3 * 60_000; // matches the mapping-cache TTL used in tenant-db.ts

const globalForSubscription = globalThis as unknown as {
  subscriptionStatusCache: LRUCache<number, SubscriptionStatusSummary> | undefined;
};

const statusCache =
  globalForSubscription.subscriptionStatusCache ??
  new LRUCache<number, SubscriptionStatusSummary>({ max: 1000, ttl: STATUS_TTL_MS });
if (process.env.NODE_ENV !== "production") {
  globalForSubscription.subscriptionStatusCache = statusCache;
}

async function computeStatus(companyId: number): Promise<SubscriptionStatusSummary> {
  const subscription = await centralDb.subscription.findUnique({
    where: { companyId },
    include: { plan: true },
  });

  if (!subscription) {
    return { status: "none", isPremium: false, daysRemaining: null, startDate: null, endDate: null, plan: null };
  }

  let status = subscription.status;
  // Lazy expiry: flip to `expired` the first time anyone checks after endDate has passed.
  if (status === "active" && subscription.endDate && subscription.endDate.getTime() < Date.now()) {
    status = "expired";
    await centralDb.subscription.update({ where: { id: subscription.id }, data: { status: "expired" } });
  }

  const daysRemaining = subscription.endDate
    ? Math.ceil((subscription.endDate.getTime() - Date.now()) / 86_400_000)
    : null;

  return {
    status,
    isPremium: status === "active",
    daysRemaining,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    plan: subscription.plan
      ? {
          id: subscription.plan.id,
          name: subscription.plan.name,
          price: subscription.plan.price.toString(),
          durationDays: subscription.plan.durationDays,
        }
      : null,
  };
}

/** Cached (TTL ~3min) so premium/ad checks don't add a DB round-trip to every request. */
export async function getSubscriptionStatus(companyId: number): Promise<SubscriptionStatusSummary> {
  const cached = statusCache.get(companyId);
  if (cached) return cached;
  const computed = await computeStatus(companyId);
  statusCache.set(companyId, computed);
  return computed;
}

/** Call after any Super Admin action that changes a company's subscription. */
export function invalidateSubscriptionStatus(companyId: number) {
  statusCache.delete(companyId);
}

/** Singleton (id always 1) - created on first read if it doesn't exist yet. */
export async function getAdSettings() {
  return centralDb.advertisementSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

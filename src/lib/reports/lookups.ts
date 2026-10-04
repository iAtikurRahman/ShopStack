import type { PrismaClient } from "@/generated/tenant";
import type { ReportContext } from "./definition";

/**
 * Name lookups for the ids the schema stores without relations.
 *
 * Sale -> Store, SaleItem -> Product and ReturnItem -> SaleItem are bare integer
 * columns here, not relations: nothing about the model's shape needed them, and
 * Prisma is happy to store the id either way. The consequence is that a report
 * cannot `include` a name it wants to print - it has to read the row and then
 * look the name up.
 *
 * So this module is the answer to that, and every report goes through it. The
 * maps are built once per report from the ids actually referenced, rather than
 * per row: a thousand invoices must not become a thousand round trips.
 */

export type ProductInfo = {
  id: number;
  sku: string;
  name: string;
  categoryId: number | null;
  supplierId: number | null;
  purchasePrice: number;
  salePrice: number;
};

export type StoreInfo = { id: number; name: string };
export type WarehouseInfo = { id: number; name: string; storeId: number };
export type UserInfo = { id: number; name: string; role: string };

/** Products for a set of ids, as a map. Missing ids are simply absent, so a
 *  lookup with `?.` yields undefined rather than throwing on a deleted product. */
export async function productMap(db: PrismaClient, ids: Iterable<number>): Promise<Map<number, ProductInfo>> {
  const unique = [...new Set([...ids].filter((id) => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db.product.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      sku: true,
      name: true,
      categoryId: true,
      supplierId: true,
      purchasePrice: true,
      salePrice: true,
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId,
        supplierId: row.supplierId,
        purchasePrice: Number(row.purchasePrice.toString()),
        salePrice: Number(row.salePrice.toString()),
      },
    ])
  );
}

/** Categories for a set of ids - reports that print a category name. */
export async function categoryMap(db: PrismaClient, ids: Iterable<number>): Promise<Map<number, string>> {
  const unique = [...new Set([...ids].filter((id) => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db.category.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Every store. Small table, and reports need names for stores they have no
 *  relation to (Sale.storeId is one of those). */
export async function storeMap(db: PrismaClient): Promise<Map<number, StoreInfo>> {
  const rows = await db.store.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row]));
}

/** Warehouses for the caller's store scope - stock and purchase reports can only
 *  ever speak about warehouses their store owns. */
export async function warehouseMap(ctx: ReportContext): Promise<Map<number, WarehouseInfo>> {
  const rows = await ctx.db.warehouse.findMany({
    where: ctx.scopedToStore ? { storeId: ctx.storeFilter.storeId as number } : {},
    select: { id: true, name: true, storeId: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Store scope for a model that reaches its store through a warehouse.
 *
 * WarehouseStock and PurchaseItem have no storeId of their own - the shop a
 * figure belongs to is the shop that owns the warehouse - so the scoping filter
 * has to travel through the relation. `key` names the relation for the models
 * where it is not the default (Purchase.warehouse, for instance).
 */
export function warehouseScope(ctx: ReportContext, key = "warehouse"): Record<string, unknown> {
  return ctx.scopedToStore ? { [key]: { storeId: ctx.storeFilter.storeId as number } } : {};
}

/** Users, for the cashier / staff columns. */
export async function userMap(db: PrismaClient): Promise<Map<number, UserInfo>> {
  const rows = await db.user.findMany({ select: { id: true, name: true, role: true } });
  return new Map(rows.map((row) => [row.id, row]));
}

/** The money accounts, name to current balance. Reports group by the account
 *  name that was snapshotted onto the transaction, so this is also the list of
 *  known method names - which is what keeps an "Unknown account" row from being
 *  a surprise when an account was renamed or removed after the fact. */
export async function bankAccounts(db: PrismaClient): Promise<Map<string, number>> {
  const rows = await db.bankInfo.findMany({ select: { bankName: true, remainingBalance: true } });
  return new Map(rows.map((row) => [row.bankName, row.remainingBalance]));
}

/** The label a report prints for a store id it cannot resolve, so a row for a
 *  deleted store still says which store it was. */
export function storeName(stores: Map<number, StoreInfo>, id: number): string {
  return stores.get(id)?.name ?? `#${id}`;
}
"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import { unitLabel } from "@/lib/units";

type Warehouse = { id: number; name: string };
type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string | null;
  category: { name: string } | null;
};
type Stock = { warehouseId: number; productId: number; quantity: string; lowStockThreshold: string };

export default function StoreInventoryPage() {
  const { t, fmt, locale } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showNewWarehouse, setShowNewWarehouse] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [newWarehouseLocation, setNewWarehouseLocation] = useState("");
  const [isManager, setIsManager] = useState(false);
  const [search, setSearch] = useState("");

  const stockMap = useMemo(() => {
    const map = new Map<string, Stock>();
    for (const s of stock) map.set(`${s.warehouseId}:${s.productId}`, s);
    return map;
  }, [stock]);

  // A product's total across every warehouse in the store.
  const totalByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stock) {
      map.set(s.productId, (map.get(s.productId) ?? 0) + Number(s.quantity));
    }
    return map;
  }, [stock]);

  function quantityIn(warehouseId: number, productId: number) {
    return Number(stockMap.get(`${warehouseId}:${productId}`)?.quantity ?? 0);
  }

  function isLowIn(warehouseId: number, productId: number) {
    const s = stockMap.get(`${warehouseId}:${productId}`);
    return !!s && Number(s.quantity) <= Number(s.lowStockThreshold);
  }

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    const lowStockTerm = t("storeOps.inventory.lowStock").toLowerCase();
    return products.filter((p) => {
      const total = totalByProduct.get(p.id) ?? 0;
      const anyLow = warehouses.some((w) => {
        const s = stockMap.get(`${w.id}:${p.id}`);
        return !!s && Number(s.quantity) <= Number(s.lowStockThreshold);
      });
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category?.name ?? "").toLowerCase().includes(q) ||
        String(total).includes(q) ||
        (anyLow && lowStockTerm.includes(q))
      );
    });
  }, [products, search, totalByProduct, warehouses, stockMap, t]);

  useEffect(() => {
    apiFetch<{ role?: string }>("/api/auth/me")
      .then((me) => setIsManager(me.role === "store_manager" || me.role === "company_admin"))
      .catch(() => undefined);
  }, []);

  async function loadInventory() {
    try {
      const data = await apiFetch<{ warehouses: Warehouse[]; products: Product[]; stock: Stock[] }>(
        "/api/store/inventory"
      );
      setWarehouses(data.warehouses);
      setProducts(data.products);
      setStock(data.stock);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadInventory();
    }
    load();
  }, []);

  async function handleQuantityChange(warehouseId: number, productId: number, quantity: number) {
    const key = `${warehouseId}-${productId}`;
    setSavingKey(key);
    setError(null);
    try {
      await apiFetch("/api/store/inventory", "PATCH", { warehouseId, productId, quantity });
      await loadInventory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleCreateWarehouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/store/warehouses", "POST", { name: newWarehouseName, location: newWarehouseLocation || null });
      setNewWarehouseName("");
      setNewWarehouseLocation("");
      setShowNewWarehouse(false);
      await loadInventory();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.inventory")}</h1>
        <div className="flex items-center gap-3">
          {warehouses.length > 0 ? (
            <Link
              href={`/store/warehouses/${warehouses[0].id}/products`}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white"
            >
              {t("storeOps.inventory.manageProducts")}
            </Link>
          ) : null}
          {isManager ? (
            <button
              type="button"
              onClick={() => setShowNewWarehouse((v) => !v)}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("storeOps.inventory.newWarehouse")}
            </button>
          ) : null}
        </div>
      </div>

      {showNewWarehouse && isManager ? (
        <form onSubmit={handleCreateWarehouse} className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("common.name")}</span>
            <input
              required
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
              className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("storeOps.inventory.location")}</span>
            <input
              value={newWarehouseLocation}
              onChange={(e) => setNewWarehouseLocation(e.target.value)}
              className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:border-slate-900"
            />
          </label>
          <button type="submit" className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            {t("storeOps.inventory.create")}
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("storeOps.inventory.searchPlaceholder")}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        {loading ? (
          <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
        ) : warehouses.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">{t("storeOps.inventory.noWarehouse")}</p>
        ) : filteredProducts.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            {search.trim()
              ? t("storeOps.inventory.noMatch", { search: search.trim() })
              : t("storeOps.inventory.noProducts")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2">{t("storeOps.inventory.sku")}</th>
                  <th className="pb-2">{t("common.name")}</th>
                  <th className="pb-2">{t("storeOps.inventory.category")}</th>
                  <th className="pb-2 text-right">{t("storeOps.inventory.totalQuantity")}</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const total = totalByProduct.get(product.id) ?? 0;
                  const expanded = expandedProductId === product.id;
                  return (
                    <Fragment key={product.id}>
                      <tr
                        onClick={() => setExpandedProductId(expanded ? null : product.id)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-2 text-slate-600">{product.sku}</td>
                        <td className="py-2 font-medium text-slate-950">{product.name}</td>
                        <td className="py-2 text-slate-600">{product.category?.name ?? "—"}</td>
                        <td className="py-2 text-right">
                          <span className="font-medium text-slate-950">{fmt.quantity(total)}</span>{" "}
                          <span className="text-xs text-slate-500">{unitLabel(product.unit, locale)}</span>
                        </td>
                        <td className="py-2 text-right text-slate-400">{expanded ? "▾" : "▸"}</td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-slate-100 bg-slate-50/60">
                          <td colSpan={5} className="px-3 py-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {t("storeOps.inventory.byWarehouse")}
                            </div>
                            <div className="space-y-1.5">
                              {warehouses.map((w) => {
                                const quantity = quantityIn(w.id, product.id);
                                const low = isLowIn(w.id, product.id);
                                const key = `${w.id}-${product.id}`;
                                return (
                                  <div
                                    key={w.id}
                                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                                  >
                                    <Link
                                      href={`/store/warehouses/${w.id}/products`}
                                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
                                    >
                                      {w.name}
                                    </Link>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        step="any"
                                        key={`${key}-${quantity}`}
                                        defaultValue={quantity}
                                        disabled={savingKey === key}
                                        onClick={(e) => e.stopPropagation()}
                                        onBlur={(e) => {
                                          const next = Number(e.target.value);
                                          if (Number.isFinite(next) && next !== quantity) {
                                            handleQuantityChange(w.id, product.id, next);
                                          }
                                        }}
                                        className={`w-24 rounded-xl border px-3 py-1.5 text-right outline-none focus:border-slate-900 ${
                                          low ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"
                                        }`}
                                      />
                                      <span className="text-xs text-slate-500">{unitLabel(product.unit, locale)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

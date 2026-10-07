"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  const { t, locale } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showNewWarehouse, setShowNewWarehouse] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [newWarehouseLocation, setNewWarehouseLocation] = useState("");
  const [isManager, setIsManager] = useState(false);
  const [search, setSearch] = useState("");

  const stockByProduct = useMemo(() => {
    const map = new Map<number, Stock>();
    for (const s of stock) {
      if (s.warehouseId === selectedWarehouseId) map.set(s.productId, s);
    }
    return map;
  }, [stock, selectedWarehouseId]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    const lowStockTerm = t("storeOps.inventory.lowStock").toLowerCase();
    return products.filter((p) => {
      const current = stockByProduct.get(p.id);
      const quantity = Number(current?.quantity ?? 0);
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category?.name ?? "").toLowerCase().includes(q) ||
        String(quantity).includes(q) ||
        (quantity <= Number(current?.lowStockThreshold ?? 5) && lowStockTerm.includes(q))
      );
    });
  }, [products, search, stockByProduct, t]);

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
      setSelectedWarehouseId((current) => current ?? data.warehouses[0]?.id ?? null);
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

  function stockFor(productId: number) {
    return stockByProduct.get(productId);
  }

  async function handleQuantityChange(productId: number, quantity: number) {
    if (!selectedWarehouseId) return;
    const key = `${selectedWarehouseId}-${productId}`;
    setSavingKey(key);
    setError(null);
    try {
      await apiFetch("/api/store/inventory", "PATCH", {
        warehouseId: selectedWarehouseId,
        productId,
        quantity,
      });
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
          {warehouses.length > 1 ? (
            <select
              value={selectedWarehouseId ?? ""}
              onChange={(e) => setSelectedWarehouseId(Number(e.target.value))}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-slate-900"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : null}
          {selectedWarehouseId ? (
            <Link
              href={`/store/warehouses/${selectedWarehouseId}/products`}
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
        ) : !selectedWarehouseId ? (
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
                  <th className="pb-2">{t("common.quantity")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const current = stockFor(product.id);
                  const quantity = Number(current?.quantity ?? 0);
                  const lowThreshold = Number(current?.lowStockThreshold ?? 5);
                  const isLow = quantity <= lowThreshold;
                  const key = `${selectedWarehouseId}-${product.id}`;
                  return (
                    <tr key={product.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{product.sku}</td>
                      <td className="py-2 font-medium text-slate-950">{product.name}</td>
                      <td className="py-2 text-slate-600">{product.category?.name ?? "—"}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="any"
                            defaultValue={quantity}
                            disabled={savingKey === key}
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (Number.isFinite(next) && next !== quantity) {
                                handleQuantityChange(product.id, next);
                              }
                            }}
                            className={`w-24 rounded-xl border px-3 py-1.5 outline-none focus:border-slate-900 ${
                              isLow ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"
                            }`}
                          />
                          <span className="text-xs text-slate-500">
                            {unitLabel(product.unit, locale)}
                          </span>
                          {isLow ? (
                            <span className="text-xs font-medium text-red-600">
                              {t("storeOps.inventory.lowStock")}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string };
type Product = { id: number; sku: string; name: string; category: { name: string } | null };
type Stock = { warehouseId: number; productId: number; quantity: number; lowStockThreshold: number };

export default function StoreInventoryPage() {
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

  useEffect(() => {
    apiFetch<{ role?: string }>("/api/auth/me")
      .then((me) => setIsManager(me.role === "store_manager"))
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
    return stock.find((s) => s.warehouseId === selectedWarehouseId && s.productId === productId);
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
        <h1 className="text-2xl font-semibold text-slate-950">Inventory</h1>
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
              Manage products
            </Link>
          ) : null}
          {isManager ? (
            <button
              type="button"
              onClick={() => setShowNewWarehouse((v) => !v)}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              New warehouse
            </button>
          ) : null}
        </div>
      </div>

      {showNewWarehouse && isManager ? (
        <form onSubmit={handleCreateWarehouse} className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input
              required
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
              className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Location</span>
            <input
              value={newWarehouseLocation}
              onChange={(e) => setNewWarehouseLocation(e.target.value)}
              className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:border-slate-900"
            />
          </label>
          <button type="submit" className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            Create
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : !selectedWarehouseId ? (
          <p className="text-sm text-slate-600">No warehouse assigned to your store yet.</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-slate-600">No products in the catalog yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const current = stockFor(product.id);
                  const quantity = current?.quantity ?? 0;
                  const isLow = quantity <= (current?.lowStockThreshold ?? 5);
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
                            defaultValue={quantity}
                            disabled={savingKey === key}
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (next !== quantity) handleQuantityChange(product.id, next);
                            }}
                            className={`w-24 rounded-xl border px-3 py-1.5 outline-none focus:border-slate-900 ${
                              isLow ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"
                            }`}
                          />
                          {isLow ? <span className="text-xs font-medium text-red-600">low stock</span> : null}
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

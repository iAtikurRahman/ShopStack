"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string; store?: { id: number; name: string } };
type Product = { id: number; sku: string; name: string };
type TransferItem = { id: number; productId: number; quantity: number };
type Transfer = {
  id: number;
  fromWarehouseId: number;
  toWarehouseId: number;
  status: string;
  createdAt: string;
  items: TransferItem[];
};

export default function StoreTransfersPage() {
  const [myWarehouses, setMyWarehouses] = useState<Warehouse[]>([]);
  const [allWarehouses, setAllWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  async function loadAll() {
    try {
      const [inventoryData, warehousesData, transfersData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[] }>("/api/store/inventory"),
        apiFetch<{ warehouses: Warehouse[] }>("/api/store/warehouses"),
        apiFetch<{ transfers: Transfer[] }>("/api/store/transfers"),
      ]);
      setMyWarehouses(inventoryData.warehouses);
      setProducts(inventoryData.products);
      setAllWarehouses(warehousesData.warehouses);
      setTransfers(transfersData.transfers);
      setFromWarehouseId((current) => current || String(inventoryData.warehouses[0]?.id ?? ""));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadAll();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/store/transfers", "POST", {
        fromWarehouseId: Number(fromWarehouseId),
        toWarehouseId: Number(toWarehouseId),
        items: [{ productId: Number(productId), quantity: Number(quantity) }],
      });
      setProductId("");
      setQuantity("1");
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const warehouseById = new Map(
    [...myWarehouses, ...allWarehouses].map((w) => [w.id, w.name] as const)
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Stock transfers</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Recent transfers</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : transfers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No transfers yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {transfers.map((transfer) => (
                <div key={transfer.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-950">
                      {warehouseById.get(transfer.fromWarehouseId) ?? `Warehouse ${transfer.fromWarehouseId}`} →{" "}
                      {warehouseById.get(transfer.toWarehouseId) ?? `Warehouse ${transfer.toWarehouseId}`}
                    </p>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      {transfer.status}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">{new Date(transfer.createdAt).toLocaleDateString()}</p>
                  <div className="mt-3">
                    <div className="grid grid-cols-[1fr_3.5rem] gap-3 border-b border-slate-200 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <span>Product</span>
                      <span className="text-right">Qty</span>
                    </div>
                    {transfer.items.map((item) => (
                      <div key={item.id} className="grid grid-cols-[1fr_3.5rem] gap-3 py-1 text-slate-600">
                        <span className="truncate">
                          {productById.get(item.productId)?.name ?? `Product #${item.productId}`}{" "}
                          <span className="text-xs text-slate-500">
                            ({productById.get(item.productId)?.sku ?? "—"})
                          </span>
                        </span>
                        <span className="text-right tabular-nums">{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">New transfer</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">From (your warehouse)</span>
              <select
                required
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {myWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">To</span>
              <select
                required
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">Select destination</option>
                {allWarehouses
                  .filter((w) => String(w.id) !== fromWarehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.store ? `(${w.store.name})` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Product</span>
              <select
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Quantity</span>
              <input
                required
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Transfer stock
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

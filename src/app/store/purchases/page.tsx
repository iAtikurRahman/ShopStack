"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string };
type Product = { id: number; sku: string; name: string };
type Supplier = { id: number; name: string };
type PurchaseItem = { id: number; productId: number; quantity: number; unitCost: string };
type Purchase = {
  id: number;
  warehouseId: number;
  reference: string | null;
  totalCost: string;
  purchasedAt: string;
  supplier: { id: number; name: string };
  items: PurchaseItem[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StorePurchasesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(today());

  async function loadAll() {
    try {
      const [inventoryData, suppliersData, purchasesData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[] }>("/api/store/inventory"),
        apiFetch<{ suppliers: Supplier[] }>("/api/store/suppliers"),
        apiFetch<{ purchases: Purchase[] }>("/api/store/purchases"),
      ]);
      setWarehouses(inventoryData.warehouses);
      setProducts(inventoryData.products);
      setSuppliers(suppliersData.suppliers);
      setPurchases(purchasesData.purchases);
      setWarehouseId((current) => current || String(inventoryData.warehouses[0]?.id ?? ""));
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
      await apiFetch("/api/store/purchases", "POST", {
        supplierId: Number(supplierId),
        warehouseId: Number(warehouseId),
        reference: reference || null,
        purchasedAt,
        items: [{ productId: Number(productId), quantity: Number(quantity), unitCost: Number(unitCost) }],
      });
      setProductId("");
      setQuantity("1");
      setUnitCost("");
      setReference("");
      setPurchasedAt(today());
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Purchases (stock-in)</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Recent purchases</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : purchases.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No purchases yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {purchases.map((purchase) => (
                <div key={purchase.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-950">{purchase.supplier.name}</p>
                    <span className="text-slate-600">৳{purchase.totalCost}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{new Date(purchase.purchasedAt).toLocaleDateString()}</p>
                  <p className="mt-1 text-slate-600">
                    {purchase.items.map((item) => `product ${item.productId} × ${item.quantity}`).join(", ")}
                  </p>
                  {purchase.reference ? (
                    <p className="mt-1 text-xs text-slate-500">Ref: {purchase.reference}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Record a purchase</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Purchased on</span>
              <input
                required
                type="date"
                max={today()}
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Warehouse</span>
              <select
                required
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Supplier</span>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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
            <div className="grid grid-cols-2 gap-4">
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
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Unit cost</span>
                <input
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Reference / invoice no. (optional)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Record purchase
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/services/api";
import { round2 } from "@/lib/returns";

type Warehouse = { id: number; name: string };
type Product = { id: number; sku: string; name: string; purchasePrice: string };
type Supplier = { id: number; name: string };
type SupplierReturn = {
  id: number;
  warehouseId: number;
  productId: number;
  quantity: number;
  amount: string;
  reason: string | null;
  createdAt: string;
  supplier: { id: number; name: string };
  product: { id: number; sku: string; name: string } | null;
};

export default function StoreSupplierReturnsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [search, setSearch] = useState("");

  const filteredReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplierReturns;
    return supplierReturns.filter((ret) => {
      const warehouse = warehouses.find((w) => w.id === ret.warehouseId);
      return (
        ret.supplier.name.toLowerCase().includes(q) ||
        `${ret.product?.name ?? ""} ${ret.product?.sku ?? ""}`.toLowerCase().includes(q) ||
        (ret.reason ?? "").toLowerCase().includes(q) ||
        (warehouse?.name ?? "").toLowerCase().includes(q) ||
        ret.amount.includes(q) ||
        ret.createdAt.slice(0, 10).includes(q)
      );
    });
  }, [supplierReturns, warehouses, search]);

  async function loadAll() {
    try {
      const [inventoryData, suppliersData, returnsData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[] }>("/api/store/inventory"),
        apiFetch<{ suppliers: Supplier[] }>("/api/store/suppliers"),
        apiFetch<{ supplierReturns: SupplierReturn[] }>("/api/store/supplier-returns"),
      ]);
      setWarehouses(inventoryData.warehouses);
      setProducts(inventoryData.products);
      setSuppliers(suppliersData.suppliers);
      setSupplierReturns(returnsData.supplierReturns);
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

  const selectedProduct = products.find((p) => String(p.id) === productId);
  // What the returned stock cost us, so the credit field is never blank.
  const suggestedAmount = selectedProduct
    ? round2(Number(selectedProduct.purchasePrice) * Number(quantity || 0))
    : 0;
  const displayedAmount = amountTouched ? amount : suggestedAmount.toFixed(2);
  const totalCredited = supplierReturns.reduce((sum, r) => sum + Number(r.amount), 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const credit = round2(Number(displayedAmount));
    if (!Number.isFinite(credit) || credit < 0) {
      setError("Enter a valid credit amount of zero or more");
      return;
    }
    try {
      await apiFetch("/api/store/supplier-returns", "POST", {
        supplierId: Number(supplierId),
        warehouseId: Number(warehouseId),
        productId: Number(productId),
        quantity: Number(quantity),
        reason: reason || null,
        amount: credit,
      });
      setProductId("");
      setQuantity("1");
      setReason("");
      setAmount("");
      setAmountTouched(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Supplier returns</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Recent returns</h2>
            {supplierReturns.length > 0 ? (
              <p className="text-sm text-slate-500">
                {supplierReturns.length} return{supplierReturns.length === 1 ? "" : "s"} · $
                {totalCredited.toFixed(2)} credited
              </p>
            ) : null}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by supplier, product, warehouse, reason or date…"
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : filteredReturns.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim() ? `No returns match "${search.trim()}".` : "No supplier returns yet."}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredReturns.map((ret) => (
                <div key={ret.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{ret.supplier.name}</p>
                      <p className="text-xs text-slate-500">
                        {ret.product ? `${ret.product.sku} — ${ret.product.name}` : `Product ${ret.productId}`} ×{" "}
                        {ret.quantity}
                      </p>
                      {ret.reason ? <p className="mt-1 text-slate-600">{ret.reason}</p> : null}
                      <p className="mt-0.5 text-xs text-slate-400">{new Date(ret.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-emerald-700">
                        {Number(ret.amount) > 0 ? `$${Number(ret.amount).toFixed(2)}` : "Not recorded"}
                      </p>
                      <p className="text-xs text-slate-500">credit</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Return stock to a supplier</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                onChange={(e) => {
                  setProductId(e.target.value);
                  setAmount("");
                  setAmountTouched(false);
                }}
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
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Credit amount</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={displayedAmount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {amountTouched
                  ? "Using your amount."
                  : selectedProduct
                    ? `Purchase price $${Number(selectedProduct.purchasePrice).toFixed(2)} × ${quantity} — adjust if the supplier credits less.`
                    : "Pick a product to suggest an amount."}
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Reason (optional)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Damaged, wrong item, etc."
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Return to supplier · ${displayedAmount || "0.00"} credit
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

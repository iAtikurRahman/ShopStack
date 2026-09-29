"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string; store: { id: number; name: string } };
type Product = { id: number; sku: string; name: string; purchasePrice: string };
type Supplier = { id: number; name: string };
type PurchaseItem = {
  id: number;
  productId: number;
  quantity: number;
  unitCost: string;
  product: { id: number; sku: string; name: string };
  warehouseId: number;
  warehouse: { id: number; name: string; store: { id: number; name: string } };
};
type Purchase = {
  id: number;
  reference: string | null;
  totalCost: string;
  purchasedAt: string;
  supplier: { id: number; name: string };
  warehouse: { id: number; name: string; store: { id: number; name: string } } | null;
  items: PurchaseItem[];
};
type Line = {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  warehouseId: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineTotal(item: PurchaseItem): string {
  return (item.quantity * Number(item.unitCost)).toFixed(2);
}

function subtotalOf(items: PurchaseItem[]): string {
  return items.reduce((sum, item) => sum + item.quantity * Number(item.unitCost), 0).toFixed(2);
}

export default function CompanyPurchasesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(today());
  const [lines, setLines] = useState<Line[]>([
    { key: 1, productId: "", quantity: "1", unitCost: "", warehouseId: "" },
  ]);
  const nextKey = useRef(2);

  const formTotal = lines
    .reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0)
    .toFixed(2);

  async function loadAll() {
    const [warehousesResult, productsResult, suppliersResult, purchasesResult] = await Promise.allSettled([
      apiFetch<{ warehouses: Warehouse[] }>("/api/company/warehouses"),
      apiFetch<{ products: Product[] }>("/api/company/products"),
      apiFetch<{ suppliers: Supplier[] }>("/api/company/suppliers"),
      apiFetch<{ purchases: Purchase[] }>("/api/company/purchases"),
    ]);
    if (warehousesResult.status === "fulfilled") {
      setWarehouses(warehousesResult.value.warehouses);
      setLines((current) =>
        current.map((line) => ({
          ...line,
          warehouseId: line.warehouseId || String(warehousesResult.value.warehouses[0]?.id ?? ""),
        }))
      );
    }
    if (productsResult.status === "fulfilled") setProducts(productsResult.value.products);
    if (suppliersResult.status === "fulfilled") setSuppliers(suppliersResult.value.suppliers);
    if (purchasesResult.status === "fulfilled") setPurchases(purchasesResult.value.purchases);

    const failures = [warehousesResult, productsResult, suppliersResult, purchasesResult]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason as Error).message);
    setError(failures.length > 0 ? failures.join("; ") : null);
    setLoading(false);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadAll();
    }
    load();
  }, []);

  function addLine() {
    setLines((current) => [
      ...current,
      {
        key: nextKey.current++,
        productId: "",
        quantity: "1",
        unitCost: "",
        warehouseId: String(warehouses[0]?.id ?? ""),
      },
    ]);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectProduct(line: Line, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    updateLine(line.key, {
      productId,
      unitCost: product ? String(product.purchasePrice) : line.unitCost,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payloadItems = lines.map((line) => ({
      productId: Number(line.productId),
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
      warehouseId: Number(line.warehouseId),
    }));
    if (
      payloadItems.some(
        (item) => !item.productId || !item.warehouseId || !item.quantity || item.quantity <= 0
      )
    ) {
      setError("Every line needs a warehouse, product and a quantity above 0.");
      return;
    }

    try {
      await apiFetch("/api/company/purchases", "POST", {
        supplierId: Number(supplierId),
        reference: reference || null,
        purchasedAt,
        items: payloadItems,
      });
      setLines([
        {
          key: nextKey.current++,
          productId: "",
          quantity: "1",
          unitCost: "",
          warehouseId: String(warehouses[0]?.id ?? ""),
        },
      ]);
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
      <p className="text-sm text-slate-600">
        Record what you bought and when - pick today or an earlier date for a purchase you&apos;re logging late.
      </p>

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
                  <p className="mt-1 text-slate-600">
                    {purchase.warehouse
                      ? `${purchase.warehouse.name} (${purchase.warehouse.store.name})`
                      : "Multiple warehouses"}{" "}
                    · {new Date(purchase.purchasedAt).toLocaleDateString()}
                  </p>
                  <div className="mt-3">
                    <div className="grid grid-cols-[1fr_5.5rem_3rem_5.5rem_5.5rem] gap-3 border-b border-slate-200 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <span>Product</span>
                      <span>Warehouse</span>
                      <span className="text-right">Qty</span>
                      <span className="text-right">Unit price</span>
                      <span className="text-right">Total</span>
                    </div>
                    {purchase.items.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_5.5rem_3rem_5.5rem_5.5rem] gap-3 py-1 text-slate-600"
                      >
                        <span className="truncate">
                          {item.product.name}{" "}
                          <span className="text-xs text-slate-500">({item.product.sku})</span>
                        </span>
                        <span className="truncate text-xs text-slate-500">
                          {item.warehouse.name} ({item.warehouse.store.name})
                        </span>
                        <span className="text-right tabular-nums">{item.quantity}</span>
                        <span className="text-right tabular-nums">৳{item.unitCost}</span>
                        <span className="text-right tabular-nums">৳{lineTotal(item)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5 font-medium text-slate-950">
                      <span>Subtotal</span>
                      <span className="tabular-nums">৳{subtotalOf(purchase.items)}</span>
                    </div>
                  </div>
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
          <p className="mt-1 text-xs text-slate-500">
            One delivery from one supplier, as many products as you like - each line can go to a
            different warehouse.
          </p>
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
              <span className="text-sm font-medium text-slate-700">Reference / invoice no. (optional)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Items ({lines.length})</span>
                <span className="text-sm font-semibold text-slate-950 tabular-nums">৳{formTotal}</span>
              </div>
              <div className="mt-2 space-y-3">
                {lines.map((line) => (
                  <div key={line.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start gap-2">
                      <label className="block flex-1">
                        <span className="text-xs font-medium text-slate-600">Product</span>
                        <select
                          required
                          value={line.productId}
                          onChange={(e) => selectProduct(line, e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        >
                          <option value="">Select product</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} — {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        title="Remove item"
                        className="mt-5 h-9 w-9 shrink-0 rounded-xl border border-slate-200 bg-white text-sm text-slate-500 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">Warehouse</span>
                        <select
                          required
                          value={line.warehouseId}
                          onChange={(e) => updateLine(line.key, { warehouseId: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        >
                          {warehouses.length === 0 ? <option value="">No warehouse</option> : null}
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name} ({w.store.name})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">Quantity</span>
                        <input
                          required
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">Unit cost</span>
                        <input
                          required
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitCost}
                          onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        />
                      </label>
                    </div>
                    <p className="mt-1.5 text-right text-xs text-slate-500">
                      Line total{" "}
                      <span className="tabular-nums text-slate-700">
                        ৳{((Number(line.quantity) || 0) * (Number(line.unitCost) || 0)).toFixed(2)}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addLine}
                className="mt-3 w-full rounded-2xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
              >
                + Add another item
              </button>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Record {lines.length > 1 ? `${lines.length} items` : "purchase"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

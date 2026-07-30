"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Product = {
  warehouseStockId: number;
  productId: number;
  sku: string;
  name: string;
  category: string | null;
  purchasePrice: string;
  salePrice: string;
  taxRate: string;
  quantity: number;
  lowStockThreshold: number;
};

export default function WarehouseProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: warehouseId } = use(params);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [quantity, setQuantity] = useState("0");

  async function loadProducts() {
    try {
      const data = await apiFetch<{ products: Product[] }>(`/api/store/warehouses/${warehouseId}/products`);
      setProducts(data.products);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadProducts();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/store/warehouses/${warehouseId}/products`, "POST", {
        sku,
        name,
        purchasePrice: Number(purchasePrice),
        salePrice: Number(salePrice),
        quantity: Number(quantity),
      });
      setSku("");
      setName("");
      setPurchasePrice("");
      setSalePrice("");
      setQuantity("0");
      await loadProducts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdatePrice(productId: number, salePriceValue: string) {
    setError(null);
    try {
      await apiFetch(`/api/store/products/${productId}`, "PUT", { salePrice: Number(salePriceValue) });
      await loadProducts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(productId: number) {
    setError(null);
    try {
      await apiFetch(`/api/store/products/${productId}`, "DELETE");
      await loadProducts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div>
        <Link href="/store/inventory" className="text-sm text-slate-600 hover:underline">
          ← Back to inventory
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Warehouse products</h1>
        <p className="mt-1 text-sm text-slate-600">
          Actions here are gated by your product.view/create/update/delete permissions - if you&apos;re missing
          one, the server will reject the action with an error below.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Products in this warehouse</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : products.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No products stocked here yet.</p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2">SKU</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Sale price</th>
                    <th className="pb-2">Qty</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.productId} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{product.sku}</td>
                      <td className="py-2 font-medium text-slate-950">{product.name}</td>
                      <td className="py-2">
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={product.salePrice}
                          onBlur={(e) => {
                            if (e.target.value !== product.salePrice) handleUpdatePrice(product.productId, e.target.value);
                          }}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-slate-900"
                        />
                      </td>
                      <td className="py-2 text-slate-600">{product.quantity}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(product.productId)}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a product</h2>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">SKU</span>
              <input
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Purchase price</span>
              <input
                required
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Sale price</span>
              <input
                required
                type="number"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Initial quantity</span>
              <input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Add product
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

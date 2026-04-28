"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/services/api";

type Shop = { id: number; name: string };

type Product = {
  id: number;
  name: string;
  quantity: number;
  purchasePrice: string;
  salePrice: string;
  shop: Shop;
};

export default function ProductsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [shopId, setShopId] = useState<number | "">("");
  const [quantity, setQuantity] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(0);
  const [salePrice, setSalePrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [shopData, productData] = await Promise.all([
          apiFetch<Shop[]>("/api/shops"),
          apiFetch<Product[]>("/api/products"),
        ]);
        setShops(shopData);
        setProducts(productData);
        if (!shopId && shopData.length > 0) {
          setShopId(shopData[0].id);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  async function refreshProducts() {
    const productData = await apiFetch<Product[]>("/api/products");
    setProducts(productData);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!shopId) {
      setError("Please select a shop.");
      return;
    }

    try {
      await apiFetch<Product>("/api/products", "POST", {
        shopId,
        name,
        quantity,
        purchasePrice,
        salePrice,
      });
      setName("");
      setQuantity(0);
      setPurchasePrice(0);
      setSalePrice(0);
      await refreshProducts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUpdate(product: Product) {
    const nextQuantity = Number(prompt("New quantity", String(product.quantity))) || product.quantity;
    const nextSalePrice = Number(prompt("New sale price", String(product.salePrice))) || Number(product.salePrice);

    try {
      await apiFetch<Product>(`/api/products/${product.id}`, "PUT", {
        quantity: nextQuantity,
        salePrice: nextSalePrice,
      });
      await refreshProducts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(productId: number) {
    if (!confirm("Delete this product?")) {
      return;
    }

    try {
      await apiFetch<{ message: string }>(`/api/products/${productId}`, "DELETE");
      setProducts((current) => current.filter((product) => product.id !== productId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell title="Product Management">
      <section className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Products</h2>
                <p className="mt-1 text-sm text-slate-600">Create, update and review stock levels.</p>
              </div>
            </div>
            {loading ? (
              <p className="text-sm text-slate-600">Loading products…</p>
            ) : products.length === 0 ? (
              <p className="text-sm text-slate-600">No products available.</p>
            ) : (
              <div className="space-y-4">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-3xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">{product.name}</p>
                        <p className="text-sm text-slate-600">{product.shop.name}</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <p className="text-sm text-slate-700">Stock: {product.quantity}</p>
                        <p className="text-sm text-slate-700">Sale: ${Number(product.salePrice).toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleUpdate(product)}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(product.id)}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Add a new product</h2>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Shop</span>
                <select
                  value={shopId}
                  onChange={(event) => setShopId(Number(event.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                >
                  <option value="">Select a shop</option>
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Product name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
              <label className="grid gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-sm font-medium text-slate-700">Quantity</span>
                  <input
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </div>
                <div>
                  <span className="text-sm font-medium text-slate-700">Purchase price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchasePrice}
                    onChange={(event) => setPurchasePrice(Number(event.target.value))}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </div>
                <div>
                  <span className="text-sm font-medium text-slate-700">Sale price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={salePrice}
                    onChange={(event) => setSalePrice(Number(event.target.value))}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                  />
                </div>
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Save product
              </button>
            </form>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

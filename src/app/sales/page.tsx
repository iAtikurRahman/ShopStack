"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/services/api";

type Shop = { id: number; name: string };

type Product = {
  id: number;
  name: string;
  quantity: number;
  salePrice: string;
  shop: Shop;
};

type CartItem = {
  productId: number;
  name: string;
  quantity: number;
  price: number;
};

export default function SalesPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shopId, setShopId] = useState<number | "">("");
  const [selectedProductId, setSelectedProductId] = useState<number | "">("");
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
        if (shopData.length > 0) {
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

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);

  function handleAddToCart() {
    if (!selectedProduct || quantity <= 0) {
      setError("Please select a product and quantity.");
      return;
    }

    setError(null);
    setCart((current) => {
      const existing = current.find((item) => item.productId === selectedProduct.id);
      if (existing) {
        return current.map((item) =>
          item.productId === selectedProduct.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }

      return [
        ...current,
        {
          productId: selectedProduct.id,
          name: selectedProduct.name,
          quantity,
          price: Number(selectedProduct.salePrice),
        },
      ];
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!shopId || cart.length === 0) {
      setError("Select a shop and add at least one product.");
      return;
    }

    try {
      await apiFetch<{ id: number }>("/api/sales", "POST", {
        shopId,
        items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      });
      setCart([]);
      setSuccess("Sale recorded successfully.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell title="Sales">
      <section className="space-y-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">POS Sales</h2>
              <p className="mt-1 text-sm text-slate-600">Quickly record transactions and update stock automatically.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[0.9fr_0.9fr_0.6fr]">
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
                <span className="text-sm font-medium text-slate-700">Product</span>
                <select
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(Number(event.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} — {product.shop.name} ({product.quantity} left)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleAddToCart}
                className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Add to cart
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-semibold text-slate-950">Cart</h3>
                {cart.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">No products added yet.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {cart.map((item) => (
                      <div key={item.productId} className="rounded-3xl border border-slate-200 bg-white p-4">
                        <p className="font-semibold text-slate-950">{item.name}</p>
                        <p className="mt-1 text-sm text-slate-600">Qty: {item.quantity}</p>
                        <p className="text-sm text-slate-600">Price: ${item.price.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Total</p>
                <p className="mt-4 text-3xl font-semibold text-slate-950">${cartTotal.toFixed(2)}</p>
                <button
                  type="submit"
                  className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Record sale
                </button>
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
          </form>
        </div>
      </section>
    </AppShell>
  );
}

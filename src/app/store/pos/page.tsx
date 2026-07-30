"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string };
type Product = {
  id: number;
  sku: string;
  name: string;
  salePrice: string;
  taxRate: string;
  category: { name: string } | null;
};
type Stock = { warehouseId: number; productId: number; quantity: number };
type Customer = { id: number; name: string; phone: string | null };
type CartLine = { productId: number; name: string; unitPrice: number; taxRate: number; quantity: number };

export default function PosCheckoutPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "mobile" | "other">("cash");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    try {
      const [inv, custs] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[]; stock: Stock[] }>("/api/store/inventory"),
        apiFetch<{ customers: Customer[] }>("/api/store/customers"),
      ]);
      setWarehouses(inv.warehouses);
      setProducts(inv.products);
      setStock(inv.stock);
      setCustomers(custs.customers);
      setWarehouseId((current) => current ?? inv.warehouses[0]?.id ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadData();
    }
    load();
  }, []);

  function availableQty(productId: number) {
    return stock.find((s) => s.warehouseId === warehouseId && s.productId === productId)?.quantity ?? 0;
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((l) => l.productId === product.id);
      const maxQty = availableQty(product.id);
      if (existing) {
        if (existing.quantity >= maxQty) return current;
        return current.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (maxQty <= 0) return current;
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitPrice: Number(product.salePrice),
          taxRate: Number(product.taxRate),
          quantity: 1,
        },
      ];
    });
  }

  function updateQty(productId: number, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((l) => l.productId !== productId)
        : current.map((l) => (l.productId === productId ? { ...l, quantity } : l))
    );
  }

  const { subtotal, taxAmount, total } = useMemo(() => {
    const sub = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const tax = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity * (l.taxRate / 100), 0);
    const t = Math.max(0, sub - Number(discountAmount || 0)) + tax;
    return { subtotal: Math.round(sub * 100) / 100, taxAmount: Math.round(tax * 100) / 100, total: Math.round(t * 100) / 100 };
  }, [cart, discountAmount]);

  async function handleCheckout() {
    if (!warehouseId || cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<{ sale: { id: number } }>("/api/store/pos/checkout", "POST", {
        warehouseId,
        customerId: customerId || null,
        discountAmount: Number(discountAmount || 0),
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        payments: [{ method: paymentMethod, amount: total }],
      });
      router.push(`/store/sales/${data.sale.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Checkout</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Products</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((product) => {
                const qty = availableQty(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={qty <= 0}
                    onClick={() => addToCart(product)}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <p className="text-sm font-semibold text-slate-950">{product.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{product.sku}</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">${product.salePrice}</p>
                    <p className="text-xs text-slate-400">{qty} in stock</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Cart</h2>

          {warehouses.length > 1 ? (
            <select
              value={warehouseId ?? ""}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-slate-900"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : null}

          <div className="mt-4 space-y-2">
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">Cart is empty.</p>
            ) : (
              cart.map((line) => (
                <div key={line.productId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-950">{line.name}</p>
                    <p className="text-xs text-slate-500">${line.unitPrice.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={line.quantity}
                      onChange={(e) => updateQty(line.productId, Number(e.target.value))}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center outline-none focus:border-slate-900"
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <label className="flex items-center justify-between">
              <span className="text-slate-600">Customer</span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 outline-none focus:border-slate-900"
              >
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-slate-600">Discount</span>
              <input
                type="number"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-right outline-none focus:border-slate-900"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-slate-600">Payment method</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 outline-none focus:border-slate-900"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile">Mobile</option>
                <option value="other">Other</option>
              </select>
            </label>

            <div className="space-y-1 border-t border-slate-100 pt-3">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax</span>
                <span>${taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-slate-950">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting || cart.length === 0}
            onClick={handleCheckout}
            className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Processing…" : `Charge $${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
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

// `due` is first in the list because it is the most consequential choice at the
// till. It is deliberately NOT the default: an accidental credit sale is far
// worse than an accidental cash sale, which the cashier can just change.
const PAYMENT_METHODS = [
  "due",
  "cash",
  "card",
  "bkash",
  "rocket",
  "nagad",
  "upay",
  "banglaqr",
  "other",
] as const;
type PaymentMethodOption = (typeof PAYMENT_METHODS)[number];

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export default function PosCheckoutPage() {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodOption>("cash");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  // While a quantity box is being edited we keep the raw text, so backspacing
  // it down to empty doesn't drop the line - the real quantity snaps back on blur.
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});

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

  // Only the ✕ button removes a line - editing the number (even clearing it
  // mid-edit) just changes the quantity.
  function updateQty(productId: number, quantity: number) {
    const maxQty = availableQty(productId);
    const next = Math.min(Math.max(Math.floor(quantity), 1), Math.max(maxQty, 1));
    setCart((current) => current.map((l) => (l.productId === productId ? { ...l, quantity: next } : l)));
  }

  function removeFromCart(productId: number) {
    setCart((current) => current.filter((l) => l.productId !== productId));
    setQtyDrafts((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, productSearch]);

  const trimmedPhone = customerPhone.trim();
  const matchedCustomer = trimmedPhone ? customers.find((c) => c.phone === trimmedPhone) ?? null : null;

  // Mirrors the server's per-line rounding in /api/store/pos/checkout, so a
  // multi-line cart can never be rejected for a payment mismatch.
  const { subtotal, taxAmount, total } = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const l of cart) {
      const lineSubtotal = round2(l.unitPrice * l.quantity);
      sub = round2(sub + lineSubtotal);
      tax = round2(tax + round2(lineSubtotal * (l.taxRate / 100)));
    }
    const discount = Number(discountAmount || 0);
    return { subtotal: sub, taxAmount: tax, total: round2(Math.max(0, sub - discount) + tax) };
  }, [cart, discountAmount]);

  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  async function resolveCustomerId(): Promise<number | null> {
    if (!trimmedPhone) return null;
    if (matchedCustomer) return matchedCustomer.id;
    if (!customerName.trim()) {
      throw new Error(t("storeOps.pos.customerNameRequired"));
    }
    const created = await apiFetch<{ customer: Customer }>("/api/store/customers", "POST", {
      name: customerName.trim(),
      phone: trimmedPhone,
    });
    setCustomers((current) => [created.customer, ...current]);
    return created.customer.id;
  }

  async function handleCheckout() {
    if (!warehouseId || cart.length === 0) return;
    // Caught here so the cashier gets the message before the round-trip, but
    // the route enforces it too - a walk-in due has no customer to owe the money.
    if (paymentMethod === "due" && !trimmedPhone) {
      setError(t("storeOps.pos.dueNeedsCustomer"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const customerId = await resolveCustomerId();
      const data = await apiFetch<{ sale: { id: number } }>("/api/store/pos/checkout", "POST", {
        warehouseId,
        customerId,
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
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.checkout")}</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("nav.products")}</h2>
          <input
            type="text"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder={t("storeOps.pos.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredProducts.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {t("storeOps.pos.noProductsMatch", { search: productSearch })}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {filteredProducts.map((product) => {
                const qty = availableQty(product.id);
                const inCart = cart.find((l) => l.productId === product.id)?.quantity ?? 0;
                const soldOut = qty <= 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={soldOut}
                    onClick={() => addToCart(product)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      inCart > 0 ? "bg-slate-100" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-950">{product.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {product.sku}
                        {product.category ? ` · ${product.category.name}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                      {fmt.money(product.salePrice)}
                    </span>
                    <span
                      className={`w-20 shrink-0 text-right text-xs tabular-nums ${
                        soldOut ? "text-red-500" : qty <= 5 ? "text-amber-600" : "text-slate-500"
                      }`}
                    >
                      {soldOut
                        ? t("storeOps.pos.outOfStock")
                        : t("storeOps.pos.inStock", { qty: fmt.quantity(qty) })}
                    </span>
                    {inCart > 0 ? (
                      <span className="w-16 shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white">
                        ×{fmt.quantity(inCart)}
                      </span>
                    ) : (
                      <span className="w-16 shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-center text-xs font-semibold text-slate-500">
                        {t("storeOps.pos.add")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mt-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">{t("storeOps.pos.cart")}</h2>
            {cart.length > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  {cart.length === 1 && itemCount === 1
                    ? t("storeOps.pos.cartSummarySingle")
                    : cart.length === 1
                      ? t("storeOps.pos.cartSummaryOneProduct", { items: fmt.quantity(itemCount) })
                      : t("storeOps.pos.cartSummary", {
                          products: fmt.quantity(cart.length),
                          items: fmt.quantity(itemCount),
                        })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setQtyDrafts({});
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                >
                  {t("common.clear")}
                </button>
              </div>
            ) : null}
          </div>

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
              <p className="text-sm text-slate-500">{t("storeOps.pos.emptyCart")}</p>
            ) : (
              cart.map((line) => {
                const maxQty = availableQty(line.productId);
                return (
                  <div
                    key={line.productId}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-950">{line.name}</p>
                      <p className="text-xs text-slate-500">
                        {t("storeOps.pos.lineMeta", {
                          price: fmt.number(line.unitPrice, { decimals: 2 }),
                          qty: fmt.quantity(maxQty),
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-slate-700">
                        {fmt.money(round2(line.unitPrice * line.quantity))}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={maxQty}
                        value={qtyDrafts[line.productId] ?? String(line.quantity)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setQtyDrafts((current) => ({ ...current, [line.productId]: raw }));
                          const parsed = Number(raw);
                          if (Number.isInteger(parsed) && parsed > 0) {
                            updateQty(line.productId, parsed);
                          }
                        }}
                        onBlur={() =>
                          setQtyDrafts((current) => {
                            const next = { ...current };
                            delete next[line.productId];
                            return next;
                          })
                        }
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center outline-none focus:border-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => removeFromCart(line.productId)}
                        aria-label={t("storeOps.pos.removeItem", { name: line.name })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 transition hover:border-red-200 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <div>
              <label className="flex items-center justify-between">
                <span className="text-slate-600">{t("storeOps.pos.customerPhone")}</span>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder={t("storeOps.pos.walkInPlaceholder")}
                  className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 outline-none focus:border-slate-900"
                />
              </label>
              {trimmedPhone && matchedCustomer ? (
                <p className="mt-1 text-right text-xs font-medium text-emerald-600">✓ {matchedCustomer.name}</p>
              ) : trimmedPhone ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{t("storeOps.pos.newCustomer")}</span>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder={t("common.name")}
                    className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-900"
                  />
                </div>
              ) : null}
            </div>
            <label className="flex items-center justify-between">
              <span className="text-slate-600">{t("storeOps.pos.discount")}</span>
              <input
                type="number"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-right outline-none focus:border-slate-900"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-slate-600">{t("storeOps.pos.paymentMethod")}</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodOption)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 outline-none focus:border-slate-900"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`storeOps.pos.${method}`)}
                  </option>
                ))}
              </select>
            </label>
            {paymentMethod === "due" ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">{t("storeOps.pos.dueNotice")}</p>
                {!trimmedPhone ? (
                  <p className="mt-0.5 text-red-600">{t("storeOps.pos.dueNeedsCustomer")}</p>
                ) : null}
                <p className="mt-0.5 tabular-nums">
                  {t("storeOps.pos.dueAdds", { amount: fmt.number(total, { decimals: 2 }) })}
                </p>
              </div>
            ) : null}

            <div className="space-y-1 border-t border-slate-100 pt-3">
              <div className="flex justify-between text-slate-600">
                <span>{t("storeOps.pos.subtotal")}</span>
                <span>{fmt.money(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{t("storeOps.pos.tax")}</span>
                <span>{fmt.money(taxAmount)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-slate-950">
                <span>{t("common.total")}</span>
                <span>{fmt.money(total)}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting || cart.length === 0 || (paymentMethod === "due" && !trimmedPhone)}
            onClick={handleCheckout}
            className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? t("storeOps.pos.processing")
              : cart.length === 0
                ? t("storeOps.pos.chargeEmpty")
                : itemCount === 1
                  ? t("storeOps.pos.chargeOne", { total: fmt.number(total, { decimals: 2 }) })
                  : t("storeOps.pos.charge", {
                      total: fmt.number(total, { decimals: 2 }),
                      items: fmt.quantity(itemCount),
                    })}
          </button>
        </div>
      </div>
    </main>
  );
}

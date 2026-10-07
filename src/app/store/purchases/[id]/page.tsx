"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import { round2 } from "@/lib/returns";
import { convertQuantity, unitLabel } from "@/lib/units";

// The "nothing was paid" marker, matching the purchase form and the POS.
const DUE_METHOD = "due";

type Product = { id: number; unit: string | null; unitValue: string | null };
type PurchaseItem = {
  id: number;
  productId: number;
  quantity: number;
  unit: string | null;
  stockQuantity: string;
  unitCost: string;
  product: { id: number; sku: string; name: string; purchasePrice: string };
  warehouse: { id: number; name: string };
};
type Purchase = {
  id: number;
  warehouseId: number | null;
  reference: string | null;
  totalCost: string;
  paymentMethod: string | null;
  purchasedAt: string;
  supplier: { id: number; name: string };
  items: PurchaseItem[];
};
type StockRow = { id: number; warehouseId: number; productId: number; quantity: number };

function lineTotal(item: PurchaseItem): number {
  return item.quantity * Number(item.unitCost);
}

function stockKey(warehouseId: number, productId: number): string {
  return `${warehouseId}:${productId}`;
}

export default function StorePurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tEnum, fmt, locale } = useI18n();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [returnQty, setReturnQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [detail, inventory] = await Promise.all([
          apiFetch<{ purchase: Purchase }>(`/api/store/purchases/${id}`),
          apiFetch<{ stock: StockRow[]; products: Product[] }>("/api/store/inventory"),
        ]);
        setPurchase(detail.purchase);
        setStock(inventory.stock);
        setProducts(inventory.products);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // Refresh the in-stock counts after a return moves goods back.
  async function refreshStock() {
    try {
      const inventory = await apiFetch<{ stock: StockRow[] }>("/api/store/inventory");
      setStock(inventory.stock);
    } catch {
      // Non-fatal: the return went through, a stale stock count just lingers.
    }
  }

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((row) => map.set(stockKey(row.warehouseId, row.productId), row.quantity));
    return map;
  }, [stock]);

  // Lines written before the unit column carry null; fall back to the product
  // row so their quantities are still labelled and converted correctly.
  const productById = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const items = useMemo(() => purchase?.items ?? [], [purchase]);

  const unitOf = (item: PurchaseItem) => item.unit ?? productById.get(item.productId)?.unit ?? null;

  const selected = useMemo(() => {
    if (!purchase) return { count: 0, credit: 0, qtyByItem: [] as { item: PurchaseItem; qty: number }[] };
    const qtyByItem: { item: PurchaseItem; qty: number }[] = [];
    for (const item of items) {
      const qty = Number(returnQty[item.id] ?? "0");
      if (qty > 0 && qty <= item.quantity) {
        qtyByItem.push({ item, qty });
      }
    }
    return {
      count: qtyByItem.reduce((sum, { qty }) => sum + qty, 0),
      credit: qtyByItem.reduce((sum, { item, qty }) => sum + qty * Number(item.unitCost), 0),
      qtyByItem,
    };
  }, [purchase, items, returnQty]);

  function setQty(itemId: number, value: string) {
    setReturnQty((current) => ({ ...current, [itemId]: value }));
    setSuccessMessage(null);
    setSubmitError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);
    if (!purchase || selected.qtyByItem.length === 0) {
      setSubmitError(t("storeCommerce.purchaseDetail.nothingSelected"));
      return;
    }

    setSubmitting(true);
    let returned = 0;
    try {
      // One supplierReturn row per item - the model is line-shaped, not
      // purchase-shaped, so a single delivery can be returned in parts.
      for (const { item, qty } of selected.qtyByItem) {
        await apiFetch("/api/store/supplier-returns", "POST", {
          supplierId: purchase.supplier.id,
          warehouseId: item.warehouse.id,
          productId: item.product.id,
          quantity: qty,
          unit: unitOf(item),
          reason: reason || null,
          amount: round2(qty * Number(item.unitCost)),
        });
        returned += qty;
      }
      setSuccessMessage(
        t("storeCommerce.purchaseDetail.success", { count: fmt.quantity(returned) })
      );
      setReturnQty({});
      setReason("");
      await refreshStock();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <Link href="/store/purchases" className="text-sm text-slate-600 hover:underline">
        {t("storeCommerce.purchaseDetail.backToPurchases")}
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">{t("common.loading")}</p>
      ) : error || !purchase ? (
        <p className="text-sm text-red-600">{error ?? t("storeCommerce.purchaseDetail.notFound")}</p>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">
                  {t("storeCommerce.purchaseDetail.label", { id: fmt.number(purchase.id) })}
                  {purchase.reference ? ` · ${purchase.reference}` : ""}
                </h1>
                <p className="mt-1 text-sm text-slate-600">{purchase.supplier.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">{fmt.dateTime(purchase.purchasedAt)}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-slate-950">{fmt.money(purchase.totalCost)}</p>
                {purchase.paymentMethod ? (
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      purchase.paymentMethod === DUE_METHOD
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {tEnum(purchase.paymentMethod)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("storeCommerce.purchases.recent")}
              </h2>
              <p className="text-sm text-slate-500">
                {items.length === 1
                  ? t("storeCommerce.purchaseDetail.itemCountOne")
                  : t("storeCommerce.purchaseDetail.itemCountMany", {
                      count: fmt.number(items.length),
                    })}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_5rem_6.5rem_5.5rem_5.5rem] gap-3 border-b border-slate-200 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              <span>{t("storeCommerce.purchases.product")}</span>
              <span>{t("storeCommerce.purchases.warehouse")}</span>
              <span className="text-right">{t("storeCommerce.purchases.qty")}</span>
              <span className="text-right">{t("storeCommerce.purchases.unitPrice")}</span>
              <span className="text-right">{t("common.total")}</span>
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_5rem_6.5rem_5.5rem_5.5rem] gap-3 py-1 text-slate-600"
              >
                <span className="truncate">
                  {item.product.name}{" "}
                  <span className="text-xs text-slate-500">({item.product.sku})</span>
                </span>
                <span className="truncate text-xs text-slate-500">{item.warehouse.name}</span>
                <span className="text-right tabular-nums">
                  {fmt.quantity(item.quantity)} {unitLabel(unitOf(item), locale)}
                </span>
                <span className="text-right tabular-nums">{fmt.money(item.unitCost)}</span>
                <span className="text-right tabular-nums">{fmt.money(lineTotal(item))}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5 font-medium text-slate-950">
              <span>{t("storeCommerce.purchases.subtotal")}</span>
              <span className="tabular-nums">{fmt.money(purchase.totalCost)}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              {t("storeCommerce.purchaseDetail.returnWhat")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t("storeCommerce.purchaseDetail.returnHelper")}
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              {items.map((item) => {
                const available = stockMap.get(stockKey(item.warehouse.id, item.product.id)) ?? 0;
                const qtyValue = Number(returnQty[item.id] ?? "0");
                // Stock is counted in the product's stock unit while the return is
                // entered in the line unit, so convert before comparing.
                const product = productById.get(item.productId);
                const packFactor = product?.unitValue ? Number(product.unitValue) : null;
                const inStockUnit =
                  convertQuantity(qtyValue, unitOf(item), product?.unit, packFactor) ?? qtyValue;
                const overStock = qtyValue > 0 && inStockUnit > available;
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-950">{item.product.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.product.sku} · {item.warehouse.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {t("storeCommerce.purchaseDetail.purchasedQty")}{" "}
                          <span className="tabular-nums">
                            {fmt.quantity(item.quantity)} {unitLabel(unitOf(item), locale)}
                          </span>
                          {" · "}
                          {t("storeCommerce.purchaseDetail.credit")}{" "}
                          <span className="tabular-nums">{fmt.money(item.unitCost)}</span>
                        </p>
                        <p className={`mt-1 text-xs ${overStock ? "font-semibold text-red-700" : "text-slate-400"}`}>
                          {overStock
                            ? t("storeCommerce.purchaseDetail.oversold", { count: fmt.quantity(available) })
                            : t("storeCommerce.purchaseDetail.inStock", { count: fmt.quantity(available) })}
                        </p>
                      </div>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">
                          {t("storeCommerce.purchaseDetail.returnQty")}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          step="any"
                          inputMode="decimal"
                          value={returnQty[item.id] ?? "0"}
                          onChange={(e) => setQty(item.id, e.target.value)}
                          className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-900"
                        />
                      </label>
                    </div>
                    {qtyValue > 0 && qtyValue <= item.quantity ? (
                      <p className="mt-2 text-right text-xs text-slate-500">
                        {t("storeCommerce.purchaseDetail.credit")}:{" "}
                        <span className="tabular-nums text-slate-700">
                          {fmt.money(round2(qtyValue * Number(item.unitCost)))}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              })}

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("storeCommerce.purchaseDetail.reasonOptional")}
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("storeCommerce.purchaseDetail.reasonPlaceholder")}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
                />
              </label>

              {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
              {successMessage ? (
                <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                  {successMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting || selected.qtyByItem.length === 0}
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting
                  ? t("common.loading")
                  : selected.count === 1
                    ? t("storeCommerce.purchaseDetail.submitOne", {
                        amount: fmt.number(selected.credit, { decimals: 2 }),
                      })
                    : t("storeCommerce.purchaseDetail.submitMany", {
                        count: fmt.number(selected.count),
                        amount: fmt.number(selected.credit, { decimals: 2 }),
                      })}
              </button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}

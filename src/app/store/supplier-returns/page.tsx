"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import { round2 } from "@/lib/returns";

type Warehouse = { id: number; name: string };
type Product = { id: number; sku: string; name: string; purchasePrice: string };
type Supplier = { id: number; name: string };
type StockRow = { id: number; warehouseId: number; productId: number; quantity: number };
type PurchaseItem = {
  id: number;
  productId: number;
  quantity: number;
  unitCost: string;
  product: { id: number; sku: string; name: string; purchasePrice: string };
  warehouse: { id: number; name: string };
};
type Purchase = {
  id: number;
  reference: string | null;
  totalCost: string;
  purchasedAt: string;
  supplier: { id: number; name: string };
  items: PurchaseItem[];
};
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

function stockKey(warehouseId: number, productId: number): string {
  return `${warehouseId}:${productId}`;
}

function SupplierReturnsForm() {
  const { t, fmt } = useI18n();
  const searchParams = useSearchParams();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Number-based return, mirroring how sale returns load a sale.
  const [purchaseIdInput, setPurchaseIdInput] = useState(searchParams.get("purchaseId") ?? "");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [processLoading, setProcessLoading] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // History list.
  const [search, setSearch] = useState("");
  const [returnsError, setReturnsError] = useState<string | null>(null);

  // Manual "return anything" form, kept from the original screen.
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [manualReason, setManualReason] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((row) => map.set(stockKey(row.warehouseId, row.productId), row.quantity));
    return map;
  }, [stock]);

  async function loadReturns() {
    setReturnsError(null);
    try {
      const data = await apiFetch<{ supplierReturns: SupplierReturn[] }>("/api/store/supplier-returns");
      setSupplierReturns(data.supplierReturns);
    } catch (err) {
      setReturnsError((err as Error).message);
    }
  }

  async function refreshStock() {
    try {
      const inventory = await apiFetch<{ stock: StockRow[] }>("/api/store/inventory");
      setStock(inventory.stock);
    } catch {
      // Non-fatal: the return went through, a stale stock count just lingers.
    }
  }

  async function loadPurchase(idOrRef: string) {
    const q = idOrRef.trim();
    if (!q) return;
    setProcessLoading(true);
    setReturnError(null);
    setSuccess(null);
    try {
      const data = await apiFetch<{ purchases: Purchase[] }>(
        `/api/store/purchases?lookup=${encodeURIComponent(q)}`
      );
      const match = data.purchases[0];
      if (!match) {
        setReturnError(t("storeCommerce.purchaseDetail.notFoundByNumber"));
        setPurchase(null);
        return;
      }
      setPurchase(match);
      setQuantities({});
    } catch (err) {
      setReturnError((err as Error).message);
      setPurchase(null);
    } finally {
      setProcessLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [inventoryData, suppliersData] = await Promise.all([
          apiFetch<{ warehouses: Warehouse[]; products: Product[]; stock: StockRow[] }>("/api/store/inventory"),
          apiFetch<{ suppliers: Supplier[] }>("/api/store/suppliers"),
        ]);
        setWarehouses(inventoryData.warehouses);
        setProducts(inventoryData.products);
        setStock(inventoryData.stock);
        setSuppliers(suppliersData.suppliers);
        setWarehouseId((current) => current || String(inventoryData.warehouses[0]?.id ?? ""));
        if (purchaseIdInput.trim()) {
          await loadPurchase(purchaseIdInput);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadHistory() {
      await loadReturns();
    }
    loadHistory();
  }, []);

  const selectedItems = useMemo(() => {
    if (!purchase) return { count: 0, credit: 0, lines: [] as { item: PurchaseItem; qty: number }[] };
    const lines: { item: PurchaseItem; qty: number }[] = [];
    for (const item of purchase.items) {
      const qty = quantities[item.id] ?? 0;
      if (Number.isInteger(qty) && qty > 0 && qty <= item.quantity) {
        lines.push({ item, qty });
      }
    }
    return {
      count: lines.reduce((sum, { qty }) => sum + qty, 0),
      credit: lines.reduce((sum, { item, qty }) => sum + qty * Number(item.unitCost), 0),
      lines,
    };
  }, [purchase, quantities]);

  async function handleProcessSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchase) return;
    setReturnError(null);
    setSuccess(null);

    if (selectedItems.lines.length === 0) {
      setReturnError(t("storeCommerce.purchaseDetail.nothingSelected"));
      return;
    }

    setProcessLoading(true);
    let returned = 0;
    try {
      for (const { item, qty } of selectedItems.lines) {
        await apiFetch("/api/store/supplier-returns", "POST", {
          supplierId: purchase.supplier.id,
          warehouseId: item.warehouse.id,
          productId: item.product.id,
          quantity: qty,
          reason: reason || null,
          amount: round2(qty * Number(item.unitCost)),
        });
        returned += qty;
      }
      setSuccess(t("storeCommerce.purchaseDetail.success", { count: fmt.quantity(returned) }));
      setQuantities({});
      setReason("");
      await Promise.all([loadReturns(), refreshStock()]);
    } catch (err) {
      setReturnError((err as Error).message);
    } finally {
      setProcessLoading(false);
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === productId);
  const suggestedAmount = selectedProduct
    ? round2(Number(selectedProduct.purchasePrice) * Number(quantity || 0))
    : 0;
  const displayedAmount = amountTouched ? manualAmount : suggestedAmount.toFixed(2);
  const totalCredited = supplierReturns.reduce((sum, r) => sum + Number(r.amount), 0);

  async function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const credit = round2(Number(displayedAmount));
    if (!Number.isFinite(credit) || credit < 0) {
      setError(t("storeCommerce.supplierReturns.validationError"));
      return;
    }
    try {
      await apiFetch("/api/store/supplier-returns", "POST", {
        supplierId: Number(supplierId),
        warehouseId: Number(warehouseId),
        productId: Number(productId),
        quantity: Number(quantity),
        reason: manualReason || null,
        amount: credit,
      });
      setProductId("");
      setQuantity("1");
      setManualReason("");
      setManualAmount("");
      setAmountTouched(false);
      await Promise.all([loadReturns(), refreshStock()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const query = search.trim().toLowerCase();
  const filteredReturns = query
    ? supplierReturns.filter((ret) => {
        const warehouse = warehouses.find((w) => w.id === ret.warehouseId);
        return (
          ret.supplier.name.toLowerCase().includes(query) ||
          `${ret.product?.name ?? ""} ${ret.product?.sku ?? ""}`.toLowerCase().includes(query) ||
          (ret.reason ?? "").toLowerCase().includes(query) ||
          (warehouse?.name ?? "").toLowerCase().includes(query) ||
          ret.amount.includes(query) ||
          ret.createdAt.slice(0, 10).includes(query)
        );
      })
    : supplierReturns;

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.supplierReturns")}</h1>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          {t("storeCommerce.supplierReturns.processTitle")}
        </h2>

        <div className="mt-4 flex gap-3">
          <input
            value={purchaseIdInput}
            onChange={(e) => setPurchaseIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                loadPurchase(purchaseIdInput);
              }
            }}
            placeholder={t("storeCommerce.supplierReturns.purchaseNumberPlaceholder")}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="button"
            onClick={() => loadPurchase(purchaseIdInput)}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
          >
            {t("storeCommerce.purchaseDetail.loadPurchase")}
          </button>
        </div>

        {processLoading ? <p className="mt-3 text-sm text-slate-600">{t("common.loading")}</p> : null}
        {returnError ? <p className="mt-3 text-sm text-red-600">{returnError}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-600">{success}</p> : null}

        {purchase ? (
          <form onSubmit={handleProcessSubmit} className="mt-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="font-semibold text-slate-950">
                  {t("storeCommerce.purchaseDetail.label", { id: purchase.id })}
                  {purchase.reference ? ` · ${purchase.reference}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {purchase.supplier.name} · {fmt.dateTime(purchase.purchasedAt)}
                </p>
              </div>
              <p className="font-semibold text-slate-950">{fmt.money(purchase.totalCost)}</p>
            </div>

            <div className="space-y-3">
              {purchase.items.map((item) => {
                const available = stockMap.get(stockKey(item.warehouse.id, item.productId)) ?? 0;
                const qtyValue = quantities[item.id] ?? 0;
                const overStock = qtyValue > 0 && qtyValue > available;
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">
                        {t("storeCommerce.supplierReturns.productFallback", { id: item.product.id })}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.product.sku} · {item.warehouse.name} ·{" "}
                        {t("storeCommerce.purchases.qty")}{" "}
                        <span className="tabular-nums">{fmt.quantity(item.quantity)}</span>
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
                        step={1}
                        inputMode="numeric"
                        value={quantities[item.id] ?? 0}
                        onChange={(e) =>
                          setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))
                        }
                        className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-900"
                      />
                    </label>
                  </div>
                );
              })}
            </div>

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

            <button
              type="submit"
              disabled={processLoading || purchase.items.length === 0}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {processLoading
                ? t("common.loading")
                : selectedItems.count === 1
                  ? t("storeCommerce.purchaseDetail.submitOne", {
                      amount: fmt.number(selectedItems.credit, { decimals: 2 }),
                    })
                  : selectedItems.count === 0
                    ? t("storeCommerce.purchaseDetail.submitEmpty")
                    : t("storeCommerce.purchaseDetail.submitMany", {
                        count: fmt.number(selectedItems.count),
                        amount: fmt.number(selectedItems.credit, { decimals: 2 }),
                      })}
            </button>
          </form>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">
              {t("storeCommerce.supplierReturns.recent")}
            </h2>
            {supplierReturns.length > 0 ? (
              <p className="text-sm text-slate-500">
                {supplierReturns.length === 1
                  ? t("storeCommerce.supplierReturns.summaryOne", {
                      total: fmt.number(totalCredited, { decimals: 2 }),
                    })
                  : t("storeCommerce.supplierReturns.summaryMany", {
                      count: fmt.number(supplierReturns.length),
                      total: fmt.number(totalCredited, { decimals: 2 }),
                    })}
              </p>
            ) : null}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("storeCommerce.supplierReturns.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : returnsError ? (
            <p className="mt-6 text-sm text-red-600">{returnsError}</p>
          ) : supplierReturns.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">{t("storeCommerce.supplierReturns.noneYet")}</p>
          ) : filteredReturns.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {t("storeCommerce.supplierReturns.noMatch", { search: search.trim() })}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredReturns.map((ret) => {
                const warehouse = warehouses.find((w) => w.id === ret.warehouseId);
                return (
                  <div key={ret.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-950">{ret.supplier.name}</p>
                        <p className="text-xs text-slate-500">
                          {ret.product
                            ? `${ret.product.sku} — ${ret.product.name}`
                            : t("storeCommerce.supplierReturns.productFallback", { id: ret.productId })}{" "}
                          × {fmt.quantity(ret.quantity)}
                        </p>
                        {ret.reason ? <p className="mt-1 text-slate-600">{ret.reason}</p> : null}
                        <p className="mt-0.5 text-xs text-slate-400">
                          {fmt.dateTime(ret.createdAt)}
                          {warehouse ? ` · ${warehouse.name}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium text-emerald-700">
                          {Number(ret.amount) > 0
                            ? fmt.money(ret.amount)
                            : t("storeCommerce.supplierReturns.notRecorded")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t("storeCommerce.supplierReturns.creditLabel")}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.supplierReturns.returnTitle")}
          </h2>
          <form onSubmit={handleManualSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.supplierReturns.warehouse")}
              </span>
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
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.supplierReturns.supplier")}
              </span>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("storeCommerce.supplierReturns.selectSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.supplierReturns.product")}
              </span>
              <select
                required
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setManualAmount("");
                  setAmountTouched(false);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("storeCommerce.supplierReturns.selectProduct")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.quantity")}</span>
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
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.supplierReturns.creditAmount")}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={displayedAmount}
                onChange={(e) => {
                  setManualAmount(e.target.value);
                  setAmountTouched(true);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {amountTouched
                  ? t("storeCommerce.supplierReturns.amountHintTouched")
                  : selectedProduct
                    ? t("storeCommerce.supplierReturns.amountHintProduct", {
                        price: fmt.number(selectedProduct.purchasePrice, { decimals: 2 }),
                        qty: fmt.quantity(quantity),
                      })
                    : t("storeCommerce.supplierReturns.amountHintEmpty")}
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.supplierReturns.reasonOptional")}
              </span>
              <input
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder={t("storeCommerce.supplierReturns.reasonPlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("storeCommerce.supplierReturns.submit", {
                amount: fmt.number(displayedAmount || 0, { decimals: 2 }),
              })}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function StoreSupplierReturnsPage() {
  const { t } = useI18n();

  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl p-8 text-sm text-slate-600">{t("common.loading")}</main>
      }
    >
      <SupplierReturnsForm />
    </Suspense>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useBanks } from "@/hooks/useBanks";
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
  product: { id: number; sku: string; name: string };
  warehouseId: number;
  warehouse: { id: number; name: string };
};
type Purchase = {
  id: number;
  warehouseId: number | null;
  reference: string | null;
  totalCost: string;
  purchasedAt: string;
  paymentMethod: string | null;
  supplier: { id: number; name: string };
  items: PurchaseItem[];
};
type Line = {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  warehouseId: string;
};

// The "nothing was paid" marker. It leads the list for the same reason as at
// the till - it is the choice with a lasting balance-sheet consequence - and
// every real method after it comes from the bank_info table at runtime, so this
// screen, the POS and the ledger can never drift onto different vocabularies.
const DUE_METHOD = "due";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineTotal(item: PurchaseItem): number {
  return item.quantity * Number(item.unitCost);
}

function subtotalOf(items: PurchaseItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * Number(item.unitCost), 0);
}

export default function StorePurchasesPage() {
  const { t, tEnum, fmt } = useI18n();
  const { banks, loading: banksLoading } = useBanks();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Return-by-supply-number state, mirroring how sale returns load a sale.
  const [returnInput, setReturnInput] = useState("");
  const [returnPurchase, setReturnPurchase] = useState<Purchase | null>(null);
  const [returnQty, setReturnQty] = useState<Record<number, string>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnSuccess, setReturnSuccess] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [purchasedAt, setPurchasedAt] = useState(today());
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { key: 1, productId: "", quantity: "1", unitCost: "", warehouseId: "" },
  ]);
  const nextKey = useRef(2);

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter((purchase) => {
      const matchesItem = purchase.items.some(
        (item) =>
          `${item.product.name} ${item.product.sku} ${item.warehouse.name}`.toLowerCase().includes(q)
      );
      return (
        purchase.supplier.name.toLowerCase().includes(q) ||
        matchesItem ||
        String(purchase.id).includes(q) ||
        (purchase.reference ?? "").toLowerCase().includes(q) ||
        purchase.totalCost.includes(q) ||
        purchase.purchasedAt.slice(0, 10).includes(q)
      );
    });
  }, [purchases, search]);

  const formTotal = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0),
    [lines]
  );

  // A deactivated account leaves the stored selection pointing at an option the
  // dropdown no longer offers, which would render blank and submit a blank
  // method. Resolved at render, so what the form submits is always on the list.
  const methodOptions = useMemo(() => banks.map((bank) => bank.bankName), [banks]);
  const activeMethod =
    paymentMethod === DUE_METHOD || methodOptions.includes(paymentMethod)
      ? paymentMethod
      : methodOptions[0] ?? DUE_METHOD;

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((row) => map.set(`${row.warehouseId}:${row.productId}`, row.quantity));
    return map;
  }, [stock]);

  const returnSelected = useMemo(() => {
    if (!returnPurchase) return { count: 0, credit: 0, lines: [] as { item: PurchaseItem; qty: number }[] };
    const lines: { item: PurchaseItem; qty: number }[] = [];
    for (const item of returnPurchase.items) {
      const qty = Number(returnQty[item.id] ?? "0");
      if (Number.isInteger(qty) && qty > 0 && qty <= item.quantity) {
        lines.push({ item, qty });
      }
    }
    return {
      count: lines.reduce((sum, { qty }) => sum + qty, 0),
      credit: lines.reduce((sum, { item, qty }) => sum + qty * Number(item.unitCost), 0),
      lines,
    };
  }, [returnPurchase, returnQty]);

  function setReturnQtyFor(itemId: number, value: string) {
    setReturnQty((current) => ({ ...current, [itemId]: value }));
    setReturnSuccess(null);
    setReturnError(null);
  }

  function lookupReturn(raw: string) {
    const q = raw.trim();
    setReturnError(null);
    setReturnSuccess(null);
    if (!q) {
      setReturnPurchase(null);
      setReturnQty({});
      return;
    }
    const match = purchases.find(
      (p) => String(p.id) === q || (p.reference ?? "").toLowerCase() === q.toLowerCase()
    );
    if (!match) {
      setReturnPurchase(null);
      setReturnQty({});
      setReturnError(t("storeCommerce.purchaseDetail.notFoundByNumber"));
      return;
    }
    setReturnPurchase(match);
    setReturnQty({});
  }

  async function submitReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReturnError(null);
    setReturnSuccess(null);
    if (!returnPurchase || returnSelected.lines.length === 0) {
      setReturnError(t("storeCommerce.purchaseDetail.nothingSelected"));
      return;
    }
    setReturnSubmitting(true);
    let returned = 0;
    try {
      for (const { item, qty } of returnSelected.lines) {
        await apiFetch("/api/store/supplier-returns", "POST", {
          supplierId: returnPurchase.supplier.id,
          warehouseId: item.warehouse.id,
          productId: item.product.id,
          quantity: qty,
          reason: returnReason || null,
          amount: round2(qty * Number(item.unitCost)),
        });
        returned += qty;
      }
      setReturnSuccess(t("storeCommerce.purchaseDetail.success", { count: fmt.quantity(returned) }));
      setReturnQty({});
      setReturnReason("");
      const inventory = await apiFetch<{ stock: StockRow[] }>("/api/store/inventory");
      setStock(inventory.stock);
    } catch (err) {
      setReturnError((err as Error).message);
    } finally {
      setReturnSubmitting(false);
    }
  }

  async function loadAll() {
    try {
      const [inventoryData, suppliersData, purchasesData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[]; stock: StockRow[] }>("/api/store/inventory"),
        apiFetch<{ suppliers: Supplier[] }>("/api/store/suppliers"),
        apiFetch<{ purchases: Purchase[] }>("/api/store/purchases"),
      ]);
      setWarehouses(inventoryData.warehouses);
      setProducts(inventoryData.products);
      setStock(inventoryData.stock);
      setSuppliers(suppliersData.suppliers);
      setPurchases(purchasesData.purchases);
      setLines((current) =>
        current.map((line) => ({
          ...line,
          warehouseId: line.warehouseId || String(inventoryData.warehouses[0]?.id ?? ""),
        }))
      );
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
      setError(t("storeCommerce.purchases.validationError"));
      return;
    }

    try {
      await apiFetch("/api/store/purchases", "POST", {
        supplierId: Number(supplierId),
        reference: reference || null,
        purchasedAt,
        paymentMethod: activeMethod,
        items: payloadItems,
      });
      setLines((current) =>
        current.map((line, index) =>
          index === 0 ? { ...line, productId: "", quantity: "1", unitCost: "" } : line
        )
      );
      if (lines.length > 1) {
        setLines([
          {
            key: nextKey.current++,
            productId: "",
            quantity: "1",
            unitCost: "",
            warehouseId: String(warehouses[0]?.id ?? ""),
          },
        ]);
      }
      setReference("");
      setPurchasedAt(today());
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">
        {t("storeCommerce.purchases.title")}
      </h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.purchases.recent")}
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("storeCommerce.purchases.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredPurchases.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("storeCommerce.purchases.noMatch", { search: search.trim() })
                : t("storeCommerce.purchases.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredPurchases.map((purchase) => (
                <Link
                  key={purchase.id}
                  href={`/store/purchases/${purchase.id}`}
                  title={t("storeCommerce.purchases.openDetail")}
                  className="group block rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm transition hover:border-slate-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">
                      {t("storeCommerce.purchaseDetail.label", { id: fmt.number(purchase.id) })}
                    </p>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="tabular-nums">{fmt.money(purchase.totalCost)}</span>
                      <span className="text-slate-400 transition group-hover:translate-x-0.5">›</span>
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {purchase.supplier.name} · {fmt.date(purchase.purchasedAt)}
                    {purchase.warehouseId === null ? (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {t("storeCommerce.purchases.multipleWarehouses")}
                      </span>
                    ) : null}
                    {purchase.paymentMethod ? (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                          purchase.paymentMethod === DUE_METHOD
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {tEnum(purchase.paymentMethod)}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-3">
                    <div className="grid grid-cols-[1fr_4.5rem_3rem_5.5rem_5.5rem] gap-3 border-b border-slate-200 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <span>{t("storeCommerce.purchases.product")}</span>
                      <span>{t("storeCommerce.purchases.warehouse")}</span>
                      <span className="text-right">{t("storeCommerce.purchases.qty")}</span>
                      <span className="text-right">{t("storeCommerce.purchases.unitPrice")}</span>
                      <span className="text-right">{t("common.total")}</span>
                    </div>
                    {purchase.items.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[1fr_4.5rem_3rem_5.5rem_5.5rem] gap-3 py-1 text-slate-600"
                      >
                        <span className="truncate">
                          {item.product.name}{" "}
                          <span className="text-xs text-slate-500">({item.product.sku})</span>
                        </span>
                        <span className="truncate text-xs text-slate-500">{item.warehouse.name}</span>
                        <span className="text-right tabular-nums">{fmt.quantity(item.quantity)}</span>
                        <span className="text-right tabular-nums">{fmt.money(item.unitCost)}</span>
                        <span className="text-right tabular-nums">{fmt.money(lineTotal(item))}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5 font-medium text-slate-950">
                      <span>{t("storeCommerce.purchases.subtotal")}</span>
                      <span className="tabular-nums">{fmt.money(subtotalOf(purchase.items))}</span>
                    </div>
                  </div>
                  {purchase.reference ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {t("storeCommerce.purchases.refLabel", { reference: purchase.reference })}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.purchases.recordTitle")}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{t("storeCommerce.purchases.helper")}</p>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.purchases.purchasedOn")}
              </span>
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
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.purchases.supplier")}
              </span>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("storeCommerce.purchases.selectSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.purchases.referenceOptional")}
              </span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.purchases.paymentMethod")}
              </span>
              <select
                value={activeMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {/* The account's running balance rides along, because paying for
                    stock is what actually drains it. */}
                <option value={DUE_METHOD}>{tEnum(DUE_METHOD)}</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.bankName}>
                    {`${tEnum(bank.bankName)} — ${fmt.money(bank.remainingBalance)}`}
                  </option>
                ))}
              </select>
            </label>
            {banksLoading ? (
              <p className="text-xs text-slate-500">{t("common.loading")}</p>
            ) : null}
            {activeMethod === DUE_METHOD ? (
              <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                {t("storeCommerce.purchases.dueNotice", {
                  amount: fmt.number(formTotal, { decimals: 2 }),
                })}
              </p>
            ) : null}

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  {t("storeCommerce.purchases.itemsCount", { count: fmt.number(lines.length) })}
                </span>
                <span className="text-sm font-semibold text-slate-950 tabular-nums">{fmt.money(formTotal)}</span>
              </div>
              <div className="mt-2 space-y-3">
                {lines.map((line) => (
                  <div key={line.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start gap-2">
                      <label className="block flex-1">
                        <span className="text-xs font-medium text-slate-600">
                          {t("storeCommerce.purchases.product")}
                        </span>
                        <select
                          required
                          value={line.productId}
                          onChange={(e) => selectProduct(line, e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        >
                          <option value="">{t("storeCommerce.purchases.selectProduct")}</option>
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
                        title={t("storeCommerce.purchases.removeItem")}
                        className="mt-5 h-9 w-9 shrink-0 rounded-xl border border-slate-200 bg-white text-sm text-slate-500 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">
                          {t("storeCommerce.purchases.warehouse")}
                        </span>
                        <select
                          required
                          value={line.warehouseId}
                          onChange={(e) => updateLine(line.key, { warehouseId: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        >
                          {warehouses.length === 0 ? (
                            <option value="">{t("storeCommerce.purchases.noWarehouse")}</option>
                          ) : null}
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600">
                          {t("common.quantity")}
                        </span>
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
                        <span className="text-xs font-medium text-slate-600">
                          {t("storeCommerce.purchases.unitCost")}
                        </span>
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
                      {t("storeCommerce.purchases.lineTotal")} {" "}
                      <span className="tabular-nums text-slate-700">
                        {fmt.money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}
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
                {t("storeCommerce.purchases.addAnotherItem")}
              </button>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {lines.length > 1
                ? t("storeCommerce.purchases.submitMany", { count: fmt.number(lines.length) })
                : t("storeCommerce.purchases.submitOne")}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          {t("storeCommerce.purchaseDetail.lookupTitle")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">{t("storeCommerce.purchaseDetail.lookupHint")}</p>

        <div className="mt-4 flex gap-3">
          <input
            value={returnInput}
            onChange={(e) => setReturnInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                lookupReturn(returnInput);
              }
            }}
            placeholder={t("storeCommerce.purchaseDetail.supplyPlaceholder")}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="button"
            onClick={() => lookupReturn(returnInput)}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
          >
            {t("storeCommerce.purchaseDetail.loadPurchase")}
          </button>
        </div>

        {returnError ? <p className="mt-3 text-sm text-red-600">{returnError}</p> : null}
        {returnSuccess ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{returnSuccess}</p>
        ) : null}

        {returnPurchase ? (
          <form onSubmit={submitReturn} className="mt-6 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="font-semibold text-slate-950">
                  {t("storeCommerce.purchaseDetail.label", { id: fmt.number(returnPurchase.id) })}
                  {returnPurchase.reference ? ` · ${returnPurchase.reference}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {returnPurchase.supplier.name} · {fmt.dateTime(returnPurchase.purchasedAt)}
                </p>
              </div>
              <p className="font-semibold text-slate-950">{fmt.money(returnPurchase.totalCost)}</p>
            </div>

            {returnPurchase.items.map((item) => {
              const available = stockMap.get(`${item.warehouseId}:${item.productId}`) ?? 0;
              const qtyValue = Number(returnQty[item.id] ?? "0");
              const overStock = qtyValue > 0 && qtyValue > available;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-950">{item.product.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.product.sku} · {item.warehouse.name} ·{" "}
                      {t("storeCommerce.purchases.qty")}{" "}
                      <span className="tabular-nums">{fmt.quantity(item.quantity)}</span>
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
                      value={returnQty[item.id] ?? "0"}
                      onChange={(e) => setReturnQtyFor(item.id, e.target.value)}
                      className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-slate-900"
                    />
                  </label>
                </div>
              );
            })}

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.purchaseDetail.reasonOptional")}
              </span>
              <input
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={t("storeCommerce.purchaseDetail.reasonPlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
              />
            </label>

            <button
              type="submit"
              disabled={returnSubmitting || returnSelected.lines.length === 0}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {returnSubmitting
                ? t("common.loading")
                : returnSelected.count === 1
                  ? t("storeCommerce.purchaseDetail.submitOne", {
                      amount: fmt.number(returnSelected.credit, { decimals: 2 }),
                    })
                  : t("storeCommerce.purchaseDetail.submitMany", {
                      count: fmt.number(returnSelected.count),
                      amount: fmt.number(returnSelected.credit, { decimals: 2 }),
                    })}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

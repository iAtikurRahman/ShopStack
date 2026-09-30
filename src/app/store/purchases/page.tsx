"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Warehouse = { id: number; name: string };
type Product = { id: number; sku: string; name: string; purchasePrice: string };
type Supplier = { id: number; name: string };
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineTotal(item: PurchaseItem): string {
  return (item.quantity * Number(item.unitCost)).toFixed(2);
}

function subtotalOf(items: PurchaseItem[]): string {
  return items.reduce((sum, item) => sum + item.quantity * Number(item.unitCost), 0).toFixed(2);
}

export default function StorePurchasesPage() {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
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
        (purchase.reference ?? "").toLowerCase().includes(q) ||
        purchase.totalCost.includes(q) ||
        purchase.purchasedAt.slice(0, 10).includes(q)
      );
    });
  }, [purchases, search]);

  const formTotal = useMemo(
    () =>
      lines
        .reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0)
        .toFixed(2),
    [lines]
  );

  async function loadAll() {
    try {
      const [inventoryData, suppliersData, purchasesData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[]; products: Product[] }>("/api/store/inventory"),
        apiFetch<{ suppliers: Supplier[] }>("/api/store/suppliers"),
        apiFetch<{ purchases: Purchase[] }>("/api/store/purchases"),
      ]);
      setWarehouses(inventoryData.warehouses);
      setProducts(inventoryData.products);
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
                <div key={purchase.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-950">{purchase.supplier.name}</p>
                    <span className="text-slate-600">৳{purchase.totalCost}</span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {new Date(purchase.purchasedAt).toLocaleDateString()}
                    {purchase.warehouseId === null ? (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {t("storeCommerce.purchases.multipleWarehouses")}
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
                        <span className="text-right tabular-nums">{item.quantity}</span>
                        <span className="text-right tabular-nums">৳{item.unitCost}</span>
                        <span className="text-right tabular-nums">৳{lineTotal(item)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5 font-medium text-slate-950">
                      <span>{t("storeCommerce.purchases.subtotal")}</span>
                      <span className="tabular-nums">৳{subtotalOf(purchase.items)}</span>
                    </div>
                  </div>
                  {purchase.reference ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {t("storeCommerce.purchases.refLabel", { reference: purchase.reference })}
                    </p>
                  ) : null}
                </div>
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

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  {t("storeCommerce.purchases.itemsCount", { count: lines.length })}
                </span>
                <span className="text-sm font-semibold text-slate-950 tabular-nums">৳{formTotal}</span>
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
                {t("storeCommerce.purchases.addAnotherItem")}
              </button>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {lines.length > 1
                ? t("storeCommerce.purchases.submitMany", { count: lines.length })
                : t("storeCommerce.purchases.submitOne")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

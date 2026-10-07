"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import { normalizeUnit, unitLabel, unitOptionsFor } from "@/lib/units";

type Warehouse = { id: number; name: string; store: { id: number; name: string } };
type Product = { id: number; sku: string; name: string; unit: string | null };
type TransferItem = {
  id: number;
  productId: number;
  quantity: number;
  unit: string | null;
  stockQuantity: string;
};
type Transfer = {
  id: number;
  fromWarehouseId: number;
  toWarehouseId: number;
  status: string;
  createdAt: string;
  items: TransferItem[];
};

export default function CompanyTransfersPage() {
  const { t, tEnum, fmt, locale } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("1");

  function warehouseLabel(id: number) {
    const w = warehouses.find((wh) => wh.id === id);
    return w ? `${w.name} (${w.store.name})` : t("company.transfers.warehouseFallback", { id: fmt.number(id) });
  }

  function productLabel(id: number) {
    const p = products.find((prod) => prod.id === id);
    return p ? `${p.sku} — ${p.name}` : t("company.transfers.productFallback", { id: fmt.number(id) });
  }

  async function loadAll() {
    try {
      const [warehousesData, productsData, transfersData] = await Promise.all([
        apiFetch<{ warehouses: Warehouse[] }>("/api/company/warehouses"),
        apiFetch<{ products: Product[] }>("/api/company/products"),
        apiFetch<{ transfers: Transfer[] }>("/api/company/transfers"),
      ]);
      setWarehouses(warehousesData.warehouses);
      setProducts(productsData.products);
      setTransfers(transfersData.transfers);
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

  const selectedProduct = products.find((p) => p.id === Number(productId));
  const selectedUnit = unit || normalizeUnit(selectedProduct?.unit);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/transfers", "POST", {
        fromWarehouseId: Number(fromWarehouseId),
        toWarehouseId: Number(toWarehouseId),
        items: [{ productId: Number(productId), quantity: Number(quantity), unit: selectedUnit }],
      });
      setProductId("");
      setUnit("");
      setQuantity("1");
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("company.transfers.title")}</h1>
      <p className="text-sm text-slate-600">{t("company.transfers.helper")}</p>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.transfers.recent")}</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : transfers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">{t("company.transfers.noneYet")}</p>
          ) : (
            <div className="mt-6 space-y-3">
              {transfers.map((transfer) => (
                <div key={transfer.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-950">
                      {warehouseLabel(transfer.fromWarehouseId)} → {warehouseLabel(transfer.toWarehouseId)}
                    </p>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      {tEnum(transfer.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {transfer.items
                      .map(
                        (item) =>
                          `${productLabel(item.productId)} × ${fmt.quantity(item.quantity)} ${unitLabel(
                            item.unit ?? products.find((p) => p.id === item.productId)?.unit,
                            locale
                          )}`
                      )
                      .join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.transfers.newTitle")}</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.transfers.fromLabel")}</span>
              <select
                required
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("company.transfers.selectSource")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.store.name})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.transfers.toLabel")}</span>
              <select
                required
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("company.transfers.selectDestination")}</option>
                {warehouses
                  .filter((w) => String(w.id) !== fromWarehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.store.name})
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.transfers.product")}</span>
              <select
                required
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setUnit("");
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("company.transfers.selectProduct")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.products.unit")}
              </span>
              <select
                value={selectedUnit}
                onChange={(e) => setUnit(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {unitOptionsFor(selectedProduct?.unit).map((u) => (
                  <option key={u.code} value={u.code}>
                    {unitLabel(u.code, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.quantity")}</span>
              <input
                required
                type="number"
                min={0.01}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("company.transfers.submit")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

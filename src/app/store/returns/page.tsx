"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import { computeRefundAmount, round2 } from "@/lib/returns";

type SaleItem = {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
};
type ReturnItem = { saleItemId: number; quantity: number };
type Sale = {
  id: number;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  items: SaleItem[];
  returns: { items: ReturnItem[] }[];
};
type ReturnRecord = {
  id: number;
  saleId: number;
  reason: string | null;
  refundAmount: string;
  createdAt: string;
  items: { saleItemId: number; quantity: number }[];
  sale: {
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    items: { id: number; quantity: number; unitPrice: string; discountAmount: string; lineTotal: string }[];
  };
};

function ReturnsForm() {
  const { t, tEnum } = useI18n();
  const searchParams = useSearchParams();
  const [saleIdInput, setSaleIdInput] = useState(searchParams.get("saleId") ?? "");
  const [sale, setSale] = useState<Sale | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [refundAmount, setRefundAmount] = useState("");
  const [refundTouched, setRefundTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [loadingReturns, setLoadingReturns] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  function startEdit(r: ReturnRecord) {
    setEditingId(r.id);
    setEditAmount(r.refundAmount);
    setEditReason(r.reason ?? "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(r: ReturnRecord) {
    setSavingId(r.id);
    setEditError(null);
    try {
      await apiFetch(`/api/store/returns/${r.id}`, "PATCH", {
        refundAmount: Number(editAmount),
        reason: editReason.trim() || null,
      });
      setEditingId(null);
      await loadReturns();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function loadReturns() {
    setLoadingReturns(true);
    setReturnsError(null);
    try {
      const data = await apiFetch<{ returns: ReturnRecord[] }>("/api/store/returns");
      setReturns(data.returns);
    } catch (err) {
      setReturnsError((err as Error).message);
    } finally {
      setLoadingReturns(false);
    }
  }

  async function loadSale(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiFetch<{ sale: Sale }>(`/api/store/sales/${id}`);
      setSale(data.sale);
      setQuantities({});
      setRefundTouched(false);
    } catch (err) {
      setError((err as Error).message);
      setSale(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (saleIdInput) await loadSale(saleIdInput);
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

  function remainingFor(item: SaleItem) {
    const returned = (sale?.returns ?? [])
      .flatMap((r) => r.items)
      .filter((ri) => ri.saleItemId === item.id)
      .reduce((sum, ri) => sum + ri.quantity, 0);
    return item.quantity - returned;
  }

  const selectedItems = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([saleItemId, quantity]) => ({ saleItemId: Number(saleItemId), quantity }));

  // Live preview of what the server would store, using the exact same helper,
  // so the figure never disagrees with what actually gets saved.
  const suggestedRefund = sale ? computeRefundAmount(sale, selectedItems) : 0;
  const displayedRefund = refundTouched ? refundAmount : suggestedRefund.toFixed(2);
  const lineDiscountTotal = sale ? sale.items.reduce((sum, i) => sum + Number(i.discountAmount), 0) : 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sale) return;
    setError(null);
    setSuccess(null);

    if (selectedItems.length === 0) {
      setError(t("storeCommerce.returns.errNoItems"));
      return;
    }

    const finalAmount = round2(Number(displayedRefund));
    if (!Number.isFinite(finalAmount) || finalAmount < 0) {
      setError(t("storeCommerce.returns.errInvalidAmount"));
      return;
    }
    const saleTotal = Number(sale.totalAmount);
    if (finalAmount > saleTotal) {
      setError(t("storeCommerce.returns.errExceedsTotal", { total: saleTotal.toFixed(2) }));
      return;
    }

    try {
      await apiFetch("/api/store/returns", "POST", {
        saleId: sale.id,
        items: selectedItems,
        reason,
        refundAmount: finalAmount,
      });
      setSuccess(t("storeCommerce.returns.successProcessed", { amount: finalAmount.toFixed(2) }));
      await loadSale(String(sale.id));
      await loadReturns();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const query = search.trim().toLowerCase();
  const filteredReturns = query
    ? returns.filter(
        (r) =>
          String(r.id).includes(query) ||
          String(r.saleId).includes(query) ||
          (r.reason ?? "").toLowerCase().includes(query)
      )
    : returns;
  const totalRefunded = filteredReturns.reduce((sum, r) => sum + Number(r.refundAmount), 0);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.returns")}</h1>

      <h2 className="text-lg font-semibold text-slate-950">
        {t("storeCommerce.returns.processTitle")}
      </h2>

      <div className="flex gap-3">
        <input
          value={saleIdInput}
          onChange={(e) => setSaleIdInput(e.target.value)}
          placeholder={t("storeCommerce.returns.saleIdPlaceholder")}
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
        />
        <button
          type="button"
          onClick={() => loadSale(saleIdInput)}
          className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
        >
          {t("storeCommerce.returns.loadSale")}
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-600">{t("common.loading")}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      {sale ? (
        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-950">
              {t("storeCommerce.returns.saleLabel", { id: sale.id })}
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{tEnum(sale.status)}</span>
          </div>

          <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>{t("storeCommerce.returns.subtotal")}</span>
              <span>৳{sale.subtotal}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("storeCommerce.returns.lineDiscounts")}</span>
              <span>-৳{lineDiscountTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("storeCommerce.returns.orderDiscount")}</span>
              <span>-৳{Number(sale.discountAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("storeCommerce.returns.tax")}</span>
              <span>৳{Number(sale.taxAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-950">
              <span>{t("storeCommerce.returns.totalPaid")}</span>
              <span>৳{Number(sale.totalAmount).toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {sale.items.map((item) => {
              const remaining = remainingFor(item);
              return (
                <div key={item.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-950">
                      {t("storeCommerce.returns.productLabel", { id: item.productId })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t("storeCommerce.returns.itemMeta", {
                        price: item.unitPrice,
                        qty: item.quantity,
                        remaining,
                      })}
                    </p>
                    {Number(item.discountAmount) > 0 ? (
                      <p className="text-xs text-amber-700">
                        {t("storeCommerce.returns.lineDiscountNote", {
                          discount: Number(item.discountAmount).toFixed(2),
                          total: Number(item.lineTotal).toFixed(2),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={remaining}
                    disabled={remaining <= 0}
                    value={quantities[item.id] ?? 0}
                    onChange={(e) =>
                      setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))
                    }
                    className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-center outline-none focus:border-slate-900 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 p-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.returns.refundAmount")}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={displayedRefund}
                onChange={(e) => {
                  setRefundAmount(e.target.value);
                  setRefundTouched(true);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              {refundTouched
                ? t("storeCommerce.returns.refundHintTouched")
                : t("storeCommerce.returns.refundHintCalculated")}
            </p>
            {refundTouched && displayedRefund !== suggestedRefund.toFixed(2) ? (
              <button
                type="button"
                onClick={() => {
                  setRefundTouched(false);
                  setRefundAmount("");
                }}
                className="mt-2 text-xs font-semibold text-slate-600 underline hover:text-slate-900"
              >
                {t("storeCommerce.returns.resetToCalculated", { amount: suggestedRefund.toFixed(2) })}
              </button>
            ) : null}
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
              {t("storeCommerce.returns.reasonOptional")}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
            />
          </label>

          <button
            type="submit"
            className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {t("storeCommerce.returns.submit", { amount: displayedRefund || "0.00" })}
          </button>
        </form>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.returns.refundedReturns")}
          </h2>
          {filteredReturns.length > 0 ? (
            <p className="text-sm text-slate-500">
              {filteredReturns.length === 1
                ? t("storeCommerce.returns.summaryOne", { total: totalRefunded.toFixed(2) })
                : t("storeCommerce.returns.summaryMany", {
                    count: filteredReturns.length,
                    total: totalRefunded.toFixed(2),
                  })}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("storeCommerce.returns.searchPlaceholder")}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              {t("common.clear")}
            </button>
          ) : null}
        </div>

        {returnsError ? <p className="mt-3 text-sm text-red-600">{returnsError}</p> : null}

        {loadingReturns ? (
          <p className="mt-3 text-sm text-slate-600">{t("common.loading")}</p>
        ) : returns.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">{t("storeCommerce.returns.noneYet")}</p>
        ) : filteredReturns.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">{t("storeCommerce.returns.noMatch")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredReturns.map((r) => {
              const units = r.items.reduce((sum, i) => sum + i.quantity, 0);

              return (
                <div key={r.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {t("storeCommerce.returns.returnLabel", { id: r.id })} ·{" "}
                        <Link href={`/store/sales/${r.saleId}`} className="font-normal text-slate-500 hover:underline">
                          {t("storeCommerce.returns.saleLabel", { id: r.saleId })}
                        </Link>
                      </p>
                      <p className="text-xs text-slate-500">
                        {units === 1
                          ? t("storeCommerce.returns.restockedOne")
                          : t("storeCommerce.returns.restockedMany", { count: units })}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-red-600">-৳{r.refundAmount}</p>
                      <p className="text-xs text-slate-500">{t("storeCommerce.returns.refundedLabel")}</p>
                    </div>
                  </div>

                  {editingId === r.id ? (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      {editError ? <p className="mb-2 text-sm text-red-600">{editError}</p> : null}
                      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-end">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-700">
                            {t("storeCommerce.returns.refundAmount")}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-700">{t("common.reason")}</span>
                          <input
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {t("storeCommerce.returns.editNote", { total: r.sale.totalAmount })}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveEdit(r)}
                          disabled={savingId === r.id}
                          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                        >
                          {savingId === r.id ? t("common.saving") : t("storeCommerce.returns.saveRefund")}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="mt-3 rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
                    >
                      {t("storeCommerce.returns.editRefund")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export default function StoreReturnsPage() {
  const { t } = useI18n();

  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl p-8 text-sm text-slate-600">{t("common.loading")}</main>
      }
    >
      <ReturnsForm />
    </Suspense>
  );
}

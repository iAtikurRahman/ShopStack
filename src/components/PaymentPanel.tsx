"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type PartyType = "customer" | "supplier";
type TransactionType = "receive" | "payment";
type PaymentType = "bank" | "cash" | "mobile" | "other";

type Party = { id: number; name: string; dueAmount: number };
type Payment = {
  id: number;
  transactionId: string;
  transactionType: TransactionType;
  paymentType: PaymentType;
  type: PartyType;
  customerSupplierId: number;
  paymentDate: string;
  paymentAmount: number;
  description: string | null;
  isActive: boolean;
  partyName: string;
  partyDueAmount: number;
};

type PaymentsResponse = {
  payments: Payment[];
  customers: Party[];
  suppliers: Party[];
};

/**
 * Mirrors the server's rule (see DUE_DIRECTION in src/lib/payments.ts) so the
 * form can preview the resulting balance before the payment is booked:
 * receive-from-customer and pay-supplier both settle a due; the two refund
 * combinations add to it. A decrease never goes below zero, so overpaying
 * parks the balance at 0.
 */
function previewDue(due: number, transactionType: TransactionType, type: PartyType, amount: number): number {
  const settles = (transactionType === "receive" && type === "customer") || (transactionType === "payment" && type === "supplier");
  return Math.max(0, Math.round((due + (settles ? -amount : amount)) * 100) / 100);
}

function todayInputValue(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return ymd;
}

export function PaymentPanel({ scope }: { scope: "company" | "store" }) {
  const { t, fmt } = useI18n();
  const base = scope === "company" ? "/api/company/payments" : "/api/store/payments";

  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PartyType | "">("");
  const [movementFilter, setMovementFilter] = useState<TransactionType | "">("");
  const [includeVoided, setIncludeVoided] = useState(false);

  // Form
  const [transactionType, setTransactionType] = useState<TransactionType>("receive");
  const [partyType, setPartyType] = useState<PartyType>("customer");
  const [partyChoice, setPartyChoice] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentType>("cash");
  const [paymentDate, setPaymentDate] = useState(todayInputValue);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const request = useCallback(async () => {
    const query = new URLSearchParams();
    if (typeFilter) query.set("type", typeFilter);
    if (movementFilter) query.set("transactionType", movementFilter);
    if (search.trim()) query.set("search", search.trim());
    if (includeVoided) query.set("includeVoided", "true");
    return apiFetch<PaymentsResponse>(`${base}?${query.toString()}`);
  }, [base, typeFilter, movementFilter, search, includeVoided]);

  const applyData = useCallback((data: PaymentsResponse) => {
    setPayments(data.payments);
    setCustomers(data.customers);
    setSuppliers(data.suppliers);
  }, []);

  const load = useCallback(async () => {
    try {
      applyData(await request());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [request, applyData]);

  // The effect deliberately settles through the promise chain rather than
  // calling load() directly, so no state update happens synchronously inside
  // the effect body. The cancel flag drops a response that arrived after the
  // filters changed.
  useEffect(() => {
    let active = true;
    request()
      .then((data) => {
        if (active) applyData(data);
      })
      .catch((err: unknown) => {
        if (active) setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, applyData]);

  const partyOptions = partyType === "customer" ? customers : suppliers;

  // Parties that still owe something come first - they are why you open this
  // screen - and an untouched form pre-selects the largest outstanding.
  const sortedParties = useMemo(() => {
    return [...partyOptions].sort((a, b) => {
      const dueDiff = b.dueAmount - a.dueAmount;
      if (dueDiff !== 0) return dueDiff;
      return a.name.localeCompare(b.name);
    });
  }, [partyOptions]);

  // `partyChoice` only records what the operator actually picked. The id the
  // form really submits is derived, so switching party type (or a party
  // disappearing) falls back to the largest outstanding without an effect
  // having to rewrite the state.
  const partyId = useMemo(() => {
    if (partyChoice && sortedParties.some((p) => String(p.id) === partyChoice)) return partyChoice;
    const owing = sortedParties.find((p) => p.dueAmount > 0);
    return String((owing ?? sortedParties[0])?.id ?? "");
  }, [partyChoice, sortedParties]);

  const selectedParty = partyOptions.find((p) => String(p.id) === partyId) ?? null;
  const amountValue = Number(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const projectedDue =
    selectedParty && amountValid
      ? previewDue(selectedParty.dueAmount, transactionType, partyType, amountValue)
      : selectedParty?.dueAmount ?? 0;

  function resetForm() {
    setAmount("");
    setReference("");
    setDescription("");
    setPaymentDate(todayInputValue());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const result = await apiFetch<{ dueAmount: number; settled: boolean }>(base, "POST", {
        transactionType,
        paymentType: method,
        type: partyType,
        customerSupplierId: Number(partyId),
        paymentDate,
        paymentAmount: amountValue,
        transactionId: reference.trim() || undefined,
        description: description.trim() || undefined,
      });
      resetForm();
      await load();
      setSuccess(
        result.settled
          ? t("common.payments.settledMessage", { amount: fmt.money(amountValue), party: selectedParty?.name ?? "" })
          : t("common.payments.recordedMessage", { amount: fmt.money(amountValue), party: selectedParty?.name ?? "" })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid(payment: Payment) {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`${base}/${payment.id}/void`, "POST", {});
      await load();
      setSuccess(t("common.payments.voidedMessage", { ref: payment.transactionId }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const totals = useMemo(() => {
    let received = 0;
    let paid = 0;
    for (const p of payments) {
      if (p.transactionType === "receive") received += p.paymentAmount;
      else paid += p.paymentAmount;
    }
    return { received, paid, net: received - paid };
  }, [payments]);

  const inputClass =
    "mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900";
  const secondaryButton =
    "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white";

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        {/* ---------------------------------------------------------------- */}
        {/* History                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-950">{t("common.payments.historyTitle")}</h2>
            <p className="text-xs text-slate-500">
              {t("common.payments.netLabel", { amount: fmt.money(totals.net) })}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.payments.searchPlaceholder")}
              className="min-w-[12rem] flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />
            <div className="flex items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
              {([["", "common.all"], ["customer", "common.payments.customer"], ["supplier", "common.payments.supplier"]] as const).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTypeFilter(value)}
                    aria-pressed={typeFilter === value}
                    className={`rounded-xl px-3 py-1.5 text-xs transition ${
                      typeFilter === value ? "bg-slate-950 font-semibold text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                  >
                    {t(label)}
                  </button>
                )
              )}
            </div>
            <div className="flex items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
              {([["", "common.all"], ["receive", "common.payments.receive"], ["payment", "common.payments.payOut"]] as const).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMovementFilter(value)}
                    aria-pressed={movementFilter === value}
                    className={`rounded-xl px-3 py-1.5 text-xs transition ${
                      movementFilter === value ? "bg-slate-950 font-semibold text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                  >
                    {t(label)}
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              onClick={() => setIncludeVoided((current) => !current)}
              aria-pressed={includeVoided}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                includeVoided ? "bg-slate-950 text-white" : "border border-slate-300 text-slate-900 hover:bg-white"
              }`}
            >
              {t("common.payments.includeVoided")}
            </button>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : payments.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim() || typeFilter || movementFilter
                ? t("common.payments.noMatch")
                : t("common.payments.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className={`rounded-2xl border p-4 ${
                    payment.isActive ? "border-slate-100 bg-slate-50" : "border-slate-100 bg-white opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{payment.partyName}</p>
                      <p className="text-xs text-slate-500">
                        {payment.transactionId} · {fmt.date(payment.paymentDate)}
                        {payment.isActive ? "" : ` · ${t("common.payments.voided")}`}
                      </p>
                      {payment.description ? (
                        <p className="mt-1 text-xs text-slate-600">{payment.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`font-semibold ${
                          payment.transactionType === "receive" ? "text-emerald-700" : "text-slate-900"
                        }`}
                      >
                        {payment.transactionType === "receive" ? "+" : "−"}
                        {fmt.money(payment.paymentAmount)}
                      </span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {t(`common.payments.methods.${payment.paymentType}` as const)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          payment.transactionType === "receive"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {t(payment.transactionType === "receive" ? "common.payments.receive" : "common.payments.payOut")}
                      </span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {t(payment.type === "customer" ? "common.payments.customer" : "common.payments.supplier")}
                      </span>
                      {payment.partyDueAmount > 0 ? (
                        <span className="text-xs font-semibold text-amber-700">
                          {t("common.payments.stillDue", { amount: fmt.money(payment.partyDueAmount) })}
                        </span>
                      ) : null}
                    </div>
                    {payment.isActive ? (
                      <button type="button" onClick={() => handleVoid(payment)} className={secondaryButton}>
                        {t("common.payments.void")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Record a payment                                                 */}
        {/* ---------------------------------------------------------------- */}
        <div className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("common.payments.addTitle")}</h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <span className="text-sm font-medium text-slate-700">{t("common.payments.movementLabel")}</span>
              <div className="mt-2 flex items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
                {(["receive", "payment"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTransactionType(value)}
                    aria-pressed={transactionType === value}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs transition ${
                      transactionType === value
                        ? "bg-slate-950 font-semibold text-white"
                        : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                  >
                    {t(value === "receive" ? "common.payments.receive" : "common.payments.payOut")}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-slate-700">{t("common.payments.partyLabel")}</span>
              <div className="mt-2 flex items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
                {(["customer", "supplier"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPartyType(value)}
                    aria-pressed={partyType === value}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs transition ${
                      partyType === value
                        ? "bg-slate-950 font-semibold text-white"
                        : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                  >
                    {t(value === "customer" ? "common.payments.customer" : "common.payments.supplier")}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.payments.partyLabel")}</span>
              <select
                required
                value={partyId}
                onChange={(e) => setPartyChoice(e.target.value)}
                className={inputClass}
              >
                {sortedParties.length === 0 ? (
                  <option value="">{t("common.payments.noParties")}</option>
                ) : (
                  sortedParties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                      {party.dueAmount > 0
                        ? ` — ${t("common.payments.dueSuffix", { amount: fmt.money(party.dueAmount) })}`
                        : ""}
                    </option>
                  ))
                )}
              </select>
              {selectedParty ? (
                <span className="mt-1 block text-xs text-slate-500">
                  {projectedDue > 0
                    ? t("common.payments.balanceAfter", { amount: fmt.money(projectedDue) })
                    : t("common.payments.balanceCleared")}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.amount")}</span>
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-slate-500">{t("common.payments.amountHint")}</span>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.payments.methodLabel")}</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentType)} className={inputClass}>
                <option value="cash">{t("common.payments.methods.cash")}</option>
                <option value="bank">{t("common.payments.methods.bank")}</option>
                <option value="mobile">{t("common.payments.methods.mobile")}</option>
                <option value="other">{t("common.payments.methods.other")}</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.payments.dateLabel")}</span>
              <input
                type="date"
                value={paymentDate}
                max={todayInputValue()}
                onChange={(e) => setPaymentDate(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("common.payments.referenceLabel")}{" "}
                <span className="text-xs font-normal text-slate-500">
                  ({t("common.payments.autoHint")})
                </span>
              </span>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("common.payments.referencePlaceholder")}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("common.reason")} <span className="text-xs font-normal text-slate-500">({t("common.optional")})</span>
              </span>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
            </label>

            <button
              type="submit"
              disabled={saving || !amountValid || !selectedParty}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? t("common.saving") : t("common.payments.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

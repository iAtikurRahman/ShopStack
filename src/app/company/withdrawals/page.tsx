"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useBanks } from "@/hooks/useBanks";
import { apiFetch } from "@/services/api";

type Withdrawal = {
  id: number;
  bankId: number;
  bankName: string;
  withdrawalDate: string;
  personName: string;
  accountOrMobile: string | null;
  amount: number;
  reason: string | null;
  isActive: boolean;
  createdAt: string;
};

/** The editable copy of one slip, kept as strings for the inputs. */
type Draft = {
  bankId: string;
  withdrawalDate: string;
  personName: string;
  accountOrMobile: string;
  amount: string;
  reason: string;
};

function todayInput(): string {
  // The date input wants yyyy-mm-dd, not an ISO timestamp with a time on it.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function draftOf(w: Withdrawal): Draft {
  return {
    bankId: String(w.bankId),
    // Same reason as todayInput: the stored value is a full ISO timestamp.
    withdrawalDate: w.withdrawalDate.slice(0, 10),
    personName: w.personName,
    accountOrMobile: w.accountOrMobile ?? "",
    amount: String(w.amount),
    reason: w.reason ?? "",
  };
}

export default function CompanyWithdrawalsPage() {
  const { t, tEnum, fmt } = useI18n();
  const { banks } = useBanks();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [bankId, setBankId] = useState("");
  const [withdrawalDate, setWithdrawalDate] = useState(todayInput);
  const [personName, setPersonName] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // Only one slip is ever open for editing, and editingId is matched against the
  // freshly loaded list - so a slip that drops out of the current search takes
  // its form with it instead of stranding state nobody can see.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [voidingId, setVoidingId] = useState<number | null>(null);

  // The freshest balance this screen knows for each account, keyed by id. Only
  // the figures a mutation has just returned live here; anything else falls back
  // to the Banks hook. Without it the "balance after" preview would keep showing
  // a figure the server has already moved on from, until a reload.
  const [balanceOverrides, setBalanceOverrides] = useState<Record<number, number>>({});

  async function load() {
    try {
      const data = await apiFetch<{ withdrawals: Withdrawal[] }>("/api/company/withdrawals");
      setWithdrawals(data.withdrawals);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Wrapped so the fetch - not the state write - is what the effect does.
    async function fetchOnMount() {
      await load();
    }
    fetchOnMount();
  }, []);

  const bankById = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  const balanceOf = (id: number): number | undefined => balanceOverrides[id] ?? bankById.get(id)?.remainingBalance;

  // The first account is preselected by derivation rather than by an effect
  // writing to state: bankId stays "" until the user actually picks one, so an
  // account dropping out of the list falls back to the first instead of pinning
  // a stale id.
  const activeBankId = bankId || (banks[0] ? String(banks[0].id) : "");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withdrawals;
    return withdrawals.filter(
      (w) =>
        w.personName.toLowerCase().includes(q) ||
        w.bankName.toLowerCase().includes(q) ||
        (w.reason ?? "").toLowerCase().includes(q) ||
        (w.accountOrMobile ?? "").toLowerCase().includes(q)
    );
  }, [withdrawals, search]);

  const totalActive = useMemo(
    () => withdrawals.filter((w) => w.isActive).reduce((sum, w) => sum + w.amount, 0),
    [withdrawals]
  );

  const selectedBank = bankById.get(Number(activeBankId));
  const selectedBalance = selectedBank ? balanceOf(selectedBank.id) : undefined;
  const canSubmit =
    activeBankId !== "" &&
    personName.trim() !== "" &&
    amount.trim() !== "" &&
    Number(amount) > 0 &&
    !saving;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const name = personName.trim();
    const paid = Number(amount);
    try {
      const result = await apiFetch<{ withdrawal: Withdrawal; bankBalance: number }>(
        "/api/company/withdrawals",
        "POST",
        {
          bankId: Number(activeBankId),
          withdrawalDate,
          personName: name,
          amount: paid,
          reason: reason.trim() || undefined,
        }
      );
      setPersonName("");
      setAmount("");
      setReason("");
      setBalanceOverrides((current) => ({ ...current, [result.withdrawal.bankId]: result.bankBalance }));
      await load();
      setSuccess(t("company.withdrawals.createdMessage", { amount: fmt.money(paid), name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(w: Withdrawal) {
    setError(null);
    setEditingId(w.id);
    setDraft(draftOf(w));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveEdit(w: Withdrawal) {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    setSavingId(w.id);
    try {
      const result = await apiFetch<{ withdrawal: Withdrawal; bankBalance: number }>(
        `/api/company/withdrawals/${w.id}`,
        "PATCH",
        {
          bankId: Number(draft.bankId),
          withdrawalDate: draft.withdrawalDate,
          personName: draft.personName,
          accountOrMobile: draft.accountOrMobile.trim() || undefined,
          amount: Number(draft.amount),
          reason: draft.reason.trim() || undefined,
        }
      );
      setEditingId(null);
      setDraft(null);
      setBalanceOverrides((current) => ({ ...current, [result.withdrawal.bankId]: result.bankBalance }));
      await load();
      setSuccess(t("company.withdrawals.savedMessage"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleVoid(w: Withdrawal) {
    if (!window.confirm(t("company.withdrawals.deleteConfirm", { amount: fmt.money(w.amount) }))) return;
    setError(null);
    setSuccess(null);
    setVoidingId(w.id);
    try {
      const result = await apiFetch<{ withdrawal: Withdrawal; bankBalance: number }>(
        `/api/company/withdrawals/${w.id}`,
        "DELETE"
      );
      if (editingId === w.id) cancelEdit();
      setBalanceOverrides((current) => ({ ...current, [result.withdrawal.bankId]: result.bankBalance }));
      await load();
      setSuccess(t("company.withdrawals.deletedMessage", { amount: fmt.money(w.amount) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.withdrawals")}</h1>
        {withdrawals.length > 0 ? (
          <p className="text-sm text-slate-600">
            {t("company.withdrawals.totalLabel", { amount: fmt.money(totalActive) })}
          </p>
        ) : null}
      </div>
      <p className="-mt-4 text-sm text-slate-600">{t("company.withdrawals.helper")}</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.withdrawals.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.withdrawals.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.withdrawals.noMatch", { search: search.trim() })
                : t("company.withdrawals.noneYet")}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              <div className="overflow-x-auto">
                <div className="min-w-[33rem]">
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem] gap-2 pb-2 text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">
                    <span>{t("company.withdrawals.personName")}</span>
                    <span className="text-right">{t("company.withdrawals.withdrawalDate")}</span>
                    <span className="text-right">{t("company.withdrawals.amount")}</span>
                    <span />
                  </div>
                  {filtered.map((w) => {
                    const editing = editingId === w.id;
                    return (
                      <div key={w.id} className="py-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem] items-center gap-2 text-sm">
                          <div className="min-w-0">
                            <p
                              className={`truncate font-medium ${
                                w.isActive ? "text-slate-950" : "text-slate-500 line-through"
                              }`}
                            >
                              {w.personName}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {tEnum(w.bankName)}
                              {w.accountOrMobile ? ` · ${w.accountOrMobile}` : ""}
                              {w.reason ? ` · ${w.reason}` : ""}
                            </p>
                            {w.isActive ? null : (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {t("common.payments.voided")}
                              </span>
                            )}
                          </div>
                          <span className="text-right text-xs text-slate-600">{fmt.date(w.withdrawalDate)}</span>
                          <span
                            className={`text-right font-semibold tabular-nums ${
                              !w.isActive ? "text-slate-500 line-through" : "text-slate-950"
                            }`}
                          >
                            {fmt.money(w.amount)}
                          </span>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(w)}
                              disabled={!w.isActive}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleVoid(w)}
                              disabled={!w.isActive || voidingId === w.id}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                            >
                              {voidingId === w.id ? t("common.deleting") : t("common.delete")}
                            </button>
                          </div>
                        </div>

                        {editing && draft ? (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <h3 className="text-sm font-semibold text-slate-950">
                              {t("company.withdrawals.editTitle")}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">{t("company.withdrawals.editHelper")}</p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.bank")}
                                </span>
                                <select
                                  value={draft.bankId}
                                  onChange={(e) => patchDraft({ bankId: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                >
                                  {banks.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {tEnum(b.bankName)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.withdrawalDate")}
                                </span>
                                <input
                                  type="date"
                                  value={draft.withdrawalDate}
                                  max={todayInput()}
                                  onChange={(e) => patchDraft({ withdrawalDate: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.personName")}
                                </span>
                                <input
                                  value={draft.personName}
                                  onChange={(e) => patchDraft({ personName: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.accountOrMobile")}
                                </span>
                                <input
                                  value={draft.accountOrMobile}
                                  onChange={(e) => patchDraft({ accountOrMobile: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.amount")}
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.amount}
                                  onChange={(e) => patchDraft({ amount: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.withdrawals.reason")}
                                </span>
                                <input
                                  value={draft.reason}
                                  onChange={(e) => patchDraft({ reason: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveEdit(w)}
                                disabled={savingId === w.id}
                                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                              >
                                {savingId === w.id ? t("common.saving") : t("common.save")}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white"
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.withdrawals.addTitle")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("company.withdrawals.addHelper")}</p>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.withdrawals.bank")}</span>
              <select
                value={activeBankId}
                onChange={(e) => setBankId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {banks.length === 0 ? (
                  <option value="">{t("common.payments.noMethods")}</option>
                ) : (
                  banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {tEnum(b.bankName)}
                    </option>
                  ))
                )}
              </select>
            </label>

            {/* The balance that will be left behind once this is saved, so the
                owner sees the effect before committing to it. */}
            {selectedBank && selectedBalance !== undefined && Number(amount) > 0 ? (
              <p
                className={`rounded-2xl px-4 py-2.5 text-xs ${
                  selectedBalance - Number(amount) < 0
                    ? "bg-red-50 text-red-700"
                    : "bg-slate-50 text-slate-700"
                }`}
              >
                {t("company.withdrawals.balanceAfter", {
                  amount: fmt.money(selectedBalance - Number(amount)),
                })}
              </p>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.withdrawals.withdrawalDate")}
              </span>
              <input
                type="date"
                required
                value={withdrawalDate}
                max={todayInput()}
                onChange={(e) => setWithdrawalDate(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.withdrawals.personName")}
              </span>
              <input
                required
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder={t("company.withdrawals.personNamePlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.withdrawals.amount")}</span>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.withdrawals.reason")}</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("company.withdrawals.reasonPlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {saving ? t("common.saving") : t("company.withdrawals.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

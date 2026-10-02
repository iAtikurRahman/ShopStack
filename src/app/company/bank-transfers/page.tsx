"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useBanks, type BankOption } from "@/hooks/useBanks";
import { apiFetch } from "@/services/api";

type Transfer = {
  id: number;
  fromBankId: number;
  fromBankName: string;
  toBankId: number;
  toBankName: string;
  amount: number;
  remarks: string | null;
  isActive: boolean;
  createdAt: string;
};

type TransferResult = { transfer: Transfer; fromBalance: number; toBalance: number };

/** The editable copy of one transfer, kept as strings for the inputs. */
type Draft = { fromBankId: string; toBankId: string; amount: string; remarks: string };

function draftOf(transfer: Transfer): Draft {
  return {
    fromBankId: String(transfer.fromBankId),
    toBankId: String(transfer.toBankId),
    amount: String(transfer.amount),
    remarks: transfer.remarks ?? "",
  };
}

export default function CompanyBankTransfersPage() {
  const { t, tEnum, fmt } = useI18n();
  const { banks } = useBanks();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [fromBankId, setFromBankId] = useState("");
  const [toBankId, setToBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");

  // Only one transfer is ever open for editing, and editingId is matched against
  // the freshly loaded list - so a transfer that drops out of the current search
  // takes its form with it instead of stranding state nobody can see.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // The freshest balance this screen knows for each account, keyed by id. Only
  // the figures a mutation has just returned live here; anything else falls back
  // to the Banks hook. Without it the "balance after" preview would keep showing
  // a figure the server has already moved on from, until a reload.
  const [balanceOverrides, setBalanceOverrides] = useState<Record<number, number>>({});

  async function load() {
    try {
      const data = await apiFetch<{ transfers: Transfer[] }>("/api/company/bank-transfers");
      setTransfers(data.transfers);
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

  /**
   * The accounts the edit form offers.
   *
   * `useBanks` only returns active accounts, which is right for picking a new
   * destination but would quietly corrupt an edit: a transfer that named an
   * account before it was deactivated would come back with that half unset, and
   * saving it would move the money somewhere the owner never asked for. So the
   * two accounts the transfer already involves are added back in, inactive or
   * not, and marked so the choice is visible rather than silent.
   */
  function optionsForEdit(transfer: Transfer) {
    const extra: BankOption[] = [];
    for (const id of [transfer.fromBankId, transfer.toBankId]) {
      if (banks.some((b) => b.id === id)) continue;
      extra.push({
        id,
        bankName: id === transfer.fromBankId ? transfer.fromBankName : transfer.toBankName,
        initialBalance: 0,
        remainingBalance: 0,
        isActive: false,
      });
    }
    return [...banks, ...extra];
  }

  const balanceOf = (id: number): number | undefined => balanceOverrides[id] ?? bankById.get(id)?.remainingBalance;

  // Both sides default to the first two accounts by derivation rather than by an
  // effect writing to state: the ids stay "" until the owner actually picks one,
  // so an account leaving the list falls back instead of pinning a stale id.
  const activeFromId = fromBankId || (banks[0] ? String(banks[0].id) : "");
  const activeToId = toBankId || (banks[1] ? String(banks[1].id) : banks[0] ? String(banks[0].id) : "");

  // Transfers to and from the same account would net to nothing and would make
  // the statement show a movement that never left anywhere, so the form refuses
  // it up front. The server refuses it too.
  const sameAccount = activeFromId !== "" && activeFromId === activeToId;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transfers;
    const digits = q.replace(/\D/g, "");
    return transfers.filter((transfer) => {
      const haystack = [
        transfer.fromBankName,
        transfer.toBankName,
        transfer.remarks ?? "",
        String(transfer.amount),
        transfer.createdAt,
      ]
        .join(" ")
        .toLowerCase();
      return (
        haystack.includes(q) ||
        (digits.length > 0 && haystack.replace(/\D/g, "").includes(digits))
      );
    });
  }, [transfers, search]);

  // Voided transfers are left out of the total: the money is back where it was,
  // so counting it would overstate what has actually been moved.
  const totalActive = useMemo(
    () => transfers.filter((x) => x.isActive).reduce((sum, x) => sum + x.amount, 0),
    [transfers]
  );

  const selectedFrom = bankById.get(Number(activeFromId));
  const selectedTo = bankById.get(Number(activeToId));
  const fromBalance = selectedFrom ? balanceOf(selectedFrom.id) : undefined;
  const toBalance = selectedTo ? balanceOf(selectedTo.id) : undefined;
  const canSubmit =
    activeFromId !== "" &&
    activeToId !== "" &&
    !sameAccount &&
    amount.trim() !== "" &&
    Number(amount) > 0 &&
    !saving;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const moved = Number(amount);
    try {
      const result = await apiFetch<TransferResult>("/api/company/bank-transfers", "POST", {
        fromBankId: Number(activeFromId),
        toBankId: Number(activeToId),
        amount: moved,
        remarks: remarks.trim() || undefined,
      });
      setAmount("");
      setRemarks("");
      setBalanceOverrides((current) => ({
        ...current,
        [result.transfer.fromBankId]: result.fromBalance,
        [result.transfer.toBankId]: result.toBalance,
      }));
      await load();
      setSuccess(
        t("company.bankTransfers.createdMessage", {
          amount: fmt.money(moved),
          from: tEnum(result.transfer.fromBankName),
          to: tEnum(result.transfer.toBankName),
        })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(transfer: Transfer) {
    setError(null);
    setEditingId(transfer.id);
    setDraft(draftOf(transfer));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveEdit(transfer: Transfer) {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    setSavingId(transfer.id);
    try {
      const result = await apiFetch<TransferResult>(`/api/company/bank-transfers/${transfer.id}`, "PATCH", {
        fromBankId: Number(draft.fromBankId),
        toBankId: Number(draft.toBankId),
        amount: Number(draft.amount),
        remarks: draft.remarks.trim() || undefined,
      });
      setEditingId(null);
      setDraft(null);
      setBalanceOverrides((current) => ({
        ...current,
        [result.transfer.fromBankId]: result.fromBalance,
        [result.transfer.toBankId]: result.toBalance,
      }));
      await load();
      setSuccess(t("company.bankTransfers.savedMessage"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(transfer: Transfer) {
    if (
      !window.confirm(
        t("company.bankTransfers.deleteConfirm", {
          amount: fmt.money(transfer.amount),
          from: tEnum(transfer.fromBankName),
          to: tEnum(transfer.toBankName),
        })
      )
    )
      return;
    setError(null);
    setSuccess(null);
    setDeletingId(transfer.id);
    try {
      const result = await apiFetch<TransferResult>(`/api/company/bank-transfers/${transfer.id}`, "DELETE");
      if (editingId === transfer.id) cancelEdit();
      setBalanceOverrides((current) => ({
        ...current,
        [result.transfer.fromBankId]: result.fromBalance,
        [result.transfer.toBankId]: result.toBalance,
      }));
      await load();
      setSuccess(t("company.bankTransfers.deletedMessage", { amount: fmt.money(transfer.amount) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.bankTransfers")}</h1>
        {transfers.length > 0 ? (
          <p className="text-sm text-slate-600">
            {t("company.bankTransfers.totalLabel", { amount: fmt.money(totalActive) })}
          </p>
        ) : null}
      </div>
      <p className="-mt-4 text-sm text-slate-600">{t("company.bankTransfers.helper")}</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.bankTransfers.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.bankTransfers.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.bankTransfers.noMatch", { search: search.trim() })
                : t("company.bankTransfers.noneYet")}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              <div className="overflow-x-auto">
                <div className="min-w-[34rem]">
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] gap-2 pb-2 text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">
                    <span>{t("company.bankTransfers.route")}</span>
                    <span className="text-right">{t("company.bankTransfers.date")}</span>
                    <span className="text-right">{t("company.bankTransfers.amount")}</span>
                  </div>
                  {filtered.map((transfer) => {
                    const editing = editingId === transfer.id;
                    return (
                      <div key={transfer.id} className="py-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] items-center gap-2 text-sm">
                          <div className="min-w-0">
                            <p
                              className={`truncate font-medium ${
                                transfer.isActive ? "text-slate-950" : "text-slate-500 line-through"
                              }`}
                            >
                              {/* The two account names joined by an arrow, so the
                                  direction of the movement is readable without a
                                  separate column for it. */}
                              {tEnum(transfer.fromBankName)}
                              <span className="px-1.5 text-slate-400">→</span>
                              {tEnum(transfer.toBankName)}
                            </p>
                            {transfer.remarks ? (
                              <p className="truncate text-xs text-slate-500">{transfer.remarks}</p>
                            ) : null}
                            {transfer.isActive ? null : (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {t("common.payments.voided")}
                              </span>
                            )}
                            {/* A link straight to the statement of the account the
                                money left - the fastest way to confirm the movement
                                landed where it was supposed to. */}
                            <Link
                              href={`/company/banks/${transfer.fromBankId}`}
                              className="mt-0.5 inline-block text-[11px] font-medium text-slate-600 underline hover:text-slate-900"
                            >
                              {t("company.bankTransfers.viewStatement", {
                                name: tEnum(transfer.fromBankName),
                              })}
                            </Link>
                          </div>
                          <span className="text-right text-xs text-slate-600">
                            {fmt.dateTime(transfer.createdAt)}
                          </span>
                          <div className="text-right">
                            <p
                              className={`font-semibold tabular-nums ${
                                !transfer.isActive ? "text-slate-500 line-through" : "text-slate-950"
                              }`}
                            >
                              {fmt.money(transfer.amount)}
                            </p>
                            <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(transfer)}
                                disabled={!transfer.isActive}
                                className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                              >
                                {t("common.edit")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(transfer)}
                                disabled={!transfer.isActive || deletingId === transfer.id}
                                className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                              >
                                {deletingId === transfer.id ? t("common.deleting") : t("common.delete")}
                              </button>
                            </div>
                          </div>
                        </div>

                        {editing && draft ? (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <h3 className="text-sm font-semibold text-slate-950">
                              {t("company.bankTransfers.editTitle")}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">{t("company.bankTransfers.editHelper")}</p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.bankTransfers.from")}
                                </span>
                                <select
                                  value={draft.fromBankId}
                                  onChange={(e) => patchDraft({ fromBankId: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                >
                                  {optionsForEdit(transfer).map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {tEnum(b.bankName)}
                                      {b.isActive ? "" : ` (${t("company.bankTransfers.inactive")})`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.bankTransfers.to")}
                                </span>
                                <select
                                  value={draft.toBankId}
                                  onChange={(e) => patchDraft({ toBankId: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                >
                                  {optionsForEdit(transfer).map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {tEnum(b.bankName)}
                                      {b.isActive ? "" : ` (${t("company.bankTransfers.inactive")})`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.bankTransfers.amount")}
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
                                  {t("company.bankTransfers.remarks")}
                                </span>
                                <input
                                  value={draft.remarks}
                                  onChange={(e) => patchDraft({ remarks: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                            </div>
                            {draft.fromBankId === draft.toBankId && draft.fromBankId !== "" ? (
                              <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-xs text-red-700">
                                {t("company.bankTransfers.sameAccount")}
                              </p>
                            ) : null}
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveEdit(transfer)}
                                disabled={savingId === transfer.id}
                                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                              >
                                {savingId === transfer.id ? t("common.saving") : t("common.save")}
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
          <h2 className="text-lg font-semibold text-slate-950">{t("company.bankTransfers.addTitle")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("company.bankTransfers.addHelper")}</p>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.bankTransfers.from")}</span>
              <select
                value={activeFromId}
                onChange={(e) => setFromBankId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {banks.length === 0 ? (
                  <option value="">{t("common.payments.noMethods")}</option>
                ) : (
                  banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {tEnum(b.bankName)} — {fmt.money(balanceOf(b.id) ?? 0)}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.bankTransfers.to")}</span>
              <select
                value={activeToId}
                onChange={(e) => setToBankId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                {banks.length === 0 ? (
                  <option value="">{t("common.payments.noMethods")}</option>
                ) : (
                  banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {tEnum(b.bankName)} — {fmt.money(balanceOf(b.id) ?? 0)}
                    </option>
                  ))
                )}
              </select>
            </label>

            {/* Both balances that will be left behind once this is saved, so the
                owner sees the effect on each side before committing to it. The
                from-account going negative is called out because an account can
                legitimately be overdrawn - it just should not be a surprise. */}
            {Number(amount) > 0 && fromBalance !== undefined && toBalance !== undefined && !sameAccount ? (
              <p
                className={`rounded-2xl px-4 py-2.5 text-xs ${
                  fromBalance - Number(amount) < 0 ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-700"
                }`}
              >
                {t("company.bankTransfers.balanceAfter", {
                  from: fmt.money(fromBalance - Number(amount)),
                  to: fmt.money(toBalance + Number(amount)),
                })}
              </p>
            ) : null}

            {sameAccount ? (
              <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-xs text-red-700">
                {t("company.bankTransfers.sameAccount")}
              </p>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.bankTransfers.amount")}</span>
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
              <span className="text-sm font-medium text-slate-700">{t("company.bankTransfers.remarks")}</span>
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={t("company.bankTransfers.remarksPlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {saving ? t("common.saving") : t("company.bankTransfers.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

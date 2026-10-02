"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Bank = {
  id: number;
  bankName: string;
  initialBalance: number;
  remainingBalance: number;
  isActive: boolean;
};

/** The editable copy of one account's figures, kept as strings for the inputs. */
type Draft = { initialBalance: string; remainingBalance: string; isActive: boolean };

function draftOf(bank: Bank): Draft {
  return {
    initialBalance: String(bank.initialBalance),
    remainingBalance: String(bank.remainingBalance),
    isActive: bank.isActive,
  };
}

/** An untouched or blank balance field is sent as absent, so the server applies its 0 default. */
function balanceOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export default function CompanyBanksPage() {
  const { t, tEnum, fmt } = useI18n();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [bankName, setBankName] = useState("");
  // Left as empty strings rather than 0 so the inputs can show a placeholder
  // and the server can tell "the owner typed nothing" from "the owner typed 0" -
  // both end up at 0, but only the second is a deliberate figure.
  const [initialBalance, setInitialBalance] = useState("");
  const [remainingBalance, setRemainingBalance] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Only one account is ever open for editing, and `editingId` is matched
  // against the freshly loaded list - so an account that drops out of the
  // current search takes its form with it instead of stranding state nobody
  // can see.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const filteredBanks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter((bank) => bank.bankName.toLowerCase().includes(q));
  }, [banks, search]);

  const totalRemaining = useMemo(
    () => banks.filter((b) => b.isActive).reduce((sum, b) => sum + b.remainingBalance, 0),
    [banks]
  );

  async function loadBanks() {
    try {
      const data = await apiFetch<{ banks: Bank[] }>("/api/company/banks");
      setBanks(data.banks);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadBanks();
    }
    load();
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const name = bankName.trim();
    try {
      // Both balances are optional and both default to 0 on the server. The
      // account is usable as soon as it exists - an owner can add "dbbl" from
      // the till and reconcile the real figure from the Banks screen later.
      await apiFetch("/api/company/banks", "POST", {
        bankName: name,
        initialBalance: balanceOrUndefined(initialBalance),
        remainingBalance: balanceOrUndefined(remainingBalance),
      });
      setBankName("");
      setInitialBalance("");
      setRemainingBalance("");
      await loadBanks();
      setSuccess(t("company.banks.createdMessage", { name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(bank: Bank) {
    setError(null);
    setEditingId(bank.id);
    setDraft(draftOf(bank));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveEdit(bank: Bank) {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    setSavingId(bank.id);
    try {
      await apiFetch(`/api/company/banks/${bank.id}`, "PATCH", {
        initialBalance: Number(draft.initialBalance),
        remainingBalance: Number(draft.remainingBalance),
        isActive: draft.isActive,
      });
      setEditingId(null);
      setDraft(null);
      await loadBanks();
      setSuccess(t("company.banks.savedMessage", { name: tEnum(bank.bankName) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  function toggleActive(bank: Bank) {
    // A one-field patch, so the form's draft is untouched - this is the "stop
    // offering it without losing its history" button, not an edit.
    void apiFetch(`/api/company/banks/${bank.id}`, "PATCH", { isActive: !bank.isActive })
      .then(loadBanks)
      .catch((err: unknown) => setError((err as Error).message));
  }

  function handleDelete(bank: Bank) {
    // Confirmed rather than immediate: a delete cannot be undone here, and
    // whether it is even allowed depends on history the owner cannot see from
    // this screen. Deactivate is the one to reach for by reflex, so it stays
    // the button on the row and delete sits behind a confirmation.
    if (!window.confirm(t("company.banks.deleteConfirm", { name: tEnum(bank.bankName) }))) return;
    setError(null);
    setSuccess(null);
    setDeletingId(bank.id);
    void apiFetch(`/api/company/banks/${bank.id}`, "DELETE")
      .then(async () => {
        if (editingId === bank.id) cancelEdit();
        await loadBanks();
        setSuccess(t("company.banks.deletedMessage", { name: tEnum(bank.bankName) }));
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setDeletingId(null));
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.banks")}</h1>
        {banks.length > 0 ? (
          <p className="text-sm text-slate-600">
            {t("company.banks.totalLabel", { amount: fmt.money(totalRemaining) })}
          </p>
        ) : null}
      </div>
      <p className="-mt-4 text-sm text-slate-600">{t("company.banks.helper")}</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.banks.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.banks.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredBanks.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.banks.noMatch", { search: search.trim() })
                : t("company.banks.noneYet")}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {/* The two action buttons are wider than their column, and a
                  flex row that overflows a fixed column spills out of its start
                  edge - which is what used to push the buttons left on top of
                  the balance. So the column is sized to actually hold them and
                  the whole table keeps a floor width inside a scroll container
                  instead of being squeezed when the card narrows.

                  The floor is set just under the card's own width at the widest
                  breakpoint, so the name column does not stretch into a long
                  empty run before the balances, and no scrollbar appears on a
                  desktop. */}
              <div className="overflow-x-auto">
                <div className="min-w-[33rem]">
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_10.5rem] gap-2 pb-2 text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">
                    <span>{t("company.banks.bankName")}</span>
                    <span className="text-right">{t("company.banks.initialBalance")}</span>
                    <span className="text-right">{t("company.banks.remainingBalance")}</span>
                    <span />
                  </div>
                  {filteredBanks.map((bank) => {
                    const editing = editingId === bank.id;
                    return (
                      <div key={bank.id} className="py-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_10.5rem] items-center gap-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-950">{tEnum(bank.bankName)}</p>
                            {bank.isActive ? null : (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {t("common.inactive")}
                              </span>
                            )}
                          </div>
                          <span className="text-right tabular-nums text-slate-600">
                            {fmt.money(bank.initialBalance)}
                          </span>
                          <span
                            className={`text-right font-semibold tabular-nums ${
                              bank.remainingBalance < 0 ? "text-red-600" : "text-slate-950"
                            }`}
                          >
                            {fmt.money(bank.remainingBalance)}
                          </span>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(bank)}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(bank)}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white"
                            >
                              {bank.isActive ? t("company.banks.deactivate") : t("company.banks.activate")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(bank)}
                              disabled={deletingId === bank.id}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-50"
                            >
                              {deletingId === bank.id ? t("common.deleting") : t("common.delete")}
                            </button>
                          </div>
                        </div>

                        {editing && draft ? (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <h3 className="text-sm font-semibold text-slate-950">
                              {t("company.banks.editTitle", { name: tEnum(bank.bankName) })}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">{t("company.banks.editHelper")}</p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.banks.initialBalance")}
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.initialBalance}
                                  onChange={(e) => patchDraft({ initialBalance: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-slate-700">
                                  {t("company.banks.remainingBalance")}
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.remainingBalance}
                                  onChange={(e) => patchDraft({ remainingBalance: e.target.value })}
                                  className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                                />
                              </label>
                            </div>
                            <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={draft.isActive}
                                onChange={(e) => patchDraft({ isActive: e.target.checked })}
                                className="h-4 w-4"
                              />
                              {t("company.banks.offerInDropdowns")}
                            </label>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveEdit(bank)}
                                disabled={savingId === bank.id}
                                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                              >
                                {savingId === bank.id ? t("common.saving") : t("common.save")}
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
          <h2 className="text-lg font-semibold text-slate-950">{t("company.banks.addTitle")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("company.banks.addHelper")}</p>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.banks.bankName")}</span>
              <input
                required
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder={t("company.banks.bankNamePlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("company.banks.initialBalance")}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                  placeholder="0"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("company.banks.remainingBalance")}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={remainingBalance}
                  onChange={(e) => setRemainingBalance(e.target.value)}
                  placeholder="0"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
            </div>
            <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              {t("company.banks.reservedHint")}
            </p>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {saving ? t("common.saving") : t("company.banks.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

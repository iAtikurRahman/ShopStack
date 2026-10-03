"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useBanks } from "@/hooks/useBanks";
import { apiFetch } from "@/services/api";

type Head = { id: number; name: string; isActive: boolean };

type Item = {
  id: number;
  headId: number;
  headName: string;
  description: string | null;
  billNo: string | null;
  amount: number;
};

type Expenditure = {
  id: number;
  expenditureDate: string;
  note: string | null;
  transportationCost: number;
  additionalCost: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  paymentMethod: string | null;
  isPaid: boolean;
  isActive: boolean;
  items: Item[];
  createdAt: string;
};

/** One row of the form, kept as strings so a half-typed amount is never coerced
 *  into NaN mid-keystroke. `key` is a client-side identity only - the server
 *  assigns the real id on save.
 *
 *  A line says what the money was spent ON. How the voucher was paid belongs to
 *  the voucher, so there is nothing about payment here. */
type LineDraft = {
  key: string;
  headId: string;
  description: string;
  billNo: string;
  amount: string;
};

/** The whole voucher, header extras included. Editing swaps this in wholesale.
 *
 *  `paymentMethod`/`isPaid` live here rather than on each line: the heads are
 *  added up first, and the single answer to "and how was that paid" applies to
 *  the sum - including the optional extras, which are part of the same total. */
type VoucherDraft = {
  date: string;
  note: string;
  transportationCost: string;
  additionalCost: string;
  discount: string;
  paymentMethod: string;
  isPaid: boolean;
  lines: LineDraft[];
};

/** A line's identity while it is being typed, never sent to the server.
 *
 *  Deliberately not a plain module counter: this file is re-evaluated on every
 *  fast refresh, which would restart such a counter at 1 and hand a newly added
 *  line the same key as one already on screen. React answers colliding keys by
 *  dropping or duplicating children, so the line the owner just added would
 *  silently not appear. The random tail means a reloaded module cannot reissue a
 *  key that is still in use. */
let lineKeySeq = 0;

function newLineKey(): string {
  lineKeySeq += 1;
  return `${lineKeySeq}-${Math.random().toString(36).slice(2, 10)}`;
}

/** An empty account means "whatever the first account turns out to be".
 *
 *  The account list arrives after the first render, so the draft cannot hold a
 *  real id at the moment the voucher is created. Rather than write the default
 *  back into state once the list lands, the empty string is resolved at the point
 *  of use - see `methodFor`. It also means a voucher created before any account
 *  exists picks one up for free the moment one does.
 */
function newLine(): LineDraft {
  return {
    key: newLineKey(),
    headId: "",
    description: "",
    billNo: "",
    amount: "",
  };
}

function todayInput(): string {
  // The date input wants yyyy-mm-dd, not an ISO timestamp with a time on it.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyVoucher(): VoucherDraft {
  return {
    date: todayInput(),
    note: "",
    transportationCost: "",
    additionalCost: "",
    discount: "",
    // Paid and account-free by default: `methodFor` fills the account in as soon
    // as the list lands, so the common case needs no clicks.
    paymentMethod: "",
    isPaid: true,
    lines: [newLine()],
  };
}

function draftOf(expenditure: Expenditure): VoucherDraft {
  return {
    // Same reason as todayInput: the stored value is a full ISO timestamp.
    date: expenditure.expenditureDate.slice(0, 10),
    note: expenditure.note ?? "",
    transportationCost: expenditure.transportationCost ? String(expenditure.transportationCost) : "",
    additionalCost: expenditure.additionalCost ? String(expenditure.additionalCost) : "",
    discount: expenditure.discount ? String(expenditure.discount) : "",
    isPaid: expenditure.isPaid,
    // Kept as "" rather than a stand-in account: an unsettled voucher has no
    // account yet, and picking one here would claim it had.
    paymentMethod: expenditure.paymentMethod ?? "",
    lines: expenditure.items.map((item) => ({
      key: newLineKey(),
      headId: String(item.headId),
      description: item.description ?? "",
      billNo: item.billNo ?? "",
      amount: String(item.amount),
    })),
  };
}

/** Only lines that would actually be posted - a row with no head is a row the
 *  user started and has not finished, and sending it would be rejected. */
function usableLines(lines: LineDraft[]): LineDraft[] {
  return lines.filter((line) => line.headId !== "" && num(line.amount) > 0);
}

export default function CompanyExpendituresPage() {
  const { t, tEnum, fmt } = useI18n();
  const { banks } = useBanks();
  const [expenditures, setExpenditures] = useState<Expenditure[]>([]);
  const [heads, setHeads] = useState<Head[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // The account list, keyed by name: applyBankDelta identifies an account by
  // bank_info.bankName and the stored voucher snapshots that same name, so the
  // form has to carry names throughout - never the row id.
  const fallbackBankName = banks[0] ? banks[0].bankName : "";
  const bankByName = useMemo(() => new Map(banks.map((b) => [b.bankName, b])), [banks]);

  const [draft, setDraft] = useState<VoucherDraft>(emptyVoucher);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [voidingId, setVoidingId] = useState<number | null>(null);

  const [newHead, setNewHead] = useState("");
  const [addingHead, setAddingHead] = useState(false);

  // The freshest balance this screen knows for each account, keyed by name.
  // applyBankDelta identifies an account by name, so that is what comes back -
  // see the Withdrawals screen, which does the same thing keyed by id. Without
  // this the "balance after" preview would keep showing a figure the server has
  // already moved on from, until a reload.
  const [balanceOverrides, setBalanceOverrides] = useState<Record<string, number>>({});

  // The list lives beside the form on a wide screen and below it on a narrow
  // one, where the form is far taller than the viewport. Saving used to leave the
  // owner staring at a success line at the top of the page with their new voucher
  // - and its edit and delete buttons - somewhere off-screen, so the list is
  // scrolled into view and the voucher that was just saved is ringed for a
  // moment to say "this one".
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function revealVoucher(id: number) {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
  }

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  async function load() {
    try {
      const data = await apiFetch<{ expenditures: Expenditure[]; heads: Head[] }>(
        "/api/company/expenditures"
      );
      setExpenditures(data.expenditures);
      setHeads(data.heads);
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

  /** The account a row will actually post against: whatever was chosen, or the
   *  first account when none was. Resolving here rather than in an effect keeps
   *  the draft holding only real user choices. */
  function methodFor(chosen: string): string {
    return chosen || fallbackBankName;
  }

  function balanceOf(bankName: string | null): number | undefined {
    if (!bankName) return undefined;
    const override = balanceOverrides[bankName];
    if (override !== undefined) return override;
    return bankByName.get(bankName)?.remainingBalance;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expenditures;
    return expenditures.filter(
      (expenditure) =>
        (expenditure.note ?? "").toLowerCase().includes(q) ||
        (expenditure.paymentMethod ?? "").toLowerCase().includes(q) ||
        expenditure.items.some(
          (item) =>
            item.headName.toLowerCase().includes(q) ||
            (item.billNo ?? "").toLowerCase().includes(q) ||
            (item.description ?? "").toLowerCase().includes(q)
        )
    );
  }, [expenditures, search]);

  const totalActive = useMemo(
    () => expenditures.filter((e) => e.isActive).reduce((sum, e) => sum + e.totalAmount, 0),
    [expenditures]
  );
  const totalPaid = useMemo(
    () => expenditures.filter((e) => e.isActive).reduce((sum, e) => sum + e.paidAmount, 0),
    [expenditures]
  );

  const lineSum = useMemo(
    () => draft.lines.reduce((sum, line) => sum + num(line.amount), 0),
    [draft.lines]
  );
  const extrasNet = num(draft.transportationCost) + num(draft.additionalCost) - num(draft.discount);
  const draftTotal = lineSum + extrasNet;
  // One switch for the whole voucher, so the settled figure is all of it or none
  // of it - there is no partially-paid state to express.
  const draftPaid = draft.isPaid ? Math.max(draftTotal, 0) : 0;

  const usable = usableLines(draft.lines);
  // A paid voucher with no account to pay from would be refused by the server, so
  // the button stays disabled until there is one. An unpaid one needs no account.
  const needsAccount = draft.isPaid && draftTotal > 0 && !methodFor(draft.paymentMethod);
  const canSubmit = usable.length > 0 && draft.date !== "" && !needsAccount && !saving;

  // What the chosen account reads once this voucher's whole total has left it -
  // one preview for the voucher, not one per line.
  const chosenBalance = draft.isPaid ? balanceOf(methodFor(draft.paymentMethod)) : undefined;
  const afterBalance =
    chosenBalance !== undefined ? chosenBalance - Math.max(draftTotal, 0) : undefined;

  function patchDraft(patch: Partial<VoucherDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setDraft((current) => ({
      ...current,
      lines: [...current.lines, newLine()],
    }));
  }

  function removeLine(key: string) {
    setDraft((current) => {
      const lines = current.lines.filter((line) => line.key !== key);
      // Never leave the voucher with zero rows: the form would have nothing to
      // show and "add a line" would have to come first.
      return { ...current, lines: lines.length > 0 ? lines : [newLine()] };
    });
  }

  function startNew() {
    setError(null);
    setSuccess(null);
    setEditingId(null);
    setDraft(emptyVoucher());
  }

  function startEdit(expenditure: Expenditure) {
    setError(null);
    setSuccess(null);
    setEditingId(expenditure.id);
    setDraft(draftOf(expenditure));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** The exact payload both create and edit send - the voucher is replaced
   *  wholesale on save, so the two paths differ only in the URL. */
  function payloadOf(voucher: VoucherDraft) {
    return {
      expenditureDate: voucher.date,
      note: voucher.note.trim() || undefined,
      transportationCost: num(voucher.transportationCost) || undefined,
      additionalCost: num(voucher.additionalCost) || undefined,
      discount: num(voucher.discount) || undefined,
      // The one payment answer for the voucher, sent once, next to the sum it
      // settles. `parseVoucher` reads isPaid as false to mean "no account given".
      isPaid: voucher.isPaid,
      paymentMethod: voucher.isPaid ? methodFor(voucher.paymentMethod) : undefined,
      items: usableLines(voucher.lines).map((line) => ({
        headId: Number(line.headId),
        description: line.description.trim() || undefined,
        billNo: line.billNo.trim() || undefined,
        amount: Number(line.amount),
      })),
    };
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const result = await apiFetch<{ expenditure: Expenditure; bankBalances: Record<string, number> }>(
        "/api/company/expenditures",
        "POST",
        payloadOf(draft)
      );
      setBalanceOverrides((current) => ({ ...current, ...result.bankBalances }));
      setDraft(emptyVoucher());
      await load();
      setSuccess(t("company.expenditures.createdMessage", { amount: fmt.money(result.expenditure.totalAmount) }));
      revealVoucher(result.expenditure.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (editingId === null) return;
    setError(null);
    setSuccess(null);
    setSavingId(editingId);
    try {
      const result = await apiFetch<{ expenditure: Expenditure; bankBalances: Record<string, number> }>(
        `/api/company/expenditures/${editingId}`,
        "PATCH",
        payloadOf(draft)
      );
      setBalanceOverrides((current) => ({ ...current, ...result.bankBalances }));
      setEditingId(null);
      setDraft(emptyVoucher());
      await load();
      setSuccess(t("company.expenditures.savedMessage"));
      revealVoucher(result.expenditure.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleVoid(expenditure: Expenditure) {
    if (
      !window.confirm(
        t("company.expenditures.deleteConfirm", { amount: fmt.money(expenditure.totalAmount) })
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setVoidingId(expenditure.id);
    try {
      const result = await apiFetch<{ expenditure: Expenditure; bankBalances: Record<string, number> }>(
        `/api/company/expenditures/${expenditure.id}`,
        "DELETE"
      );
      if (editingId === expenditure.id) startNew();
      setBalanceOverrides((current) => ({ ...current, ...result.bankBalances }));
      await load();
      setSuccess(
        t("company.expenditures.deletedMessage", { amount: fmt.money(expenditure.totalAmount) })
      );
      revealVoucher(expenditure.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVoidingId(null);
    }
  }

  async function handleAddHead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newHead.trim();
    if (!name) return;
    setError(null);
    setAddingHead(true);
    try {
      const result = await apiFetch<{ head: Head }>("/api/company/expenditures/heads", "POST", {
        name,
      });
      setHeads((current) =>
        [...current, result.head].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewHead("");
      setSuccess(t("company.expenditures.headCreated", { name: tEnum(result.head.name) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingHead(false);
    }
  }

  async function toggleHead(head: Head) {
    setError(null);
    try {
      const result = await apiFetch<{ head: Head }>(
        `/api/company/expenditures/heads/${head.id}`,
        "PATCH",
        { isActive: !head.isActive }
      );
      setHeads((current) => current.map((h) => (h.id === head.id ? result.head : h)));
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteHead(head: Head) {
    if (!window.confirm(t("company.expenditures.deleteHeadConfirm", { name: tEnum(head.name) }))) {
      return;
    }
    setError(null);
    try {
      await apiFetch<{ name: string }>(`/api/company/expenditures/heads/${head.id}`, "DELETE");
      setHeads((current) => current.filter((h) => h.id !== head.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.expenditures")}</h1>
        {expenditures.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-4">
            <p className="text-sm text-slate-600">
              {t("company.expenditures.paidLabel")}: {fmt.money(totalPaid)} ·{" "}
              {t("company.expenditures.totalLabel")}: {fmt.money(totalActive)}
            </p>
            {/* On a narrow screen the list sits below the whole form, so without
                this there is no way to tell it is down there at all. */}
            <button
              type="button"
              onClick={() =>
                listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="text-sm font-semibold text-slate-900 underline underline-offset-4"
            >
              {t("company.expenditures.jumpToList", { count: expenditures.length })}
            </button>
          </div>
        ) : null}
      </div>
      <p className="-mt-4 text-sm text-slate-600">{t("company.expenditures.helper")}</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      {/* Wide screen: list on the left, the add form on the right, and the heads
          under the form - the heads are a maintenance panel, not something the
          owner needs in view while reading vouchers.
          The three cards are placed into grid cells explicitly rather than left
          to source order, because the source order is deliberately the opposite
          on a narrow screen: the two stack, and there the form should come first
          (add a voucher, then find the list). */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* ------------------------------------------------------ the form */}
        <form
          onSubmit={editingId === null ? handleCreate : (event) => {
            event.preventDefault();
            void saveEdit();
          }}
          className="h-fit space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-start-2 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">
              {editingId === null
                ? t("company.expenditures.addTitle")
                : t("company.expenditures.editTitle")}
            </h2>
            {editingId === null ? null : (
              <button
                type="button"
                onClick={startNew}
                className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                {t("company.expenditures.addTitle")}
              </button>
            )}
          </div>
          {editingId === null ? (
            <p className="-mt-3 text-xs text-slate-500">{t("company.expenditures.addHelper")}</p>
          ) : (
            <p className="-mt-3 text-xs text-slate-500">{t("company.expenditures.editHelper")}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.expenditures.date")}
              </span>
              <input
                type="date"
                required
                value={draft.date}
                max={todayInput()}
                onChange={(e) => patchDraft({ date: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.expenditures.note")}
              </span>
              <input
                value={draft.note}
                onChange={(e) => patchDraft({ note: e.target.value })}
                placeholder={t("company.expenditures.notePlaceholder")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
          </div>

          {/* ----------------------------------------------------- lines */}
          <div className="space-y-3">
            {draft.lines.map((line) => (
              <div
                key={line.key}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        {t("company.expenditures.lineHead")}
                      </span>
                      <select
                        value={line.headId}
                        onChange={(e) => patchLine(line.key, { headId: e.target.value })}
                        className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                      >
                        <option value="">{t("company.expenditures.lineHead")}</option>
                        {heads.map((head) => (
                          <option key={head.id} value={head.id}>
                            {tEnum(head.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        {t("company.expenditures.lineAmount")}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.amount}
                        onChange={(e) => patchLine(line.key, { amount: e.target.value })}
                        className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        {t("company.expenditures.lineDescription")}
                      </span>
                      <input
                        value={line.description}
                        onChange={(e) => patchLine(line.key, { description: e.target.value })}
                        placeholder={t("company.expenditures.lineDescriptionPlaceholder")}
                        className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        {t("company.expenditures.lineBillNo")}
                      </span>
                      <input
                        value={line.billNo}
                        onChange={(e) => patchLine(line.key, { billNo: e.target.value })}
                        placeholder={t("company.expenditures.lineBillNoPlaceholder")}
                        className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={draft.lines.length === 1}
                    className="mt-3 ml-auto block rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                  >
                    {t("company.expenditures.removeLine")}
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              onClick={addLine}
              className="w-full rounded-2xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              {t("company.expenditures.addLine")}
            </button>
            {usable.length === 0 ? (
              <p className="text-xs text-slate-500">{t("company.expenditures.noLines")}</p>
            ) : null}
          </div>

          {/* ----------------------------------------------------- extras */}
          <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                {t("company.expenditures.extrasTitle")}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t("company.expenditures.extrasHelper")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["transportationCost", t("company.expenditures.transportationCost")],
                  ["additionalCost", t("company.expenditures.additionalCost")],
                  ["discount", t("company.expenditures.discount")],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="block">
                  <span className="text-xs font-medium text-slate-700">{label}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={draft[field]}
                    onChange={(e) => patchDraft({ [field]: e.target.value } as Partial<VoucherDraft>)}
                    className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* ----------------------------------------------------- payment */}
          {/* One account and one switch for everything above. The heads only say
              what the money was spent on; how the total was paid is asked once,
              after the total exists. */}
          <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                {t("company.expenditures.paymentTitle")}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t("company.expenditures.paymentHelper", { amount: fmt.money(draftTotal) })}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.isPaid}
                onChange={(e) => patchDraft({ isPaid: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              {draft.isPaid
                ? t("company.expenditures.voucherPaid")
                : t("company.expenditures.voucherUnpaid")}
            </label>

            {draft.isPaid ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">
                    {t("company.withdrawals.bank")}
                  </span>
                  <select
                    value={methodFor(draft.paymentMethod)}
                    onChange={(e) => patchDraft({ paymentMethod: e.target.value })}
                    className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                  >
                    {banks.length === 0 ? (
                      <option value="">{t("common.payments.noMethods")}</option>
                    ) : (
                      banks.map((bank) => (
                        <option key={bank.id} value={bank.bankName}>
                          {tEnum(bank.bankName)}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                {afterBalance !== undefined ? (
                  <p
                    className={`self-end pb-2 text-xs ${afterBalance < 0 ? "text-red-600" : "text-slate-500"}`}
                  >
                    {t("company.expenditures.balanceAfter", {
                      bank: tEnum(methodFor(draft.paymentMethod)),
                      amount: fmt.money(afterBalance),
                    })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {t("company.expenditures.voucherUnpaidHelper")}
              </p>
            )}
          </div>

          {/* ----------------------------------------------------- totals */}
          <div className="space-y-1 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>{t("company.expenditures.lineSum")}</span>
              <span className="tabular-nums">{fmt.money(lineSum)}</span>
            </div>
            {extrasNet !== 0 ? (
              <div className="flex justify-between text-slate-600">
                <span>{t("company.expenditures.extrasNetLabel")}</span>
                <span className="tabular-nums">{fmt.money(extrasNet)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold text-slate-950">
              <span>{t("company.expenditures.totalLabel")}</span>
              <span className="tabular-nums">{fmt.money(draftTotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("company.expenditures.paidLabel")}</span>
              <span className="tabular-nums">{fmt.money(draftPaid)}</span>
            </div>
            {draftTotal - draftPaid > 0 ? (
              <div className="flex justify-between text-amber-700">
                <span>{t("company.expenditures.unpaidLabel")}</span>
                <span className="tabular-nums">{fmt.money(draftTotal - draftPaid)}</span>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {editingId !== null
                ? savingId === editingId
                  ? t("common.saving")
                  : t("common.save")
                : saving
                  ? t("common.saving")
                  : t("company.expenditures.create")}
            </button>
            {editingId === null ? null : (
              <button
                type="button"
                onClick={startNew}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white"
              >
                {t("common.cancel")}
              </button>
            )}
          </div>
        </form>

        {/* --------------------------------------------------- the list */}
        <div
          ref={listRef}
          className="scroll-mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-start-1 lg:row-start-1"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-950">
              {t("company.expenditures.allTitle")}
            </h2>
            {filtered.length > 0 ? (
              <span className="text-xs text-slate-500">
                {filtered.length}{" "}
                {t(
                  filtered.length === 1
                    ? "company.expenditures.voucherCountOne"
                    : "company.expenditures.voucherCountMany"
                )}
              </span>
            ) : null}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.expenditures.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.expenditures.noMatch", { search: search.trim() })
                : t("company.expenditures.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filtered.map((expenditure) => (
                <div
                  key={expenditure.id}
                  className={`rounded-2xl border p-3 transition-shadow ${
                    highlightId === expenditure.id
                      ? "border-emerald-500 ring-2 ring-emerald-500/40"
                      : expenditure.isActive
                        ? "border-slate-200 bg-slate-50"
                        : "border-slate-100 bg-slate-50/60"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-semibold ${
                          expenditure.isActive ? "text-slate-950" : "text-slate-500 line-through"
                        }`}
                      >
                        {expenditure.note || t("company.expenditures.nothingToShow")}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmt.date(expenditure.expenditureDate)} · {expenditure.items.length}{" "}
                        {t("company.expenditures.lineHead")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-950">
                        {fmt.money(expenditure.totalAmount)}
                      </p>
                      {expenditure.unpaidAmount > 0 ? (
                        <p className="text-xs tabular-nums text-amber-700">
                          {t("company.expenditures.unpaidLabel")}{" "}
                          {fmt.money(expenditure.unpaidAmount)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <ul className="mt-2 space-y-0.5">
                    {expenditure.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2 text-xs text-slate-600">
                        <span className="truncate">
                          {tEnum(item.headName)}
                          {item.billNo ? ` · ${item.billNo}` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums">{fmt.money(item.amount)}</span>
                      </li>
                    ))}
                  </ul>

                  {/* The payment belongs to the voucher, so it is stated once here
                      rather than repeated on every head. */}
                  <p className="mt-2 text-xs text-slate-600">
                    {expenditure.isPaid && expenditure.paymentMethod
                      ? t("company.expenditures.paidVia", {
                          bank: tEnum(expenditure.paymentMethod),
                          amount: fmt.money(expenditure.paidAmount),
                        })
                      : t("company.expenditures.unpaidVia", {
                          amount: fmt.money(expenditure.unpaidAmount),
                        })}
                  </p>

                  {!expenditure.isActive ? (
                    <span className="mt-2 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {t("common.payments.voided")}
                    </span>
                  ) : null}

                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(expenditure)}
                      disabled={!expenditure.isActive}
                      className="rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVoid(expenditure)}
                      disabled={!expenditure.isActive || voidingId === expenditure.id}
                      className="rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-40"
                    >
                      {voidingId === expenditure.id ? t("common.deleting") : t("common.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* --------------------------------------------------- the heads */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-start-2 lg:row-start-2">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("company.expenditures.headsTitle")}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{t("company.expenditures.headsHelper")}</p>
          <form onSubmit={handleAddHead} className="mt-4 flex gap-2">
            <input
              required
              value={newHead}
              onChange={(e) => setNewHead(e.target.value)}
              placeholder={t("company.expenditures.headNamePlaceholder")}
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-slate-900"
            />
            <button
              type="submit"
              disabled={addingHead || newHead.trim() === ""}
              className="shrink-0 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {t("company.expenditures.addHead")}
            </button>
          </form>
          {heads.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">{t("company.expenditures.noneYet")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {heads.map((head) => (
                <li key={head.id} className="flex items-center justify-between gap-2 py-2">
                  <span
                    className={`truncate text-sm ${
                      head.isActive ? "text-slate-900" : "text-slate-400 line-through"
                    }`}
                  >
                    {tEnum(head.name)}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleHead(head)}
                      className="rounded-xl border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
                    >
                      {head.isActive
                        ? t("company.expenditures.headDeactivate")
                        : t("company.expenditures.headReactivate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteHead(head)}
                      className="rounded-xl border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
                    >
                      {t("company.expenditures.deleteHead")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

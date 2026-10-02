"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type StatementKind = "sale" | "receive" | "purchase" | "payment" | "withdrawal";

type StatementRow = {
  key: string;
  kind: StatementKind;
  date: string;
  sourceId: number;
  party: string | null;
  reference: string | null;
  detail: string | null;
  amount: number;
  balance: number;
  isVoided: boolean;
};

type Bank = {
  id: number;
  bankName: string;
  initialBalance: number;
  remainingBalance: number;
  isActive: boolean;
  createdAt: string;
};

type Statement = {
  bank: Bank;
  openingBalance: number;
  rows: StatementRow[];
  totalIn: number;
  totalOut: number;
  ledgerBalance: number;
  isAdjusted: boolean;
  voidedCount: number;
};

/**
 * The stored `kind` names the dictionary leaf twice - once for the column that
 * says what kind of movement it was ("Sale") and once for the line that says
 * which sale ("Sale #12"). One map, two lookups, so the two can never drift
 * apart and leave a row labelled in one column and numbered in another.
 */
const KIND_KEY: Record<StatementKind, "sale" | "receive" | "purchase" | "payment" | "withdrawal"> = {
  sale: "sale",
  receive: "receive",
  purchase: "purchase",
  payment: "payment",
  withdrawal: "withdrawal",
};

export default function BankDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tEnum, fmt } = useI18n();
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<Statement>(`/api/company/banks/${id}`);
        if (active) setData(res);
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [id]);

  // Filtering the statement is deliberately client-side: the whole point of
  // this screen is that the running balance column is already computed, and
  // re-asking the server for a search term would mean recomputing it there too.
  // The running figure stays the one from the full statement, so a filtered row
  // still shows what the account held on that date rather than a figure that
  // depends on which rows happen to be hidden.
  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((row) => {
      const haystack = [
        row.party ?? "",
        row.reference ?? "",
        row.detail ?? "",
        // Both the stored kind and its translated title, so a Bangla search for
        // "বিক্রয়" finds the rows the English column calls "sale".
        row.kind,
        t(`company.bankDetail.kinds.${KIND_KEY[row.kind]}`),
        String(row.sourceId),
        row.date,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q) || (digits.length > 0 && haystack.replace(/\D/g, "").includes(digits));
    });
  }, [data, search, t]);

  const filteredTotalIn = useMemo(
    () => filteredRows.reduce((sum, row) => sum + Math.max(row.amount, 0), 0),
    [filteredRows]
  );
  const filteredTotalOut = useMemo(
    () => filteredRows.reduce((sum, row) => sum + Math.max(-row.amount, 0), 0),
    [filteredRows]
  );

  const isFiltered = search.trim() !== "";
  // Rows come newest-first, so the last one on screen is the oldest still
  // visible - and its running figure is the balance as of that date.
  const oldestVisibleBalance = filteredRows[filteredRows.length - 1]?.balance ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <Link href="/company/banks" className="text-sm text-slate-600 hover:underline">
        {t("company.bankDetail.backToBanks")}
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">{t("common.loading")}</p>
      ) : error || !data ? (
        <p className="text-sm text-red-600">{error ?? t("company.bankDetail.notFound")}</p>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">{tEnum(data.bank.bankName)}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {t("company.bankDetail.accountSince", { date: fmt.date(data.bank.createdAt) })}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {data.rows.length > 0
                    ? t("company.bankDetail.lastMovementOn", { date: fmt.dateTime(data.rows[0].date) })
                    : t("company.bankDetail.noneYet")}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  data.bank.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {data.bank.isActive ? t("common.active") : t("common.inactive")}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.bankDetail.openingBalance")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(data.openingBalance)}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.bankDetail.currentBalance")}</p>
              <p
                className={`mt-2 text-3xl font-semibold ${
                  data.bank.remainingBalance < 0 ? "text-red-600" : "text-slate-950"
                }`}
              >
                {fmt.money(data.bank.remainingBalance)}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.bankDetail.totalIn")}</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-700">{fmt.money(data.totalIn)}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.bankDetail.totalOut")}</p>
              <p className="mt-2 text-3xl font-semibold text-red-600">{fmt.money(data.totalOut)}</p>
            </div>
          </div>

          {/* The stored balance and the movements do not have to agree, because
              the owner can type a counted figure over it on the Accounts screen.
              Showing only one of them would quietly hide that, so the gap is
              stated instead of resolved. */}
          {data.isAdjusted ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm font-semibold text-amber-900">{t("company.bankDetail.adjustedTitle")}</p>
              <p className="mt-1 text-xs text-amber-800">
                {t("company.bankDetail.adjustedHint", {
                  ledger: fmt.money(data.ledgerBalance),
                  recorded: fmt.money(data.bank.remainingBalance),
                })}
              </p>
            </div>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("company.bankDetail.statementTitle")}
              </h2>
              <p className="text-sm text-slate-500">
                {data.rows.length === 1
                  ? t("company.bankDetail.movementCountOne")
                  : t("company.bankDetail.movementCountMany", { count: fmt.number(data.rows.length) })}
              </p>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("company.bankDetail.statementHelper")}</p>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("company.bankDetail.searchPlaceholder")}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />

            {data.voidedCount > 0 ? (
              <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                {data.voidedCount === 1
                  ? t("company.bankDetail.voidedHintOne")
                  : t("company.bankDetail.voidedHintMany", { count: fmt.number(data.voidedCount) })}
              </p>
            ) : null}

            {filteredRows.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">
                {search.trim()
                  ? t("company.bankDetail.noMatch", { search: search.trim() })
                  : t("company.bankDetail.noneYet")}
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[47rem]">
                  <div className="grid grid-cols-[13rem_7rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem] gap-2 border-b border-slate-200 pb-2 text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">
                    <span>{t("company.bankDetail.date")}</span>
                    <span>{t("company.bankDetail.type")}</span>
                    <span>{t("company.bankDetail.details")}</span>
                    <span className="text-right">{t("company.bankDetail.in")}</span>
                    <span className="text-right">{t("company.bankDetail.out")}</span>
                    <span className="text-right">{t("company.bankDetail.balance")}</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {filteredRows.map((row) => (
                      <div
                        key={row.key}
                        className="grid grid-cols-[13rem_7rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem] items-center gap-2 py-3 text-sm"
                      >
                        <span className="text-xs text-slate-600">{fmt.dateTime(row.date)}</span>
                        <span className="text-xs font-medium text-slate-900">
                          {t(`company.bankDetail.kinds.${KIND_KEY[row.kind]}`)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-slate-950">
                            {t(`company.bankDetail.${KIND_KEY[row.kind]}Entry`, { id: fmt.number(row.sourceId) })}
                            {row.isVoided ? (
                              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {t("company.bankDetail.voidedBadge")}
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {[
                              // A POS sale with no customer attached is a walk-in
                              // sale; naming that beats an empty second line.
                              row.party ?? (row.kind === "sale" ? t("company.bankDetail.noParty") : null),
                              row.reference,
                              row.detail,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="text-right tabular-nums text-emerald-700">
                          {row.amount > 0 ? fmt.money(row.amount) : ""}
                        </span>
                        <span className="text-right tabular-nums text-red-600">
                          {row.amount < 0 ? fmt.money(-row.amount) : ""}
                        </span>
                        <span
                          className={`text-right font-semibold tabular-nums ${
                            row.balance < 0 ? "text-red-600" : "text-slate-950"
                          }`}
                        >
                          {fmt.money(row.balance)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Totals, and only totals. The opening figure has its own card
                      above, so putting it here too would read as two different
                      numbers. The balance cell is the running figure for the
                      oldest row still on screen - the one closing figure that
                      means something whether or not the statement is filtered. */}
                  <div className="grid grid-cols-[13rem_7rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem] items-center gap-2 border-t border-slate-200 py-3 text-sm">
                    <span className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("company.bankDetail.totalsRow")}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-emerald-700">
                      {fmt.money(isFiltered ? filteredTotalIn : data.totalIn)}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-red-600">
                      {fmt.money(isFiltered ? filteredTotalOut : data.totalOut)}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-slate-950">
                      {fmt.money(isFiltered ? oldestVisibleBalance : data.ledgerBalance)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

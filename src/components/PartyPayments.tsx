"use client";

import { useI18n } from "@/components/LocaleProvider";

type TransactionType = "receive" | "payment";

export type PartyPayment = {
  id: number;
  transactionId: string;
  transactionType: TransactionType;
  /** The BankInfo.bankName the money moved through. */
  paymentType: string;
  paymentDate: string;
  paymentAmount: number;
  description: string | null;
  isActive: boolean;
};

/**
 * Signed the way the Payments screen signs them (see PaymentPanel): `receive`
 * is money coming in, `payment` is money going out, whichever party it is
 * booked against. The due impact is a separate question, handled by
 * DUE_DIRECTION in src/lib/payments.ts.
 */
function direction(transactionType: TransactionType): 1 | -1 {
  return transactionType === "receive" ? 1 : -1;
}

/**
 * A party's payment history, shown next to their sales/purchase history on the
 * customer and supplier detail screens.
 */
export function PartyPayments({ payments }: { payments: PartyPayment[] }) {
  const { t, tEnum, fmt } = useI18n();

  const totals = payments.reduce(
    (acc, payment) => {
      // Voided rows are still listed, but they no longer move money.
      if (!payment.isActive) return acc;
      const signed = direction(payment.transactionType) * payment.paymentAmount;
      return {
        in: acc.in + (signed > 0 ? signed : 0),
        out: acc.out + (signed < 0 ? -signed : 0),
      };
    },
    { in: 0, out: 0 }
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{t("common.payments.historyTitle")}</h2>
        <p className="text-sm text-slate-500">
          {t("common.payments.netLabel", {
            amount: fmt.number(totals.in - totals.out, { decimals: 2 }),
          })}
        </p>
      </div>

      {payments.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">{t("common.payments.noneYet")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {payments.map((payment) => {
            const signed = direction(payment.transactionType) * payment.paymentAmount;
            const incoming = signed > 0;
            return (
              <div
                key={payment.id}
                className={`flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-4 ${
                  payment.isActive ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white opacity-70"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{payment.transactionId}</p>
                  <p className="text-xs text-slate-500">
                    {fmt.dateTime(payment.paymentDate)}
                    {" · "}
                    {t(
                      payment.transactionType === "receive"
                        ? "common.payments.receive"
                        : "common.payments.payOut"
                    )}
                    {" · "}
                    {tEnum(payment.paymentType)}
                    {payment.isActive ? null : ` · ${t("common.payments.voided")}`}
                  </p>
                  {payment.description ? (
                    <p className="mt-1 text-xs text-slate-600">{payment.description}</p>
                  ) : null}
                </div>
                <p
                  className={`shrink-0 text-right font-semibold ${
                    !payment.isActive
                      ? "text-slate-500 line-through"
                      : incoming
                        ? "text-emerald-700"
                        : "text-red-600"
                  }`}
                >
                  {incoming ? "+" : "-"}
                  {fmt.money(payment.paymentAmount)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
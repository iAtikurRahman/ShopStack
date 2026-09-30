"use client";

import { PaymentPanel } from "@/components/PaymentPanel";
import { useI18n } from "@/components/LocaleProvider";

export default function CompanyPaymentsPage() {
  const { t } = useI18n();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.payments")}</h1>
      <PaymentPanel scope="company" />
    </main>
  );
}
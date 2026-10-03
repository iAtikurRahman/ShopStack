"use client";

import { useI18n } from "@/components/LocaleProvider";

/**
 * Small inline bar chart for a single numeric series. The width is the fraction
 * of `peak`, and colours change subtly to distinguish from neighbours.
 */
export function MiniBarChart({
  value,
  label,
  sublabel,
  peak,
  tone = "slate",
}: {
  value: number;
  label: string;
  sublabel: string;
  peak: number;
  tone?: "slate" | "emerald" | "red";
}) {
  const { t } = useI18n();
  const safePeak = Math.max(1, peak);
  const pct = Math.round((value / safePeak) * 100);

  const barTone = tone === "emerald" ? "bg-emerald-600" : tone === "red" ? "bg-red-600" : "bg-slate-950";

  return (
    <div className="flex h-full flex-col justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{sublabel}</p>
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div className={`h-1.5 rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-slate-500">
          {t("storeOps.dashboard.relativeToPeak", { percent: pct })}
        </p>
      </div>
    </div>
  );
}

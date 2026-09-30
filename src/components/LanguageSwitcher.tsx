"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locale";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Switches the UI language. The POST is what persists the choice: the route
 * writes the account row, re-signs the session and refreshes the locale
 * cookie, then this component asks the server to re-render the tree.
 */
export function LanguageSwitcher({ variant = "light" }: { variant?: "light" | "dark" }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = pending || saving;

  async function select(next: Locale) {
    if (next === locale || busy) return;
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/auth/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
      }).then((response) => {
        if (!response.ok) throw new Error("Request failed");
      });
      startTransition(() => router.refresh());
    } catch {
      setError(t("common.requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  const base =
    variant === "dark"
      ? "border-slate-700 bg-slate-800 text-slate-300"
      : "border-slate-200 bg-slate-50 text-slate-600";
  const idle = variant === "dark" ? "hover:bg-slate-700" : "hover:bg-white hover:text-slate-950";

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label={t("nav.language")}
        className={`flex items-center gap-1 rounded-full border p-1 ${base}`}
      >
        {LOCALES.map((code) => {
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              onClick={() => select(code)}
              disabled={busy}
              aria-pressed={active}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                active ? "bg-slate-950 text-white" : idle
              }`}
            >
              {LOCALE_LABELS[code]}
            </button>
          );
        })}
      </div>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}

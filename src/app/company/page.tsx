import { requireTenantSession } from "@/lib/session";
import { getDictionary, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";
import { createFormatters } from "@/lib/i18n/format";

export default async function CompanyDashboardPage() {
  const { session, db } = await requireTenantSession({ roles: ["company_admin", "store_manager"] });
  const [storeCount, userCount] = await Promise.all([
    db.store.count(),
    db.user.count(),
  ]);

  const locale = await readLocaleCookie();
  const dictionary = getDictionary(locale);
  const fmt = createFormatters(locale);
  const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(dictionary, key, vars);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          {t("company.dashboard.welcome", { name: session.name })}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("company.dashboard.nextPhase")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("nav.stores")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.number(storeCount)}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("nav.users")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.number(userCount)}</p>
        </div>
      </div>
    </main>
  );
}

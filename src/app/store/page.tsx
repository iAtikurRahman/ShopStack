import { requireTenantSession } from "@/lib/session";
import { getDictionary, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";

export default async function StoreDashboardPage() {
  const { session, db } = await requireTenantSession({ roles: ["company_admin", "store_manager", "store_user"] });
  const store = session.storeId
    ? await db.store.findUnique({ where: { id: session.storeId } })
    : null;

  const dictionary = getDictionary(await readLocaleCookie());
  const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(dictionary, key, vars);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          {t("storeOps.dashboard.welcome", { name: session.name })}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {store
            ? t("storeOps.dashboard.workingFrom", { store: store.name })
            : t("storeOps.dashboard.companyWideAccess")}
        </p>
        <p className="mt-1 text-sm text-slate-600">{t("storeOps.dashboard.posLaterPhase")}</p>
      </div>
    </main>
  );
}

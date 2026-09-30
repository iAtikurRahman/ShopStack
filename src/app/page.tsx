import Link from "next/link";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Home() {
  const t = await buildTranslator();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-4xl border border-slate-200 bg-white p-10 shadow-xl">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              {t("auth.heroTitle")}
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">{t("auth.heroBody")}</p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800"
              >
                {t("auth.signIn")}
              </Link>
              <Link
                href="/admin/login"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-6 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                {t("auth.projectAdmin")}
              </Link>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              {t("auth.firstTime")}{" "}
              <Link href="/setup" className="font-semibold text-slate-950 underline">
                {t("auth.createProjectAdmin")}
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

async function buildTranslator() {
  const dictionary = getDictionary(await readLocaleCookie());
  return (key: Parameters<typeof translate>[1]) => translate(dictionary, key);
}

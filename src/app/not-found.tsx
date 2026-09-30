import Link from "next/link";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";

export default async function NotFound() {
  const dictionary = getDictionary(await readLocaleCookie());

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-950">
      <div className="w-full max-w-lg rounded-4xl border border-slate-200 bg-white p-10 text-center shadow-xl">
        <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Nexora POS</p>
        <h1 className="mt-4 text-3xl font-semibold">{translate(dictionary, "auth.notFoundTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">{translate(dictionary, "auth.notFoundBody")}</p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {translate(dictionary, "auth.goHome")}
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-4xl border border-slate-200 bg-white p-10 shadow-xl">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Multi-tenant point of sale, built for growing retail companies.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Sign in to your company workspace to manage stores, warehouses, inventory, and sales.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800"
              >
                Sign in
              </Link>
              <Link
                href="/admin/login"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-6 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Project Admin
              </Link>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              First time running this instance?{" "}
              <Link href="/setup" className="font-semibold text-slate-950 underline">
                Create the Project Admin account
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

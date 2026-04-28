import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950">
      <div className="mx-auto max-w-3xl rounded-4xl border border-slate-200 bg-white p-10 shadow-xl text-center">
        <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Page not found</p>
        <h1 className="mt-4 text-4xl font-semibold">404 — We couldn't find that page</h1>
        <p className="mt-4 text-slate-600">Return to the dashboard or login to continue managing your shops.</p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/dashboard" className="rounded-2xl bg-slate-950 px-6 py-3 text-white transition hover:bg-slate-800">
            Dashboard
          </Link>
          <Link href="/login" className="rounded-2xl border border-slate-300 px-6 py-3 text-slate-950 transition hover:bg-slate-50">
            Login
          </Link>
        </div>
      </div>
    </main>
  );
}

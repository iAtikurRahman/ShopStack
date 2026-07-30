"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/services/api";

export default function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/setup/project-admin", "POST", { name, email, password });
      router.push("/admin/companies");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
        <div className="w-full rounded-4xl border border-slate-800 bg-slate-900 p-10 shadow-xl">
          <p className="text-sm uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
          <h1 className="mt-3 text-3xl font-semibold">Create the Project Admin account</h1>
          <p className="mt-3 text-sm text-slate-400">
            This one-time setup runs only while no Project Admin exists yet. Once complete, this page
            locks itself and future sign-ins happen at /admin/login.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Password</span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </label>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Creating…" : "Create Project Admin"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

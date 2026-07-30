"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type StoreUser = { id: number; name: string; email: string; role: string; isActive: boolean };
type PermissionRow = { key: string; label: string; description: string | null; roleDefault: boolean; override: boolean | null };

const PRODUCT_PERMISSIONS = ["product.view", "product.create", "product.update", "product.delete"];

export default function StoreUsersPage() {
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(["product.view"]);

  const [permissionsForUser, setPermissionsForUser] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  async function loadUsers() {
    try {
      const data = await apiFetch<{ users: StoreUser[] }>("/api/store/users");
      setUsers(data.users);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadUsers();
    }
    load();
  }, []);

  function togglePermission(key: string) {
    setSelectedPermissions((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/store/users", "POST", { name, email, password, permissions: selectedPermissions });
      setName("");
      setEmail("");
      setPassword("");
      setSelectedPermissions(["product.view"]);
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeactivate(userId: number) {
    setError(null);
    try {
      await apiFetch(`/api/store/users/${userId}`, "DELETE");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openPermissions(userId: number) {
    setError(null);
    if (permissionsForUser === userId) {
      setPermissionsForUser(null);
      return;
    }
    try {
      const data = await apiFetch<{ permissions: PermissionRow[] }>(`/api/store/users/${userId}/permissions`);
      setPermissions(data.permissions.filter((p) => PRODUCT_PERMISSIONS.includes(p.key)));
      setPermissionsForUser(userId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setOverride(userId: number, permissionKey: string, allow: boolean | null) {
    setError(null);
    try {
      await apiFetch(`/api/store/users/${userId}/permissions`, "PUT", { overrides: [{ permissionKey, allow }] });
      setPermissions((current) => current.map((p) => (p.key === permissionKey ? { ...p, override: allow } : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Store users</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Users in your store</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : users.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No store users yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {users.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{user.name}</p>
                      <p className="text-xs text-slate-500">
                        {user.email}
                        {!user.isActive ? " · inactive" : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openPermissions(user.id)}
                        className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                      >
                        Permissions
                      </button>
                      {user.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(user.id)}
                          className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {permissionsForUser === user.id ? (
                    <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                      {permissions.map((p) => (
                        <div key={p.key} className="flex items-center justify-between text-sm">
                          <p className="text-slate-950">{p.label}</p>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setOverride(user.id, p.key, true)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                p.override === true ? "bg-emerald-600 text-white" : "bg-white text-slate-700 border border-slate-200"
                              }`}
                            >
                              Allow
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(user.id, p.key, false)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                p.override === false ? "bg-red-600 text-white" : "bg-white text-slate-700 border border-slate-200"
                              }`}
                            >
                              Deny
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(user.id, p.key, null)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                p.override === null ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200"
                              }`}
                            >
                              Default
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a store user</h2>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <div>
              <span className="text-sm font-medium text-slate-700">Product permissions</span>
              <div className="mt-2 space-y-2">
                {PRODUCT_PERMISSIONS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(key)}
                      onChange={() => togglePermission(key)}
                      className="rounded border-slate-300"
                    />
                    {key.replace("product.", "")}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Create store user
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

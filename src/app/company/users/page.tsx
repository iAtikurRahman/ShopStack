"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Role = "company_admin" | "store_manager" | "store_user";
type User = { id: number; name: string; email: string; role: Role; storeId: number | null; isActive: boolean };
type Store = { id: number; name: string };
type PermissionRow = { key: string; label: string; description: string | null; roleDefault: boolean; override: boolean | null };

export default function CompanyUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("store_user");
  const [storeId, setStoreId] = useState("");

  const [permissionsForUser, setPermissionsForUser] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  async function loadData() {
    try {
      const [usersData, storesData] = await Promise.all([
        apiFetch<{ users: User[] }>("/api/company/users"),
        apiFetch<{ stores: Store[] }>("/api/company/stores"),
      ]);
      setUsers(usersData.users);
      setStores(storesData.stores);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadData();
    }
    load();
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/users", "POST", {
        name,
        email,
        password,
        role,
        storeId: role === "company_admin" ? null : storeId,
      });
      setName("");
      setEmail("");
      setPassword("");
      setRole("store_user");
      setStoreId("");
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeactivate(userId: number) {
    setError(null);
    try {
      await apiFetch(`/api/company/users/${userId}`, "DELETE");
      await loadData();
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
      const data = await apiFetch<{ permissions: PermissionRow[] }>(`/api/company/users/${userId}/permissions`);
      setPermissions(data.permissions);
      setPermissionsForUser(userId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setOverride(userId: number, permissionKey: string, allow: boolean | null) {
    setError(null);
    try {
      await apiFetch(`/api/company/users/${userId}/permissions`, "PUT", { overrides: [{ permissionKey, allow }] });
      setPermissions((current) =>
        current.map((p) => (p.key === permissionKey ? { ...p, override: allow } : p))
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">All users</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : (
            <div className="mt-6 space-y-3">
              {users.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{user.name}</p>
                      <p className="text-xs text-slate-500">
                        {user.email} · {user.role}
                        {user.storeId ? ` · store ${user.storeId}` : ""}
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
                          <div>
                            <p className="text-slate-950">{p.label}</p>
                            <p className="text-xs text-slate-500">
                              role default: {p.roleDefault ? "allowed" : "not allowed"}
                            </p>
                          </div>
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
          <h2 className="text-lg font-semibold text-slate-950">Add a user</h2>
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
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="store_user">Store User</option>
                <option value="store_manager">Store Manager</option>
                <option value="company_admin">Company Admin</option>
              </select>
            </label>
            {role !== "company_admin" ? (
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Store</span>
                <select
                  required
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                >
                  <option value="">Select a store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Create user
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

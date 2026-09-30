"use client";

import { useEffect, useMemo, useState } from "react";
import PasswordField from "@/components/PasswordField";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Role = "company_admin" | "store_manager" | "store_user";
type User = { id: number; name: string; email: string; role: Role; storeId: number | null; isActive: boolean };
type Store = { id: number; name: string };
type PermissionRow = { key: string; label: string; description: string | null; roleDefault: boolean; override: boolean | null };

export default function CompanyUsersPage() {
  const { t, fmt } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("store_user");
  const [storeId, setStoreId] = useState("");

  const [permissionsForUser, setPermissionsForUser] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  const [passwordForUser, setPasswordForUser] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [search, setSearch] = useState("");

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
    setSuccess(null);
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
    setPasswordForUser(null);
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

  function openPassword(userId: number) {
    setError(null);
    setPasswordError(null);
    setSuccess(null);
    setNewPassword("");
    setPermissionsForUser(null);
    setPasswordForUser((current) => (current === userId ? null : userId));
  }

  async function handleResetPassword(userId: number) {
    setError(null);
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await apiFetch(`/api/company/users/${userId}/password`, "PUT", { password: newPassword });
      setNewPassword("");
      setPasswordForUser(null);
      setSuccess(t("company.users.passwordResetSuccess"));
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setSavingPassword(false);
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

  const storeNameById = useMemo(() => new Map(stores.map((s) => [s.id, s.name] as const)), [stores]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const storeName = u.storeId ? (storeNameById.get(u.storeId) ?? "") : "";
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        storeName.toLowerCase().includes(q) ||
        (u.isActive ? "active" : "inactive").includes(q)
      );
    });
  }, [users, search, storeNameById]);

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.users")}</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.users.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.users.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredUsers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.users.noMatch", { search: search.trim() })
                : t("company.users.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredUsers.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{user.name}</p>
                      <p className="text-xs text-slate-500">
                        {t("company.users.meta", { email: user.email, role: user.role })}
                        {user.storeId
                          ? ` · ${storeNameById.get(user.storeId) ?? t("company.users.storeFallback", { id: fmt.number(user.storeId) })}`
                          : ""}
                        {!user.isActive ? ` · ${t("company.users.inactiveLabel")}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openPermissions(user.id)}
                        className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                      >
                        {t("company.users.permissions")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openPassword(user.id)}
                        className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                      >
                        {t("company.users.passwordButton")}
                      </button>
                      {user.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(user.id)}
                          className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          {t("company.users.deactivate")}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {passwordForUser === user.id ? (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                      <p className="text-xs text-slate-500">{t("company.users.passwordHelper")}</p>
                      <PasswordField
                        label={t("company.users.newPassword")}
                        value={newPassword}
                        onChange={setNewPassword}
                        hint={t("company.users.passwordHint")}
                      />
                      {passwordError ? <p className="text-sm text-red-600">{passwordError}</p> : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleResetPassword(user.id)}
                          disabled={savingPassword || newPassword.length < 8}
                          className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {savingPassword ? t("common.saving") : t("company.users.setPassword")}
                        </button>
                        <button
                          type="button"
                          onClick={() => openPassword(user.id)}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {permissionsForUser === user.id ? (
                    <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                      {permissions.map((p) => (
                        <div key={p.key} className="flex items-center justify-between text-sm">
                          <div>
                            <p className="text-slate-950">{p.label}</p>
                            <p className="text-xs text-slate-500">
                              {t("company.users.roleDefault", {
                                value: p.roleDefault
                                  ? t("company.users.allowed")
                                  : t("company.users.notAllowed"),
                              })}
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
                              {t("company.users.allow")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(user.id, p.key, false)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                p.override === false ? "bg-red-600 text-white" : "bg-white text-slate-700 border border-slate-200"
                              }`}
                            >
                              {t("company.users.deny")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(user.id, p.key, null)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                p.override === null ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200"
                              }`}
                            >
                              {t("company.users.defaultOverride")}
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
          <h2 className="text-lg font-semibold text-slate-950">{t("company.users.addTitle")}</h2>
          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.name")}</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.email")}</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <PasswordField
              label={t("company.users.passwordLabel")}
              value={password}
              onChange={setPassword}
              hint={t("company.users.passwordHint")}
            />
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.users.role")}</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="store_user">{t("company.users.roleStoreUser")}</option>
                <option value="store_manager">{t("company.users.roleStoreManager")}</option>
                <option value="company_admin">{t("company.users.roleCompanyAdmin")}</option>
              </select>
            </label>
            {role !== "company_admin" ? (
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{t("nav.store")}</span>
                <select
                  required
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                >
                  <option value="">{t("company.users.selectStore")}</option>
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
              {t("company.users.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

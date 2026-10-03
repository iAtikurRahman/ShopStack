"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch, apiUpload } from "@/services/api";

type Store = {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  imageUrl: string | null;
  isActive: boolean;
  _count: { warehouses: number; users: number };
};

/**
 * The editable copy of one store, held as strings for the inputs. `image` is
 * the file just picked from disk and `clearImage` the owner asking for the
 * current one to go - neither is saved until Save is pressed, so cancelling
 * really does leave the store exactly as it was.
 */
type Draft = {
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
  image: File | null;
  clearImage: boolean;
};

function draftOf(store: Store): Draft {
  return {
    name: store.name,
    address: store.address ?? "",
    phone: store.phone ?? "",
    isActive: store.isActive,
    image: null,
    clearImage: false,
  };
}

/**
 * Blob URL for a file the user just picked from disk. There is no URL until the
 * browser makes one, and the previous one has to be handed back whenever the
 * file is replaced or the page goes away - otherwise every preview leaks for as
 * long as the tab stays open. The ref is what gets revoked; the state is only
 * what gets rendered.
 */
function useFilePreview() {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<string | null>(null);

  function show(file: File | null) {
    if (ref.current) URL.revokeObjectURL(ref.current);
    const next = file ? URL.createObjectURL(file) : null;
    ref.current = next;
    setUrl(next);
  }

  useEffect(
    () => () => {
      if (ref.current) URL.revokeObjectURL(ref.current);
    },
    []
  );

  return { url, show };
}

/** `canCreateStore` is decided on the server from the session: the API rejects a
 * store_manager on POST /api/company/stores, so the form is not offered to one
 * rather than being left to fail. */
export default function StoresClient({ canCreateStore }: { canCreateStore: boolean }) {
  const { t, tEnum, fmt } = useI18n();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [addManager, setAddManager] = useState(false);
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [search, setSearch] = useState("");

  // Only one store is ever open for editing, and `editingId` is matched against
  // the freshly loaded list - so a store that drops out of the current search
  // takes its form with it instead of stranding state nobody can see.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    const digits = q.replace(/\D/g, "");
    return stores.filter(
      (store) =>
        store.name.toLowerCase().includes(q) ||
        (store.address ?? "").toLowerCase().includes(q) ||
        (store.phone ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (store.phone ?? "").replace(/\D/g, "").includes(digits)) ||
        (store.isActive ? "active" : "inactive").includes(q)
    );
  }, [stores, search]);

  // The picked file has no URL of its own until the browser makes one, and that
  // one has to be handed back when it is replaced or the form is closed -
  // otherwise every preview leaks a blob for as long as the tab is open.
  const editPreview = useFilePreview();
  const newPreview = useFilePreview();
  const [newImage, setNewImage] = useState<File | null>(null);
  // A hidden input driven by a styled button on the create form, same trick the
  // edit form uses, so the native picker still enforces type and size.
  const newFileInput = useRef<HTMLInputElement>(null);

  async function loadStores() {
    try {
      const data = await apiFetch<{ stores: Store[] }>("/api/company/stores");
      setStores(data.stores);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadStores();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setCreating(true);
    try {
      const created = await apiFetch<{ store: Store }>("/api/company/stores", "POST", {
        name,
        address: address || null,
        phone: phone || null,
        storeManager: addManager
          ? { name: managerName, email: managerEmail, password: managerPassword }
          : undefined,
      });
      setName("");
      setAddress("");
      setPhone("");
      setAddManager(false);
      setManagerName("");
      setManagerEmail("");
      setManagerPassword("");
      setNewImage(null);
      newPreview.show(null);
      await loadStores();

      // The image is optional, and it is a second request because the picture
      // only ever changes through the /image route. It runs after the store
      // exists and the list has been reloaded, so a rejected file still leaves
      // the new store on screen instead of looking like nothing was created.
      if (newImage) {
        const form = new FormData();
        form.append("image", newImage);
        await apiUpload(`/api/company/stores/${created.store.id}/image`, form);
        await loadStores();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(store: Store) {
    setError(null);
    setSuccess(null);
    setEditingId(store.id);
    setDraft(draftOf(store));
    // Opening a different store must not leave the previous store's picked file
    // previewed on screen.
    editPreview.show(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    editPreview.show(null);
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  // A newly picked file always wins over "remove": asking to delete the current
  // picture and then choosing a replacement is a replacement, not a delete.
  function chooseImage(file: File | null) {
    patchDraft({ image: file, clearImage: false });
    editPreview.show(file);
  }

  function removeImage() {
    patchDraft({ image: null, clearImage: true });
    editPreview.show(null);
  }

  async function saveEdit(store: Store) {
    if (!draft) return;
    const editedName = draft.name.trim();
    if (!editedName) return;

    setError(null);
    setSuccess(null);
    setSavingId(store.id);
    try {
      // The picture is a separate multipart request, so it goes first: if the
      // file is rejected, the text fields are left as they were rather than
      // half-applied.
      if (draft.image) {
        const form = new FormData();
        form.append("image", draft.image);
        await apiUpload(`/api/company/stores/${store.id}/image`, form);
      } else if (draft.clearImage && store.imageUrl) {
        await apiUpload(`/api/company/stores/${store.id}/image`, new FormData(), "DELETE");
      }

      await apiFetch(`/api/company/stores/${store.id}`, "PATCH", {
        name: editedName,
        address: draft.address.trim() || null,
        phone: draft.phone.trim() || null,
        isActive: draft.isActive,
      });

      cancelEdit();
      await loadStores();
      setSuccess(t("company.stores.savedMessage", { name: tEnum(editedName) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.stores")}</h1>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.stores.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.stores.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredStores.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.stores.noMatch", { search: search.trim() })
                : t("company.stores.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredStores.map((store) => {
                const editing = editingId === store.id;
                return (
                  <div
                    key={store.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <StoreThumbnail
                        src={store.imageUrl}
                        name={tEnum(store.name)}
                        alt={t("company.stores.imageAlt", { name: tEnum(store.name) })}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          {/* A Link rather than making the whole card one: the card
                              now holds an Edit button, and a button inside a link
                              is not reachable. */}
                          <Link
                            href={`/company/stores/${store.id}/warehouses`}
                            className="truncate font-semibold text-slate-950 hover:underline"
                          >
                            {tEnum(store.name)}
                          </Link>
                          <div className="flex shrink-0 items-center gap-2">
                            {!store.isActive ? (
                              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                                {t("company.stores.inactivePill")}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => (editing ? cancelEdit() : startEdit(store))}
                              className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-white"
                            >
                              {editing ? t("common.cancel") : t("common.edit")}
                            </button>
                          </div>
                        </div>
                        {store.address ? (
                          <p className="mt-1 text-sm text-slate-600">{store.address}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-500">
                          {t("company.stores.warehouseCount", {
                            count: fmt.number(store._count.warehouses),
                          })}{" "}
                          · {t("company.stores.userCount", { count: fmt.number(store._count.users) })}
                        </p>
                      </div>
                    </div>

                    {editing && draft ? (
                      <StoreEditForm
                        store={store}
                        draft={draft}
                        previewUrl={editPreview.url}
                          saving={savingId === store.id}
                          onPatch={patchDraft}
                          onChooseImage={chooseImage}
                          onRemoveImage={removeImage}
                          onSave={() => void saveEdit(store)}
                          onCancel={cancelEdit}
                        />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {canCreateStore ? (
          <div className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{t("company.stores.addTitle")}</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              <span className="text-sm font-medium text-slate-700">{t("common.address")}</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.phone")}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <div>
              <span className="text-sm font-medium text-slate-700">
                {t("company.stores.image")}{" "}
                <span className="font-normal text-slate-400">({t("common.optional")})</span>
              </span>
              <p className="mt-1 text-xs text-slate-500">{t("company.stores.imageHint")}</p>
              <div className="mt-2 flex items-center gap-3">
                {newPreview.url ? (
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    <Image
                      src={newPreview.url}
                      alt={t("company.stores.imageAlt", { name: name || t("company.stores.addTitle") })}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={newFileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setNewImage(file);
                      newPreview.show(file);
                      // Clearing the input lets the same file be picked twice in
                      // a row - which is what happens after a rejected attempt.
                      if (file) event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => newFileInput.current?.click()}
                    className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
                  >
                    {newPreview.url ? t("company.stores.changeImage") : t("company.stores.chooseImage")}
                  </button>
                  {newPreview.url ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewImage(null);
                        newPreview.show(null);
                      }}
                      className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
                    >
                      {t("company.stores.removeImage")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={addManager}
                onChange={(e) => setAddManager(e.target.checked)}
                className="rounded border-slate-300"
              />
              {t("company.stores.alsoCreateManager")}
            </label>

            {addManager ? (
              <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerName")}
                  </span>
                  <input
                    required={addManager}
                    value={managerName}
                    onChange={(e) => setManagerName(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerEmail")}
                  </span>
                  <input
                    required={addManager}
                    type="email"
                    value={managerEmail}
                    onChange={(e) => setManagerEmail(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerPassword")}
                  </span>
                  <input
                    required={addManager}
                    type="password"
                    minLength={8}
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {creating ? t("common.saving") : t("company.stores.create")}
            </button>
          </form>
          </div>
        ) : (
          <div className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{t("company.stores.addTitle")}</h2>
            <p className="mt-3 text-sm text-slate-600">{t("company.stores.addRestricted")}</p>
          </div>
        )}
      </div>
    </main>
  );
}

function StoreThumbnail({ src, name, alt }: { src: string | null; name: string; alt: string }) {
  // Falls back to the first letter rather than a broken image, so a store
  // without a picture still looks deliberate in the list.
  if (!src) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl font-semibold text-slate-400">
        {name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <Image src={src} alt={alt} width={56} height={56} className="h-full w-full object-cover" />
    </div>
  );
}

function StoreEditForm({
  store,
  draft,
  previewUrl,
  saving,
  onPatch,
  onChooseImage,
  onRemoveImage,
  onSave,
  onCancel,
}: {
  store: Store;
  draft: Draft;
  previewUrl: string | null;
  saving: boolean;
  onPatch: (patch: Partial<Draft>) => void;
  onChooseImage: (file: File | null) => void;
  onRemoveImage: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  // A hidden input driven by a styled button, so the whole tile is the click
  // target while the native picker - and its type and size rules - still do
  // the work.
  const fileInput = useRef<HTMLInputElement>(null);

  const shownImage = previewUrl ?? (draft.clearImage ? null : store.imageUrl);

  return (
    <form
      className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div>
        <span className="text-xs font-medium text-slate-700">{t("company.stores.image")}</span>
        <p className="mt-1 text-xs text-slate-500">{t("company.stores.imageHint")}</p>
        <div className="mt-2 flex items-center gap-3">
          {shownImage ? (
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <Image
                src={shownImage}
                alt={t("company.stores.imageAlt", { name: store.name })}
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400">
              {t("company.stores.noImage")}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                onChooseImage(file);
                // Clearing the input lets the same file be picked twice in a row
                // - which is exactly what happens when a first attempt was the
                // wrong photo.
                if (file) event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              {shownImage ? t("company.stores.changeImage") : t("company.stores.chooseImage")}
            </button>
            {shownImage && !draft.clearImage ? (
              <button
                type="button"
                onClick={onRemoveImage}
                className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                {t("company.stores.removeImage")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t("common.name")}</span>
          <input
            required
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t("common.phone")}</span>
          <input
            value={draft.phone}
            onChange={(e) => onPatch({ phone: e.target.value })}
            className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-900"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-700">{t("common.address")}</span>
        <input
          value={draft.address}
          onChange={(e) => onPatch({ address: e.target.value })}
          className="mt-1 block h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-900"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => onPatch({ isActive: e.target.checked })}
          className="h-4 w-4"
        />
        {t("common.active")}
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
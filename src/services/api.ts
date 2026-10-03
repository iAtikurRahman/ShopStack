import { localizeServerMessage } from "@/lib/i18n/active-dictionary";

/**
 * Thin fetch wrapper for client components. Session is an httpOnly cookie
 * set by the server on login, so there is no client-readable token to
 * attach here - the browser sends the cookie automatically.
 */
export async function apiFetch<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // The routes answer in English; the active dictionary translates it so an
    // error reads in the same language as the rest of the page.
    throw new Error(localizeServerMessage(data?.message || "Request failed"));
  }

  return data as T;
}

/**
 * Same contract as apiFetch, but for multipart bodies. A separate function
 * because a FormData body has to go out with no Content-Type header at all -
 * setting it by hand leaves out the multipart boundary and the route then
 * reads an empty form.
 */
export async function apiUpload<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  const response = await fetch(path, { method, body: form });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(localizeServerMessage(data?.message || "Request failed"));
  }

  return data as T;
}
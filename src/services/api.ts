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
    throw new Error(data?.message || "Request failed");
  }

  return data as T;
}

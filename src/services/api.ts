export type ApiResponse<T> = {
  data: T;
};

export async function apiFetch<T>(path: string, method = "GET", body?: unknown) {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data as T;
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("shopstack_token", token);
}

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("shopstack_token");
}

export function setAuthUser(user: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem("shopstack_user", JSON.stringify(user));
}

export function getAuthUser<T = { name: string; email: string; role: string }>() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("shopstack_user");
  return raw ? (JSON.parse(raw) as T) : null;
}

export function logout() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("shopstack_token");
  localStorage.removeItem("shopstack_user");
}

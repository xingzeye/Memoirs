import type { InitialData } from "./types";

export function readInitialData(): InitialData {
  const node = document.getElementById("memoirs-initial-data");
  if (!node?.textContent) {
    return {
      page: "auth",
      session: { user: null, allowPublicRegistration: false, csrfToken: "", routes: {} },
      payload: {},
    };
  }
  return JSON.parse(node.textContent) as InitialData;
}

export function getCookie(name: string): string {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || "";
  return "";
}

export async function apiJson<T>(
  url: string,
  csrfToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken || getCookie("csrftoken"),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw data;
  }
  return data;
}

export async function apiForm<T>(url: string, csrfToken: string, formData: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-CSRFToken": csrfToken || getCookie("csrftoken"),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formData,
  });
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw data;
  }
  return data;
}

export function formatBytes(size: number): string {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

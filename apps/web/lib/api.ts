import type { ApiError } from "@hashifi/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** A failed API call: its status, stable code, message, and any per-field problems. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, string> | null,
  ) {
    super(message);
  }
}

function errorFrom(status: number, body: unknown): ApiRequestError {
  const error = (typeof body === "object" && body !== null ? body : {}) as Partial<ApiError>;
  return new ApiRequestError(
    status,
    typeof error.code === "string" ? error.code : "ERROR",
    typeof error.message === "string" ? error.message : "Something went wrong. Try again.",
    error.details ?? null,
  );
}

async function request<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    ...(body === null
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed: unknown = text === "" ? null : JSON.parse(text);
  if (!response.ok) throw errorFrom(response.status, parsed);
  return parsed as T;
}

/** The one way the web reaches the API. Response types come from `@hashifi/types`. */
export const api = {
  get: <T>(path: string) => request<T>("GET", path, null),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  delete: <T = null>(path: string) => request<T>("DELETE", path, null),
};

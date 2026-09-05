/**
 * Tiny typed API client. The CRM's API is small enough that pulling in
 * a full client generator would be over-engineering. Each function
 * returns the parsed JSON or throws an `ApiClientError` whose `code` is
 * one of the shared error codes.
 */
import type { ApiErrorBody } from '@departify-crm/shared';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly correlationId?: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.correlationId = body.correlationId;
    this.details = body.details;
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errBody: ApiErrorBody = (data && typeof data === 'object' ? data : { code: 'INTERNAL', message: res.statusText });
    throw new ApiClientError(res.status, errBody);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

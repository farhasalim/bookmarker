import type { ApiErrorBody, ErrorCode } from '@bookmarker/shared';

/** Thrown for any non-2xx API answer; carries the stable error code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin call to /api/v1 with the session cookie. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You seem to be offline. Try again in a moment.');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong');
  }
  return body as T;
}

export const fetcher = <T>(path: string) => api<T>(path);

/**
 * Should a page drop what it is showing? Yes when it never loaded, or when the
 * server says it's gone or no longer ours (401/403/404). A blip (network, 5xx)
 * during a background refresh keeps the page — and any half-typed post — in place.
 */
export function showLoadError(error: unknown, data: unknown): boolean {
  if (!error) return false;
  if (data === undefined) return true;
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

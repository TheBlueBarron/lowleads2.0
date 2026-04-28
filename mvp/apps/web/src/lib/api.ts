export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )ll_at=([^;]*)/);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export function setToken(accessToken: string, expiresIn: number): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `ll_at=${encodeURIComponent(accessToken)}; path=/; max-age=${expiresIn}; SameSite=Strict${secure}`;
}

export function clearToken(): void {
  if (typeof document === 'undefined') return;
  document.cookie = 'll_at=; path=/; max-age=0';
}

export interface JwtPayload {
  sub: string;
  role: 'company_owner' | 'technician';
  companyId: string;
  mfaVerified: boolean;
  exp: number;
  iat: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

// Collapse concurrent refreshes into one network call
let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        clearToken();
        return null;
      }
      const data = (await res.json()) as { accessToken: string; expiresIn: number };
      setToken(data.accessToken, data.expiresIn);
      return data.accessToken;
    } catch {
      clearToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
  _retry = false,
): Promise<T> {
  const token = getToken();
  const { body, headers: extraHeaders, ...restInit } = init;

  const headers: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders as Record<string, string> | undefined),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...restInit,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && !_retry) {
    const newToken = await doRefresh();
    if (newToken) return apiFetch<T>(path, init, true);
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError('UNAUTHORIZED', 'Session expired. Please log in again.', 401);
  }

  if (!res.ok) {
    let errBody: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } =
      {};
    try {
      errBody = (await res.json()) as typeof errBody;
    } catch { /* noop */ }
    throw new ApiError(
      errBody.error?.code ?? 'UNKNOWN_ERROR',
      errBody.error?.message ?? `Request failed (${res.status})`,
      res.status,
      errBody.error?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

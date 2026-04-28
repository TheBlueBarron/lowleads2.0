'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { API_URL, ApiError, clearToken, decodeJwt, getToken, setToken } from './api';

export interface AuthUser {
  sub: string;
  role: 'company_owner' | 'technician';
  companyId: string;
  mfaVerified: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string, mfaToken?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    if (token) {
      const payload = decodeJwt(token);
      if (payload && payload.exp * 1000 > Date.now()) {
        setUser({
          sub: payload.sub,
          role: payload.role,
          companyId: payload.companyId,
          mfaVerified: payload.mfaVerified,
        });
      } else {
        clearToken();
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string, mfaToken?: string) => {
      const res = await fetch(`${API_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, ...(mfaToken ? { mfaToken } : {}) }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        throw new ApiError(
          err.error?.code ?? 'UNKNOWN_ERROR',
          err.error?.message ?? 'Login failed',
          res.status,
        );
      }

      const { accessToken, expiresIn } = (await res.json()) as {
        accessToken: string;
        expiresIn: number;
      };
      setToken(accessToken, expiresIn);
      const payload = decodeJwt(accessToken);
      if (payload) {
        setUser({
          sub: payload.sub,
          role: payload.role,
          companyId: payload.companyId,
          mfaVerified: payload.mfaVerified,
        });
      }
      router.push('/');
    },
    [router],
  );

  const logout = useCallback(async () => {
    const token = getToken();
    try {
      await fetch(`${API_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
    } catch { /* best effort */ }
    clearToken();
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

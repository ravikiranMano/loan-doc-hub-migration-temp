import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login, logout, getMe, register, type AuthUser } from '@/services/auth-service/auth.service';
import { refreshSessionSilently } from '@/services/client';

export type AppRole = 'admin' | 'csr' | 'borrower' | 'broker' | 'lender' | 'other' | null;

export const EXTERNAL_ROLES: AppRole[] = ['borrower', 'broker', 'lender'];
export const INTERNAL_ROLES: AppRole[] = ['admin', 'csr'];

interface AuthContextType {
  user: AuthUser | null;
  role: AppRole;
  loading: boolean;
  isExternalUser: boolean;
  isInternalUser: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const role = (user?.role as AppRole) ?? null;
  const isExternalUser = role !== null && EXTERNAL_ROLES.includes(role);
  const isInternalUser = role !== null && INTERNAL_ROLES.includes(role);

  // Restore session on mount by calling /auth/me.
  // The access_token cookie is sent automatically by the browser.
  useEffect(() => {
    getMe()
      // Do not overwrite a user already set by login if /auth/me ran without cookies yet.
      .then((me) => setUser((current) => me ?? current))
      .finally(() => setLoading(false));
  }, []);

  // Refresh tokens when the tab regains focus after idle (prevents storage/API 401s).
  useEffect(() => {
    if (!user) return;

    let lastRefresh = Date.now();
    const MIN_REFRESH_INTERVAL_MS = 60_000;

    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) return;
      lastRefresh = Date.now();
      refreshSessionSilently().catch(() => {});
    };

    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('focus', maybeRefresh);
    };
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const authUser = await login(email, password);
      setUser(authUser);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    try {
      const authUser = await register(email, password, fullName);
      setUser(authUser);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setUser(null);
      sessionStorage.clear();
      localStorage.clear();
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, role, loading, isExternalUser, isInternalUser, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

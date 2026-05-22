import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login, logout, getMe, register, type AuthUser } from '@/services/node-api/auth.service';

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
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

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

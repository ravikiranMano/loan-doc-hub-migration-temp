import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'admin' | 'csr' | 'borrower' | 'broker' | 'lender' | 'other' | null;

export const EXTERNAL_ROLES: AppRole[] = ['borrower', 'broker', 'lender'];
export const INTERNAL_ROLES: AppRole[] = ['admin', 'csr'];

interface AuthContextType {
  user: User | null;
  session: Session | null;
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
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [loading, setLoading] = useState(true);
  const recoveringSessionRef = useRef(false);
  const manualSignOutRef = useRef(false);

  const isExternalUser = role !== null && EXTERNAL_ROLES.includes(role);
  const isInternalUser = role !== null && INTERNAL_ROLES.includes(role);

  const fetchUserRole = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error fetching role:', error);
        return null;
      }
      return data?.role as AppRole;
    } catch (error) {
      console.error('Error fetching role:', error);
      return null;
    }
  }, []);

  const applySessionState = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (nextSession?.user) {
      // Defer the role lookup out of any auth callback to avoid blocking
      // Supabase's auth event loop (documented anti-pattern) and to let the
      // shell paint immediately with the user present — role-gated content
      // fills in on the next tick instead of holding the whole UI blank.
      const uid = nextSession.user.id;
      setTimeout(() => {
        fetchUserRole(uid).then((fetchedRole) => setRole(fetchedRole));
      }, 0);
    } else {
      setRole(null);
    }
  }, [fetchUserRole]);


  const recoverSession = useCallback(async (): Promise<Session | null> => {
    if (recoveringSessionRef.current) return null;
    recoveringSessionRef.current = true;

    try {
      const { data: current, error: currentError } = await supabase.auth.getSession();
      if (!currentError && current.session?.user) {
        return current.session;
      }

      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session?.user) {
        return refreshed.session;
      }

      return null;
    } catch (error) {
      console.error('Error recovering session:', error);
      return null;
    } finally {
      recoveringSessionRef.current = false;
    }
  }, []);

  // Ref-tracked so initial getSession and the onAuthStateChange race
  // share the same de-dupe state — prevents double role fetches on cold
  // start and on every SIGNED_IN/INITIAL_SESSION event for the same user.
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const settleLoading = () => {
      if (isMounted) setLoading(false);
    };

    const applyIfNewUser = async (nextSession: Session | null) => {
      const nextId = nextSession?.user?.id ?? null;
      if (nextId && nextId === currentUserIdRef.current) {
        // Same user — just refresh the session object, skip role re-fetch.
        if (nextSession) setSession(nextSession);
        return;
      }
      currentUserIdRef.current = nextId;
      await applySessionState(nextSession);
    };

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, authSession) => {
        void (async () => {
          if (!isMounted) return;

          if (authSession?.user) {
            manualSignOutRef.current = false;
            await applyIfNewUser(authSession);
            settleLoading();
            return;
          }

          const recoveredSession = await recoverSession();
          if (recoveredSession?.user) {
            manualSignOutRef.current = false;
            await applyIfNewUser(recoveredSession);
            settleLoading();
            return;
          }

          // Clear auth state only for explicit user sign-outs.
          // Ignore transient SIGNED_OUT events caused by tab/focus/session race conditions.
          if (event === 'SIGNED_OUT' && manualSignOutRef.current) {
            manualSignOutRef.current = false;
            currentUserIdRef.current = null;
            await applySessionState(null);
          }

          settleLoading();
        })();
      }
    );

    // THEN check for existing session
    void (async () => {
      const recoveredSession = await recoverSession();
      if (!isMounted) return;
      await applyIfNewUser(recoveredSession);
      settleLoading();
    })();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applySessionState, recoverSession]);



  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    manualSignOutRef.current = true;

    // Clear all browser storage and cached data on logout
    sessionStorage.clear();
    localStorage.clear();
    await supabase.auth.signOut();
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      role, 
      loading, 
      isExternalUser,
      isInternalUser,
      signIn, 
      signUp, 
      signOut 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

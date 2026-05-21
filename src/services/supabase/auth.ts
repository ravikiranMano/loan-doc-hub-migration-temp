import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase/client';

export async function getSession() {
  return supabase.auth.getSession();
}

export async function refreshSession() {
  return supabase.auth.refreshSession();
}

export async function getUser() {
  return supabase.auth.getUser();
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string, fullName: string) {
  const redirectUrl = `${window.location.origin}/`;
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectUrl,
      data: { full_name: fullName },
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export type { User, Session, AuthChangeEvent };

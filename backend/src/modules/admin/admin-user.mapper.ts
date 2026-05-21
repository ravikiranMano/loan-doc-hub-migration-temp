/** Maps public.users rows to the legacy Supabase `profiles` response shape. */
export function toProfileCompat(user: {
  id: string;
  email?: string | null;
  full_name?: string | null;
  user_type?: string | null;
  role?: string | null;
  created_at?: Date | string | null;
  phone?: string | null;
  company?: string | null;
}) {
  return {
    user_id: user.id,
    id: user.id,
    email: user.email ?? null,
    full_name: user.full_name ?? null,
    user_type: user.user_type ?? null,
    role: user.role ?? null,
    created_at: user.created_at ?? null,
    phone: user.phone ?? null,
    company: user.company ?? null,
  };
}

export function toUserRoleCompat(user: { id: string; role: string }) {
  return { user_id: user.id, role: user.role };
}

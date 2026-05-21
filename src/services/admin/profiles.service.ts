import { supabase } from '@/services/supabase/client';

export async function fetchProfileByUserId(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchProfilesByUserIds(userIds: string[]) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .in('user_id', userIds);
  if (error) throw error;
  return data || [];
}

export async function listProfiles(options?: {
  search?: string;
  page?: number;
  pageSize?: number;
  userType?: string;
  orderBy?: { column: string; ascending?: boolean };
}) {
  let query = supabase.from('profiles').select('*', { count: 'exact' });
  if (options?.userType) {
    query = query.eq('user_type', options.userType);
  }
  if (options?.search) {
    query = query.or(
      `full_name.ilike.%${options.search}%,email.ilike.%${options.search}%`
    );
  }
  if (options?.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: options.orderBy.ascending ?? false,
    });
  }
  if (options?.page != null && options?.pageSize != null) {
    const from = (options.page - 1) * options.pageSize;
    query = query.range(from, from + options.pageSize - 1);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

export async function updateProfile(userId: string, updates: Record<string, unknown>) {
  const { error } = await supabase.from('profiles').update(updates).eq('user_id', userId);
  if (error) throw error;
}

export async function updateProfileById(id: string, updates: Record<string, unknown>) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw error;
}

export async function countProfiles() {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export type AdminManagementUser = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'csr' | null;
  created_at: string;
  permission_level: string | null;
};

/** Map public.users row to legacy profile shape. */
function mapUserRow(row: {
  id: string;
  email?: string | null;
  full_name?: string | null;
  created_at?: string | null;
  user_id?: string;
}) {
  return {
    user_id: row.user_id ?? row.id,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    created_at: row.created_at ?? '',
  };
}

export async function listUsersForManagement(): Promise<AdminManagementUser[]> {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<AdminManagementUser[]>('/admin/users/management-list');
  }
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .eq('user_type', 'internal')
    .order('email');
  if (usersError) throw usersError;
  if (!users?.length) return [];

  const userIds = users.map((u) => u.id);
  const { data: permLevels, error: permError } = await supabase
    .from('user_permission_levels')
    .select('user_id, permission_level')
    .in('user_id', userIds);
  if (permError) throw permError;

  const permMap = new Map(
    (permLevels || []).map((p) => [p.user_id, p.permission_level]),
  );

  return users.map((u) => ({
    id: u.id,
    user_id: u.id,
    email: u.email ?? '',
    full_name: u.full_name,
    created_at: u.created_at,
    role:
      u.role === 'admin' || u.role === 'csr' ? (u.role as 'admin' | 'csr') : null,
    permission_level: permMap.get(u.id) ?? null,
  }));
}

export async function assignUserRoleAndPermission(params: {
  p_user_id: string;
  p_role: 'admin' | 'csr';
  p_permission_level: string;
}): Promise<void> {
  if (isNodeApiEnabled('admin')) {
    await apiClient.post(`/admin/users/${params.p_user_id}/role`, {
      role: params.p_role,
      permission_level: params.p_permission_level,
    });
    return;
  }
  const { error: roleError } = await supabase
    .from('users')
    .update({ role: params.p_role })
    .eq('id', params.p_user_id);
  if (roleError) throw roleError;

  if (params.p_role === 'csr') {
    const { error: permError } = await supabase.from('user_permission_levels').upsert(
      {
        user_id: params.p_user_id,
        permission_level: params.p_permission_level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (permError) throw permError;
  } else {
    const { error: delError } = await supabase
      .from('user_permission_levels')
      .delete()
      .eq('user_id', params.p_user_id);
    if (delError) throw delError;
  }
}

export async function listProfilesForAdmin() {
  if (isNodeApiEnabled('admin')) {
    const result = await apiClient<
      | Array<{
          user_id?: string;
          id?: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
        }>
      | { data: Array<{
          user_id?: string;
          id?: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
        }>; count: number }
    >('/admin/users?userType=internal');
    const rows = Array.isArray(result) ? result : (result.data ?? []);
    return rows.map(({ user_id, id, email, full_name, created_at }) =>
      mapUserRow({ user_id: user_id ?? id ?? '', id: user_id ?? id ?? '', email, full_name, created_at }),
    );
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, created_at')
    .eq('user_type', 'internal')
    .order('email');
  if (error) throw error;
  return (data || []).map((row) => mapUserRow({ ...row, user_id: row.id }));
}

export async function listUserRoles() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<Array<{ user_id: string; role: string }>>('/admin/user-roles');
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('user_type', 'internal');
  if (error) throw error;
  return (data || []).map((u) => ({ user_id: u.id, role: u.role }));
}

export async function fetchUserRole(userId: string) {
  if (isNodeApiEnabled('admin')) {
    const result = await apiClient.get<{ role?: string } | null>(
      `/admin/users/${userId}/role`,
    );
    return result?.role ?? null;
  }
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data?.role ?? null;
}

export async function listUserPermissionLevels() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>('/admin/user-permission-levels');
  }
  const { data, error } = await supabase.from('user_permission_levels').select('*');
  if (error) throw error;
  return data || [];
}

export async function listRolesForUserIds(userIds: string[]) {
  if (isNodeApiEnabled('admin')) {
    if (!userIds.length) return [];
    const query = encodeURIComponent(userIds.join(','));
    return apiClient.get<Array<{ user_id: string; role: string }>>(
      `/admin/user-roles?userIds=${query}`,
    );
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, role')
    .in('id', userIds);
  if (error) throw error;
  return (data || []).map((u) => ({ user_id: u.id, role: u.role }));
}

export async function listCsrUsersForPermissions() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<
      Array<{
        user_id: string;
        email: string | null;
        full_name: string | null;
        permission_level: string;
      }>
    >('/admin/csr-users');
  }
  const { data: csrUsers, error: usersError } = await supabase
    .from('users')
    .select('id, email, full_name')
    .eq('role', 'csr');
  if (usersError) throw usersError;
  if (!csrUsers?.length) return [];

  const userIds = csrUsers.map((u) => u.id);
  const { data: permLevelData, error: permError } = await supabase
    .from('user_permission_levels')
    .select('user_id, permission_level')
    .in('user_id', userIds);
  if (permError) throw permError;

  const permMap = new Map(
    (permLevelData || []).map((p) => [p.user_id, p.permission_level]),
  );

  return csrUsers.map((u) => ({
    user_id: u.id,
    email: u.email || null,
    full_name: u.full_name || null,
    permission_level: permMap.get(u.id) || 'full',
  }));
}

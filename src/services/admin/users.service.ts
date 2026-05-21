import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
  const { error } = await supabase.rpc('assign_user_role_and_permission', params);
  if (error) throw error;
}

export async function listProfilesForAdmin() {
  if (isNodeApiEnabled('admin')) {
    const users = await apiClient.get<
      Array<{
        user_id: string;
        email: string | null;
        full_name: string | null;
        created_at: string;
        role?: string | null;
      }>
    >('/admin/users');
    return users.map(({ user_id, email, full_name, created_at }) => ({
      user_id,
      email,
      full_name,
      created_at,
    }));
  }
  const { data, error } = await supabase.from('profiles').select('*').order('email');
  if (error) throw error;
  return data || [];
}

export async function listUserRoles() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<Array<{ user_id: string; role: string }>>('/admin/user-roles');
  }
  const { data, error } = await supabase.from('user_roles').select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchUserRole(userId: string) {
  if (isNodeApiEnabled('admin')) {
    const result = await apiClient.get<{ role?: string } | null>(
      `/admin/users/${userId}/role`,
    );
    return result?.role ?? null;
  }
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data?.role;
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
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', userIds);
  if (error) throw error;
  return data || [];
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
  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'csr');
  if (roleError) throw roleError;
  if (!roleData?.length) return [];

  const userIds = roleData.map((r) => r.user_id);

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, email, full_name')
    .in('user_id', userIds);
  if (profileError) throw profileError;

  const { data: permLevelData, error: permError } = await supabase
    .from('user_permission_levels')
    .select('user_id, permission_level')
    .in('user_id', userIds);
  if (permError) throw permError;

  const permMap = new Map(
    (permLevelData || []).map((p) => [p.user_id, p.permission_level]),
  );

  return userIds.map((uid) => {
    const profile = (profileData || []).find((p) => p.user_id === uid);
    return {
      user_id: uid,
      email: profile?.email || null,
      full_name: profile?.full_name || null,
      permission_level: permMap.get(uid) || 'full',
    };
  });
}

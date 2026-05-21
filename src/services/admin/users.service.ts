import { supabase } from '@/services/supabase/client';
import { assignUserRoleAndPermission } from '@/services/supabase/rpc';

export { assignUserRoleAndPermission };

export async function listProfilesForAdmin() {
  const { data, error } = await supabase.from('profiles').select('*').order('email');
  if (error) throw error;
  return data || [];
}

export async function listUserRoles() {
  const { data, error } = await supabase.from('user_roles').select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchUserRole(userId: string) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data?.role;
}

export async function listUserPermissionLevels() {
  const { data, error } = await supabase.from('user_permission_levels').select('*');
  if (error) throw error;
  return data || [];
}

export async function listRolesForUserIds(userIds: string[]) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', userIds);
  if (error) throw error;
  return data || [];
}

export async function listCsrUsersForPermissions() {
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
    (permLevelData || []).map((p) => [p.user_id, p.permission_level])
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

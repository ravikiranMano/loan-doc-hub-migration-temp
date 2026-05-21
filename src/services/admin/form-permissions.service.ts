import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function listFormPermissions() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>('/admin/permissions/forms');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('form_permissions').select('*');
  if (error) throw error;
  return data || [];
}

export async function listUserFormPermissions(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>(`/admin/users/${userId}/form-permissions`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('user_form_permissions')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function fetchUserRoleForPermissions(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<{ role?: string } | null>(`/admin/users/${userId}/role`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchProfileForPermissions(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown>(`/admin/users/${userId}/profile`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteUserFormPermissions(userId: string, formIds: string[]) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.delete(
      `/admin/users/${userId}/form-permissions?formIds=${formIds.join(',')}`
    );
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('user_form_permissions')
    .delete()
    .eq('user_id', userId)
    .in('form_id', formIds);
  if (error) throw error;
}

export async function insertUserFormPermissions(rows: Record<string, unknown>[]) {
  if (isNodeApiEnabled('admin') && rows.length > 0) {
    const userId = rows[0]['user_id'] as string;
    const body = rows.map(({ form_key, access_mode }) => ({ form_key, access_mode }));
    return apiClient.post(`/admin/users/${userId}/form-permissions`, body);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('user_form_permissions').insert(rows);
  if (error) throw error;
}

export async function updateUserFormPermission(
  userId: string,
  formId: string,
  updates: Record<string, unknown>
) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.patch(`/admin/users/${userId}/form-permissions/${formId}`, updates);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('user_form_permissions')
    .update(updates)
    .eq('user_id', userId)
    .eq('form_id', formId);
  if (error) throw error;
}

export async function listAllUserFormPermissions() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>('/admin/user-form-permissions');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('user_form_permissions').select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchFormPermissionsByRole(role: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>(`/admin/permissions/forms?role=${role}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('form_permissions')
    .select('form_key, access_mode, screen_visible')
    .eq('role', role);
  if (error) throw error;
  return data || [];
}

export async function fetchUserFormPermissionsSummary(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>(`/admin/users/${userId}/form-permissions`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('user_form_permissions')
    .select('form_key, access_mode')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function fetchUserFormPermissionsOrdered(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>(`/admin/users/${userId}/form-permissions`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('user_form_permissions')
    .select('id, form_key, access_mode')
    .eq('user_id', userId)
    .order('form_key');
  if (error) throw error;
  return data || [];
}

export async function updateUserFormPermissionById(
  id: string,
  updates: Record<string, unknown>
) {
  if (isNodeApiEnabled('admin')) {
    const { access_mode } = updates;
    return apiClient.patch(`/admin/form-permissions/${id}`, { access_mode });
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('user_form_permissions')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

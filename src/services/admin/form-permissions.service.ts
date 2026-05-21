import { supabase } from '@/services/supabase/client';

export async function listFormPermissions() {
  const { data, error } = await supabase.from('form_permissions').select('*');
  if (error) throw error;
  return data || [];
}

export async function listUserFormPermissions(userId: string) {
  const { data, error } = await supabase
    .from('user_form_permissions')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function fetchUserRoleForPermissions(userId: string) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchProfileForPermissions(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteUserFormPermissions(userId: string, formIds: string[]) {
  const { error } = await supabase
    .from('user_form_permissions')
    .delete()
    .eq('user_id', userId)
    .in('form_id', formIds);
  if (error) throw error;
}

export async function insertUserFormPermissions(rows: Record<string, unknown>[]) {
  const { error } = await supabase.from('user_form_permissions').insert(rows);
  if (error) throw error;
}

export async function updateUserFormPermission(
  userId: string,
  formId: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase
    .from('user_form_permissions')
    .update(updates)
    .eq('user_id', userId)
    .eq('form_id', formId);
  if (error) throw error;
}

export async function listAllUserFormPermissions() {
  const { data, error } = await supabase.from('user_form_permissions').select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchFormPermissionsByRole(role: string) {
  const { data, error } = await supabase
    .from('form_permissions')
    .select('form_key, access_mode, screen_visible')
    .eq('role', role);
  if (error) throw error;
  return data || [];
}

export async function fetchUserFormPermissionsSummary(userId: string) {
  const { data, error } = await supabase
    .from('user_form_permissions')
    .select('form_key, access_mode')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function fetchUserFormPermissionsOrdered(userId: string) {
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
  const { error } = await supabase
    .from('user_form_permissions')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

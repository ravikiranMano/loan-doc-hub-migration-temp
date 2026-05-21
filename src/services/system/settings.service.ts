import { supabase } from '@/services/supabase/client';

export async function listSystemSettings() {
  const { data, error } = await supabase
    .from('system_settings')
    .select('*')
    .order('setting_key');
  if (error) throw error;
  return data || [];
}

export async function fetchSystemSettingsByKeys(keys: string[]) {
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value')
    .in('setting_key', keys);
  if (error) throw error;
  return data || [];
}

export async function updateSystemSetting(id: string, value: string | null) {
  const { error } = await supabase
    .from('system_settings')
    .update({ setting_value: value })
    .eq('id', id);
  if (error) throw error;
}

export async function insertSystemSetting(payload: Record<string, unknown>) {
  const { error } = await supabase.from('system_settings').insert(payload);
  if (error) throw error;
}

export async function deleteSystemSetting(id: string) {
  const { error } = await supabase.from('system_settings').delete().eq('id', id);
  if (error) throw error;
}

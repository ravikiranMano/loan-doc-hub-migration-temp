import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SystemSetting {
  id: string;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ─── listSystemSettings ───────────────────────────────────────────────────────

export async function listSystemSettings(): Promise<SystemSetting[]> {
  if (isNodeApiEnabled('system')) {
    return apiClient.get<SystemSetting[]>('/system/settings');
  }
  // — Supabase (keep until Node API is stable) —
  const { data, error } = await supabase
    .from('system_settings')
    .select('*')
    .order('setting_key');
  if (error) throw error;
  return data || [];
}

// ─── fetchSystemSettingsByKeys ────────────────────────────────────────────────

export async function fetchSystemSettingsByKeys(
  keys: string[],
): Promise<{ setting_key: string; setting_value: string | null }[]> {
  if (isNodeApiEnabled('system')) {
    return apiClient.get(`/system/settings?keys=${keys.join(',')}`);
  }
  // — Supabase —
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value')
    .in('setting_key', keys);
  if (error) throw error;
  return data || [];
}

// ─── updateSystemSetting ──────────────────────────────────────────────────────
// Accepts setting id (UUID) or setting_key — matches Supabase .eq('id', …).

export async function updateSystemSetting(
  idOrKey: string,
  value: string | null,
): Promise<void> {
  if (isNodeApiEnabled('system')) {
    await apiClient.patch(`/system/settings/${idOrKey}`, { setting_value: value });
    return;
  }
  // — Supabase —
  const { error } = await supabase
    .from('system_settings')
    .update({ setting_value: value })
    .eq('id', idOrKey);
  if (error) throw error;
}

// ─── insertSystemSetting ──────────────────────────────────────────────────────

export async function insertSystemSetting(
  payload: Record<string, unknown>,
): Promise<void> {
  if (isNodeApiEnabled('system')) {
    await apiClient.post('/system/settings', payload);
    return;
  }
  // — Supabase —
  const { error } = await supabase.from('system_settings').insert(payload);
  if (error) throw error;
}

// ─── deleteSystemSetting ──────────────────────────────────────────────────────

export async function deleteSystemSetting(idOrKey: string): Promise<void> {
  if (isNodeApiEnabled('system')) {
    await apiClient.delete(`/system/settings/${idOrKey}`);
    return;
  }
  // — Supabase —
  const { error } = await supabase
    .from('system_settings')
    .delete()
    .eq('id', idOrKey);
  if (error) throw error;
}

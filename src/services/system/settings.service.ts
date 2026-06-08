import { apiClient } from '@/services/client';

export interface SystemSetting {
  id: string;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSystemSettings(): Promise<SystemSetting[]> {
  return apiClient.get<SystemSetting[]>('/system/settings');
}

export async function fetchSystemSettingsByKeys(
  keys: string[],
): Promise<{ setting_key: string; setting_value: string | null }[]> {
  return apiClient.get(`/system/settings?keys=${keys.join(',')}`);
}

export async function updateSystemSetting(
  idOrKey: string,
  value: string | null,
): Promise<void> {
  await apiClient.patch(`/system/settings/${idOrKey}`, { setting_value: value });
}

export async function insertSystemSetting(payload: Record<string, unknown>): Promise<void> {
  await apiClient.post('/system/settings', payload);
}

export async function deleteSystemSetting(idOrKey: string): Promise<void> {
  await apiClient.delete(`/system/settings/${idOrKey}`);
}

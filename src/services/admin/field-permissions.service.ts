import type { AppRole } from '@/contexts/AuthContext';
import { apiClient } from '@/services/client';

export interface FieldPermission {
  field_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface FieldVisibility {
  field_key: string;
  allowed_roles: string[];
  read_only_roles: string[];
  is_calculated: boolean;
}

export async function fetchFieldVisibility(): Promise<Map<string, FieldVisibility>> {
  try {
    const data = await apiClient.get<FieldVisibility[]>('/admin/fields');
    return new Map(
      (data || []).map((fv) => [
        fv.field_key,
        {
          field_key: fv.field_key,
          allowed_roles: fv.allowed_roles || ['admin', 'csr'],
          read_only_roles: fv.read_only_roles || [],
          is_calculated: fv.is_calculated,
        },
      ]),
    );
  } catch (error) {
    console.error('Error fetching field visibility:', error);
    return new Map();
  }
}

export async function fetchFieldPermissions(role: AppRole): Promise<Map<string, FieldPermission>> {
  const data = await apiClient.get<FieldPermission[]>(`/admin/permissions/fields?role=${role}`);
  return new Map((data || []).map((fp) => [fp.field_key, fp]));
}

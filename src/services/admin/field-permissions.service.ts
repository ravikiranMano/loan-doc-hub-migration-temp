import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';
import type { AppRole } from '@/contexts/AuthContext';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
    if (isNodeApiEnabled('admin')) {
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
        ])
      );
    }
    // — Supabase (keep unchanged) —
    const data = await fetchAllRows((client) =>
      client
        .from('field_dictionary')
        .select('field_key, allowed_roles, read_only_roles, is_calculated')
    );
    return new Map(
      data.map((fv: FieldVisibility) => [
        fv.field_key,
        {
          field_key: fv.field_key,
          allowed_roles: fv.allowed_roles || ['admin', 'csr'],
          read_only_roles: fv.read_only_roles || [],
          is_calculated: fv.is_calculated,
        },
      ])
    );
  } catch (error) {
    console.error('Error fetching field visibility:', error);
    return new Map();
  }
}

export async function fetchFieldPermissions(role: AppRole): Promise<Map<string, FieldPermission>> {
  if (isNodeApiEnabled('admin')) {
    const data = await apiClient.get<FieldPermission[]>(`/admin/permissions/fields?role=${role}`);
    return new Map((data || []).map((fp) => [fp.field_key, fp]));
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_permissions')
    .select('field_key, can_view, can_edit')
    .eq('role', role!);

  if (error) {
    console.error('Error fetching field permissions:', error);
    return new Map();
  }

  return new Map((data || []).map((fp) => [fp.field_key, fp]));
}

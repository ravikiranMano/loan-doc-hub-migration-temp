import { apiClient } from '@/services/node-api/client';

export async function listFormPermissions() {
  return apiClient.get<unknown[]>('/admin/permissions/forms');
}

function adminUserPath(userId: string) {
  return `/admin/users/${encodeURIComponent(userId)}`;
}

export async function listUserFormPermissions(userId: string) {
  return apiClient.get<unknown[]>(`${adminUserPath(userId)}/form-permissions`);
}

export async function fetchUserRoleForPermissions(userId: string) {
  return apiClient.get<{ role?: string } | null>(`${adminUserPath(userId)}/role`);
}

export async function fetchProfileForPermissions(userId: string) {
  return apiClient.get<unknown>(`${adminUserPath(userId)}/profile`);
}

export async function deleteUserFormPermissions(userId: string, formIds: string[]) {
  return apiClient.delete(
    `${adminUserPath(userId)}/form-permissions?formIds=${encodeURIComponent(formIds.join(','))}`,
  );
}

export async function insertUserFormPermissions(rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const userId = rows[0]['user_id'] as string;
  const body = rows.map(({ form_key, access_mode }) => ({ form_key, access_mode }));
  return apiClient.post(`${adminUserPath(userId)}/form-permissions`, body);
}

export async function updateUserFormPermission(
  userId: string,
  formId: string,
  updates: Record<string, unknown>,
) {
  return apiClient.patch(
    `${adminUserPath(userId)}/form-permissions/${encodeURIComponent(formId)}`,
    updates,
  );
}

export async function listAllUserFormPermissions() {
  return apiClient.get<unknown[]>('/admin/user-form-permissions');
}

export async function fetchFormPermissionsByRole(role: string) {
  return apiClient.get<unknown[]>(`/admin/permissions/forms?role=${role}`);
}

export async function fetchUserFormPermissionsSummary(userId: string) {
  return apiClient.get<unknown[]>(`${adminUserPath(userId)}/form-permissions`);
}

export async function fetchUserFormPermissionsOrdered(userId: string) {
  return apiClient.get<unknown[]>(`${adminUserPath(userId)}/form-permissions`);
}

export async function updateUserFormPermissionById(id: string, updates: Record<string, unknown>) {
  const { access_mode } = updates;
  return apiClient.patch(`/admin/form-permissions/${id}`, { access_mode });
}

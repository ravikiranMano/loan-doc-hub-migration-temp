import { apiClient } from '@/services/node-api/client';

export type AdminManagementUser = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'csr' | null;
  created_at: string;
  permission_level: string | null;
};

function mapUserRow(row: {
  id: string;
  email?: string | null;
  full_name?: string | null;
  created_at?: string | null;
  user_id?: string;
}) {
  return {
    user_id: row.user_id ?? row.id,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    created_at: row.created_at ?? '',
  };
}

export async function listUsersForManagement(): Promise<AdminManagementUser[]> {
  return apiClient.get<AdminManagementUser[]>('/admin/users/management-list');
}

export async function assignUserRoleAndPermission(params: {
  p_user_id: string;
  p_role: 'admin' | 'csr';
  p_permission_level: string;
}): Promise<void> {
  await apiClient.post(`/admin/users/${params.p_user_id}/role`, {
    role: params.p_role,
    permission_level: params.p_permission_level,
  });
}

export async function listProfilesForAdmin() {
  const result = await apiClient.get<
    | Array<{
        user_id?: string;
        id?: string;
        email: string | null;
        full_name: string | null;
        created_at: string;
      }>
    | {
        data: Array<{
          user_id?: string;
          id?: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
        }>;
        count: number;
      }
  >('/admin/users?userType=internal');
  const rows = Array.isArray(result) ? result : (result.data ?? []);
  return rows.map(({ user_id, id, email, full_name, created_at }) =>
    mapUserRow({
      user_id: user_id ?? id ?? '',
      id: user_id ?? id ?? '',
      email,
      full_name,
      created_at,
    }),
  );
}

export async function listUserRoles() {
  return apiClient.get<Array<{ user_id: string; role: string }>>('/admin/user-roles');
}

export async function fetchUserRole(userId: string) {
  const result = await apiClient.get<{ role?: string } | null>(`/admin/users/${userId}/role`);
  return result?.role ?? null;
}

export async function listUserPermissionLevels() {
  return apiClient.get<unknown[]>('/admin/user-permission-levels');
}

export async function listRolesForUserIds(userIds: string[]) {
  if (!userIds.length) return [];
  const query = encodeURIComponent(userIds.join(','));
  return apiClient.get<Array<{ user_id: string; role: string }>>(
    `/admin/user-roles?userIds=${query}`,
  );
}

export async function listCsrUsersForPermissions() {
  return apiClient.get<
    Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      permission_level: string;
    }>
  >('/admin/csr-users');
}

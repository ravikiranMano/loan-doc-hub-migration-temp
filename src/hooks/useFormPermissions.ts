import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchFormPermissionsByRole,
  fetchUserFormPermissionsSummary,
  fetchUserFormPermissionsOrdered,
  insertUserFormPermissions,
  updateUserFormPermissionById,
} from '@/services/admin/form-permissions.service';
import { isNodeApiEnabled } from '@/services/node-api/client';
import { listUserRoles } from '@/services/admin/users.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import { useAuth } from '@/contexts/AuthContext';

export interface FormPermission {
  form_key: string;
  access_mode: 'editable' | 'view_only';
  screen_visible: boolean;
}

const FORM_KEYS = [
  'borrower',
  'co_borrower',
  'property',
  'loan_terms',
  'lender',
  'broker',
  'charges',
  'notes',
  'insurance',
  'liens',
  'origination',
  'trust_ledger',
  'participants',
];

// Module-level cache so repeated mounts (e.g. opening contact detail pages
// or workspace tabs) reuse the resolved permissions instantly and don't
// flicker fields from disabled→enabled on each navigation.
type RoleKey = string;
const permissionsCache = new Map<RoleKey, FormPermission[]>();
const inflightRequests = new Map<RoleKey, Promise<FormPermission[]>>();
const cacheSubscribers = new Set<() => void>();

const cacheKeyFor = (role: string | null | undefined, userId: string | null) =>
  `${role ?? 'none'}::${userId ?? 'anon'}`;

const notifySubscribers = () => {
  cacheSubscribers.forEach(fn => fn());
};

async function loadPermissions(role: string, userId: string): Promise<FormPermission[]> {
  if (role === 'csr') {
    const data = await fetchUserFormPermissionsSummary(userId);
    return (data || []).map((d: any) => ({
      form_key: d.form_key,
      access_mode: d.access_mode as 'editable' | 'view_only',
      screen_visible: true,
    }));
  }
  if (role === 'admin') {
    return [];
  }
  const data = await fetchFormPermissionsByRole(role);
  return (data || []) as unknown as FormPermission[];
}

export function useFormPermissions() {
  const { role, user } = useAuth();
  const userId = user?.id ?? null;
  const key = cacheKeyFor(role, userId);
  const cached = permissionsCache.get(key);

  const [permissions, setPermissions] = useState<FormPermission[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === undefined);

  const fetchPermissions = useCallback(async (
    currentRole: typeof role,
    currentUserId: string | null,
    force = false
  ) => {
    const k = cacheKeyFor(currentRole, currentUserId);
    if (!currentRole || !currentUserId) {
      permissionsCache.set(k, []);
      setPermissions([]);
      setLoading(false);
      return;
    }

    // Serve from cache instantly when available — no loading flicker.
    if (!force && permissionsCache.has(k)) {
      setPermissions(permissionsCache.get(k)!);
      setLoading(false);
      return;
    }

    try {
      setLoading(permissionsCache.has(k) ? false : true);
      let promise = inflightRequests.get(k);
      if (!promise) {
        promise = loadPermissions(currentRole, currentUserId)
          .finally(() => inflightRequests.delete(k));
        inflightRequests.set(k, promise);
      }
      const result = await promise;
      permissionsCache.set(k, result);
      setPermissions(result);
      notifySubscribers();
    } catch (err) {
      console.error('Error fetching form permissions:', err);
      permissionsCache.set(k, []);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sub = () => {
      const fresh = permissionsCache.get(key);
      if (fresh) setPermissions(fresh);
    };
    cacheSubscribers.add(sub);
    void fetchPermissions(role, userId);
    return () => {
      cacheSubscribers.delete(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, fetchPermissions]);

  const isFormViewOnly = (formKey: string): boolean => {
    if (role === 'admin') return false;
    const perm = permissions.find(p => p.form_key === formKey);
    if (!perm) return true;
    return perm.access_mode === 'view_only';
  };

  const isFormEditable = (formKey: string): boolean => {
    if (role === 'admin') return true;
    const perm = permissions.find(p => p.form_key === formKey);
    if (!perm) return false;
    return perm.access_mode === 'editable';
  };

  return {
    permissions,
    loading,
    isFormViewOnly,
    isFormEditable,
    refetch: () => fetchPermissions(role, userId, true),
  };
}

const adminPermInflight = new Map<string, Promise<void>>();

// Hook for admin to manage per-user form permissions
export function useFormPermissionsAdmin() {
  const [csrUsers, setCsrUsers] = useState<Array<{ user_id: string; full_name: string | null; email: string | null }>>([]);
  const [userPermissions, setUserPermissions] = useState<Array<{ id: string; form_key: string; access_mode: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [permLoading, setPermLoading] = useState(false);
  const selectedUserRef = useRef<string>('');

  // Fetch all CSR users
  useEffect(() => {
    const fetchCsrUsers = async () => {
      try {
        setLoading(true);
        const roles = await listUserRoles();
        const userIds = (roles || [])
          .filter((r: any) => r.role === 'csr')
          .map((r: any) => r.user_id);
        if (userIds.length === 0) {
          setCsrUsers([]);
          setLoading(false);
          return;
        }

        const profiles = await fetchProfilesByUserIds(userIds);

        setCsrUsers((profiles || []).map((p: any) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          email: p.email,
        })));
      } catch (err) {
        console.error('Error fetching CSR users:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCsrUsers();
  }, []);

  // Fetch permissions for a specific user; auto-seed missing forms (single round-trip on Node API).
  const fetchUserPermissions = useCallback(async (userId: string) => {
    if (!userId) return;

    const inflight = adminPermInflight.get(userId);
    if (inflight) return inflight;

    const job = (async () => {
      try {
        setPermLoading(true);
        let data = await fetchUserFormPermissionsOrdered(userId);

        // Supabase path: client-side seed (Node API seeds on GET in admin.service).
        if (!isNodeApiEnabled('admin')) {
          const existingKeys = new Set((data || []).map((d: { form_key: string }) => d.form_key));
          const missingKeys = FORM_KEYS.filter((fk) => !existingKeys.has(fk));
          if (missingKeys.length > 0) {
            await insertUserFormPermissions(
              missingKeys.map((fk) => ({
                user_id: userId,
                form_key: fk,
                access_mode: 'view_only',
              })),
            );
            data = await fetchUserFormPermissionsOrdered(userId);
          }
        }

        if (selectedUserRef.current === userId) {
          setUserPermissions((data || []) as Array<{ id: string; form_key: string; access_mode: string }>);
        }
      } catch (err) {
        console.error('Error fetching user permissions:', err);
      } finally {
        if (selectedUserRef.current === userId) {
          setPermLoading(false);
        }
        adminPermInflight.delete(userId);
      }
    })();

    adminPermInflight.set(userId, job);
    return job;
  }, []);

  const setSelectedUserId = useCallback((userId: string) => {
    selectedUserRef.current = userId;
  }, []);

  // Update a single permission
  const updatePermission = async (id: string, accessMode: 'editable' | 'view_only') => {
    await updateUserFormPermissionById(id, {
      access_mode: accessMode,
      updated_at: new Date().toISOString(),
    });
  };

  // Keep legacy exports for backward compat
  const allPermissions: any[] = [];
  const ensureLevelPermissions = async (_level: string) => {};

  return {
    csrUsers,
    userPermissions,
    loading,
    permLoading,
    fetchUserPermissions,
    setSelectedUserId,
    updatePermission,
    // Legacy compat
    allPermissions,
    ensureLevelPermissions,
    refetch: () => {},
  };
}

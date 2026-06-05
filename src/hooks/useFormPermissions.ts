import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchFormPermissionsByRole,
  fetchUserFormPermissionsSummary,
  fetchUserFormPermissionsOrdered,
  updateUserFormPermissionById,
} from '@/services/admin/form-permissions.service';

import { listCsrUsersForPermissions } from '@/services/admin/users.service';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

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
  const [csrLoadError, setCsrLoadError] = useState<string | null>(null);
  const selectedUserRef = useRef<string>('');
  const { toast } = useToast();

  // Fetch all CSR users
  useEffect(() => {
    const fetchCsrUsers = async () => {
      try {
        setLoading(true);
        setCsrLoadError(null);
        const users = await listCsrUsersForPermissions();
        const sorted = [...users].sort((a, b) => {
          const nameA = a.full_name || a.email || '';
          const nameB = b.full_name || b.email || '';
          return nameA.localeCompare(nameB);
        });
        setCsrUsers(
          sorted.map((u) => ({
            user_id: u.user_id,
            full_name: u.full_name,
            email: u.email,
          })),
        );
      } catch (err) {
        console.error('Error fetching CSR users:', err);
        setCsrUsers([]);
        const message =
          err instanceof Error ? err.message : 'Failed to load CSR users';
        setCsrLoadError(message);
        toast({
          title: 'Error',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };
    fetchCsrUsers();
  }, [toast]);

  // Fetch permissions for a specific user; auto-seed missing forms (single round-trip on Node API).
  const fetchUserPermissions = useCallback(async (userId: string) => {
    if (!userId) return;

    const inflight = adminPermInflight.get(userId);
    if (inflight) return inflight;

    const job = (async () => {
      try {
        setPermLoading(true);
        const data = await fetchUserFormPermissionsOrdered(userId);

        if (selectedUserRef.current === userId) {
          setUserPermissions((data || []) as Array<{ id: string; form_key: string; access_mode: string }>);
        }
      } catch (err) {
        console.error('Error fetching user permissions:', err);
        if (selectedUserRef.current === userId) {
          setUserPermissions([]);
          toast({
            title: 'Error',
            description:
              err instanceof Error ? err.message : 'Failed to load form permissions',
            variant: 'destructive',
          });
        }
      } finally {
        if (selectedUserRef.current === userId) {
          setPermLoading(false);
        }
        adminPermInflight.delete(userId);
      }
    })();

    adminPermInflight.set(userId, job);
    return job;
  }, [toast]);

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
    csrLoadError,
    fetchUserPermissions,
    setSelectedUserId,
    updatePermission,
    // Legacy compat
    allPermissions,
    ensureLevelPermissions,
    refetch: () => {},
  };
}

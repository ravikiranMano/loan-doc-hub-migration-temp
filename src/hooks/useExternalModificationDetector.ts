/**
 * External Modification Detector Hook
 * 
 * Detects when external users have modified deal fields.
 * Used by CSR to display warning banners before generating documents.
 * 
 * Optimized: Uses batch queries instead of N+1 loop.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getUser } from '@/services/supabase/auth';
import { fetchUserRole } from '@/services/admin/users.service';
import { listRolesForUserIds } from '@/services/admin/users.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import { fetchFieldDictionaryKeysByIds } from '@/services/admin/field-dictionary.service';
import { fetchSectionValuesByDeal } from '@/services/deals/section-values.service';
import {
  fetchLastExternalDataReview,
  insertActivityLog,
} from '@/services/system/activity-log.service';
import { useFieldDictionaryCacheOptional } from '@/hooks/useFieldDictionaryCache';

interface ExternalModification {
  field_dictionary_id: string;
  field_key: string;
  updated_by: string;
  updated_at: string;
  updater_role: string;
  updater_name: string | null;
}

interface UseExternalModificationDetectorReturn {
  hasExternalModifications: boolean;
  externalModifications: ExternalModification[];
  loading: boolean;
  lastReviewedAt: string | null;
  markAsReviewed: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Hook to detect if external users have modified deal fields since last CSR review
 * @param dealId - The deal to check
 * @param enabled - When false, skip fetching (for inactive workspace tabs)
 */
export function useExternalModificationDetector(
  dealId: string,
  enabled: boolean = true
): UseExternalModificationDetectorReturn {
  const [externalModifications, setExternalModifications] = useState<ExternalModification[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastReviewedAt, setLastReviewedAt] = useState<string | null>(null);
  const cache = useFieldDictionaryCacheOptional();
  const hasLoadedRef = useRef(false);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const fetchModifications = useCallback(async () => {
    if (!dealId || !enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data: { user } } = await getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const userRole = await fetchUserRole(user.id);

      if (!userRole || !['csr', 'admin'].includes(userRole)) {
        setLoading(false);
        return;
      }

      const lastReviewActivity = await fetchLastExternalDataReview(dealId);
      const reviewedAt = lastReviewActivity?.created_at || null;
      setLastReviewedAt(reviewedAt);

      const sectionValues = await fetchSectionValuesByDeal(dealId);

      const currentCache = cacheRef.current;
      let fieldDictMap: Map<string, string>;
      if (currentCache && !currentCache.loading) {
        fieldDictMap = new Map<string, string>();
        currentCache.entriesById.forEach((entry, id) => {
          fieldDictMap.set(id, entry.field_key);
        });
      } else {
        const allFieldDictIds: string[] = [];
        ((sectionValues || []) as any[]).forEach((sv) => {
          Object.keys(sv.field_values || {}).forEach(id => {
            const actualId = id.includes('::') ? id.split('::')[1] : id;
            if (!allFieldDictIds.includes(actualId)) allFieldDictIds.push(actualId);
          });
        });

        const fieldDictEntries = await fetchFieldDictionaryKeysByIds(allFieldDictIds);
        fieldDictMap = new Map<string, string>();
        (fieldDictEntries || []).forEach((fd: any) => fieldDictMap.set(fd.id, fd.field_key));
      }

      const allUpdaterIds = new Set<string>();
      for (const sv of (sectionValues || []) as any[]) {
        for (const [, data] of Object.entries(sv.field_values || {}) as [string, any][]) {
          if (data?.updated_by) {
            allUpdaterIds.add(data.updated_by);
          }
        }
      }

      if (allUpdaterIds.size === 0) {
        setExternalModifications([]);
        setLoading(false);
        return;
      }

      const allRoles = await listRolesForUserIds(Array.from(allUpdaterIds));
      const roleMap = new Map<string, string>();
      (allRoles || []).forEach((r: any) => roleMap.set(r.user_id, r.role));

      const externalUserIds = Array.from(allUpdaterIds).filter(uid => {
        const role = roleMap.get(uid);
        return role && ['borrower', 'broker', 'lender'].includes(role);
      });

      let profileMap = new Map<string, string | null>();
      if (externalUserIds.length > 0) {
        const profiles = await fetchProfilesByUserIds(externalUserIds);
        (profiles || []).forEach((p: any) => profileMap.set(p.user_id, p.full_name));
      }

      const modifications: ExternalModification[] = [];
      for (const sv of (sectionValues || []) as any[]) {
        for (const [storageKey, data] of Object.entries(sv.field_values || {}) as [string, any][]) {
          if (!data?.updated_by) continue;

          const updaterRole = roleMap.get(data.updated_by);
          const isExternal = updaterRole && ['borrower', 'broker', 'lender'].includes(updaterRole);

          if (isExternal) {
            if (!reviewedAt || new Date(data.updated_at) > new Date(reviewedAt)) {
              const actualId = storageKey.includes('::') ? storageKey.split('::')[1] : storageKey;
              const fieldKey = fieldDictMap.get(actualId) || actualId;
              modifications.push({
                field_dictionary_id: actualId,
                field_key: fieldKey,
                updated_by: data.updated_by,
                updated_at: data.updated_at,
                updater_role: updaterRole,
                updater_name: profileMap.get(data.updated_by) || null,
              });
            }
          }
        }
      }

      setExternalModifications(modifications);
    } catch (error) {
      console.error('Error fetching external modifications:', error);
    } finally {
      setLoading(false);
    }
  }, [dealId, enabled]);

  useEffect(() => {
    if (!dealId || !enabled) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    fetchModifications();
  }, [dealId, enabled, fetchModifications]);

  const markAsReviewed = async (): Promise<boolean> => {
    try {
      const { data: { user } } = await getUser();
      if (!user) return false;

      await insertActivityLog({
        deal_id: dealId,
        actor_user_id: user.id,
        action_type: 'ExternalDataReviewed',
        action_details: {
          fieldsReviewed: externalModifications.length,
          fieldKeys: externalModifications.map(m => m.field_key),
        },
      });

      setExternalModifications([]);
      setLastReviewedAt(new Date().toISOString());
      
      return true;
    } catch (error) {
      console.error('Error marking as reviewed:', error);
      return false;
    }
  };

  return {
    hasExternalModifications: externalModifications.length > 0,
    externalModifications,
    loading,
    lastReviewedAt,
    markAsReviewed,
    refresh: fetchModifications,
  };
}

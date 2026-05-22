/**
 * Field Dictionary Cache
 * 
 * Provides a single app-level fetch of field_dictionary data,
 * shared across all useDealFields, useFieldPermissions, and
 * useExternalModificationDetector instances.
 */

import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { fetchAllFieldDictionary } from '@/services/admin/field-dictionary.service';
import type { FieldVisibility } from '@/lib/accessControl';
import type { Database } from '@/integrations/supabase/types';

type FieldSection = Database['public']['Enums']['field_section'];
type FieldDataType = Database['public']['Enums']['field_data_type'];

export interface CachedFieldDictEntry {
  id: string;
  field_key: string;
  label: string;
  section: FieldSection;
  data_type: FieldDataType;
  description: string | null;
  default_value: string | null;
  is_calculated: boolean;
  is_repeatable: boolean;
  validation_rule: string | null;
  calculation_formula: string | null;
  calculation_dependencies: string[] | null;
  allowed_roles: string[] | null;
  read_only_roles: string[] | null;
}

interface FieldDictionaryCacheState {
  /** All field dictionary entries keyed by id */
  entriesById: Map<string, CachedFieldDictEntry>;
  /** All field dictionary entries keyed by field_key */
  entriesByKey: Map<string, CachedFieldDictEntry>;
  /** Field visibility map keyed by field_key */
  visibilityMap: Map<string, FieldVisibility>;
  /** Raw array of all entries */
  allEntries: CachedFieldDictEntry[];
  /** Whether the cache is still loading */
  loading: boolean;
}

const FieldDictionaryCacheContext = createContext<FieldDictionaryCacheState | null>(null);

export const FieldDictionaryCacheProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<FieldDictionaryCacheState>({
    entriesById: new Map(),
    entriesByKey: new Map(),
    visibilityMap: new Map(),
    allEntries: [],
    loading: true,
  });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const loadCache = async () => {
      try {
        const data = await fetchAllFieldDictionary();

        const entries = (data || []) as CachedFieldDictEntry[];
        const byId = new Map<string, CachedFieldDictEntry>();
        const byKey = new Map<string, CachedFieldDictEntry>();
        const visMap = new Map<string, FieldVisibility>();

        entries.forEach((entry) => {
          byId.set(entry.id, entry);
          byKey.set(entry.field_key, entry);
          visMap.set(entry.field_key, {
            field_key: entry.field_key,
            allowed_roles: entry.allowed_roles || ['admin', 'csr'],
            read_only_roles: entry.read_only_roles || [],
            is_calculated: entry.is_calculated,
          });
        });

        setState({
          entriesById: byId,
          entriesByKey: byKey,
          visibilityMap: visMap,
          allEntries: entries,
          loading: false,
        });
      } catch (error) {
        console.error('Error loading field dictionary cache:', error);
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    loadCache();
  }, []);

  return React.createElement(
    FieldDictionaryCacheContext.Provider,
    { value: state },
    children
  );
};

/**
 * Hook to consume the field dictionary cache.
 * Must be used within FieldDictionaryCacheProvider.
 */
export const useFieldDictionaryCache = (): FieldDictionaryCacheState => {
  const context = useContext(FieldDictionaryCacheContext);
  if (!context) {
    throw new Error('useFieldDictionaryCache must be used within FieldDictionaryCacheProvider');
  }
  return context;
};

/**
 * Optional version that returns null when not inside a provider.
 */
export const useFieldDictionaryCacheOptional = (): FieldDictionaryCacheState | null => {
  return useContext(FieldDictionaryCacheContext);
};

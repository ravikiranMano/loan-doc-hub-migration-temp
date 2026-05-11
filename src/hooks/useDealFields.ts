import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEventJournalLogger, type FieldChange } from '@/hooks/useEventJournal';
import { useToast } from '@/hooks/use-toast';
import { useFieldDictionaryCacheOptional } from '@/hooks/useFieldDictionaryCache';
import { resolveLegacyKey, resolveDbKeyToLegacy, DB_KEY_TO_LEGACY } from '@/lib/legacyKeyMap';
import { 
  resolvePacketFields,
  resolveAllFields,
  getMissingRequiredFields as getResolverMissingFields,
  isSectionComplete as isResolverSectionComplete,
  SECTION_ORDER,
  type ResolvedField,
  type ResolvedFieldSet 
} from '@/lib/requiredFieldsResolver';
import { 
  computeCalculatedFields as runCalculations,
  mergeCalculatedValues,
  type CalculatedField,
  type CalculationResult
} from '@/lib/calculationEngine';
import { fetchAllRows } from '@/lib/supabasePagination';
import type { Database } from '@/integrations/supabase/types';

type FieldSection = Database['public']['Enums']['field_section'];
type FieldDataType = Database['public']['Enums']['field_data_type'];

// Re-export types for convenience
export type { ResolvedField as FieldDefinition, ResolvedFieldSet };

export interface FieldValue {
  field_dictionary_id: string;
  field_key: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: any | null;
}

export interface DealFieldsData {
  fields: ResolvedField[];
  fieldsBySection: Record<FieldSection, ResolvedField[]>;
  sections: FieldSection[];
  values: Record<string, string>;
  visibleFieldKeys: string[];
  requiredFieldKeys: string[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  isDirty: boolean;
  dirtyFieldKeys: Set<string>;
}

export interface UseDealFieldsReturn extends DealFieldsData {
  updateValue: (fieldKey: string, value: string, isRequiredField?: boolean) => void;
  removeValuesByPrefix: (prefix: string) => void;
  saveDraft: (options?: { silent?: boolean }) => Promise<boolean>;
  getValidationErrors: (section?: FieldSection) => string[];
  getMissingRequiredFields: (section?: FieldSection) => ResolvedField[];
  isSectionComplete: (section: FieldSection) => boolean;
  isPacketComplete: () => boolean;
  computeCalculatedFields: () => Record<string, string>;
  calculationResults: Record<string, CalculationResult>;
  calculatedFields: CalculatedField[];
  hasRequiredFieldChanged: () => boolean;
  resetDirty: () => void;
  refetchData: () => Promise<void>;
}

// JSONB field value structure
interface JsonbFieldValue {
  indexed_key?: string; // Preserves the indexed key (e.g., "lender1.first_name") for multi-entity support
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: any | null;
  updated_at: string;
  updated_by: string | null;
}

// Charge field UI-to-dictionary mapping
// Maps UI field keys (charge.date_of_charge) to dictionary keys (charge_date)
const CHARGE_UI_TO_DICT: Record<string, string> = {
  // Core charge fields
  'charge.date_of_charge': 'charge_date',
  'charge.description': 'charge_description',
  'charge.interest_rate': 'charge_interest_rate',
  'charge.interest_from': 'charge_interest_start_date',
  'charge.reference': 'charge_reference',
  'charge.charge_type': 'charge_type',
  'charge.notes': 'charge_notes',
  'charge.original_amount': 'charge_original_amount',
  'charge.deferred': 'charge_is_deferred',
  'charge.owed_from': 'charge_owed_from',
  'charge.department': 'charge_department',
  'charge.category': 'charge_category',
  'charge.details': 'charge_details',
  'charge.current_balance': 'charge_current_balance',
  'charge.balance_due_as_of': 'charge_balance_due_as_of',
  'charge.balance_due': 'charge_balance_due',
  // Additional charge fields
  'charge.accrued_interest': 'charge_accrued_interest',
  'charge.unpaid_balance': 'charge_unpaid_balance',
  'charge.total_due': 'charge_total_due',
  'charge.owed_to': 'charge_owed_to',
  'charge.account': 'charge_account',
  'charge.borrower_full_name': 'charge_borrower_full_name',
  'charge.distribute_between_all_lenders': 'charge_distribute_between_all_lenders',
  // Distribution fields
  'charge.advanced_by_account': 'charge_advanced_by_account',
  'charge.advanced_by_lender_name': 'charge_advanced_by_lender_name',
  'charge.advanced_by_amount': 'charge_advanced_by_amount',
  'charge.advanced_by_deferred': 'charge_advanced_by_deferred',
  'charge.advanced_by_total': 'charge_advanced_by_total',
  'charge.on_behalf_of_account': 'charge_on_behalf_of_account',
  'charge.on_behalf_of_lender_name': 'charge_on_behalf_of_lender_name',
  'charge.on_behalf_of_amount': 'charge_on_behalf_of_amount',
  'charge.on_behalf_of_billing': 'charge_on_behalf_of_billing',
  'charge.on_behalf_of_total': 'charge_on_behalf_of_total',
  'charge.amount_owed_by_borrower': 'charge_amount_owed_by_borrower',
};

// Reverse mapping for loading (dictionary key -> UI key)
const CHARGE_DICT_TO_UI: Record<string, string> = Object.fromEntries(
  Object.entries(CHARGE_UI_TO_DICT).map(([ui, dict]) => [dict, ui])
);

// Maps charge field keys between UI format and dictionary format
function mapChargeFieldKey(canonicalKey: string, toDict: boolean): string {
  if (toDict) {
    // UI -> Dictionary (e.g., charge.date_of_charge -> charge_date)
    return CHARGE_UI_TO_DICT[canonicalKey] || canonicalKey;
  } else {
    // Dictionary -> UI (e.g., charge_date -> charge.date_of_charge)
    return CHARGE_DICT_TO_UI[canonicalKey] || canonicalKey;
  }
}

// Extracts canonical key from indexed key
// e.g., "lender1.first_name" -> "lender.first_name"
// e.g., "borrower2.address.city" -> "borrower.address.city"
// e.g., "charge1.date_of_charge" -> "charge.date_of_charge"
//
// IMPORTANT:
// - Borrower/Lender/Broker/Co-Borrower sections store dictionary keys as non-indexed (borrower.*, lender.*)
// - Property keys in the dictionary are primarily defined under property1.*
//   so we normalize propertyN.* -> property1.* for consistent lookup.
// - Charge keys use a different format in the dictionary (charge_date vs charge.date_of_charge)
function getCanonicalKey(indexedKey: string): string {
  const stripped = indexedKey
    .replace(/^(borrower)\d+\./, '$1.')
    .replace(/^(coborrower)\d+\./, 'coborrower.')
    .replace(/^(co_borrower)\d+\./, 'co_borrower.')
    .replace(/^(lender)\d+\./, '$1.')
    .replace(/^property\d+\./, 'property1.')
    .replace(/^(broker)\d+\./, 'broker.')
    .replace(/^(charge)\d+\./, 'charge.')
    .replace(/^(lien)\d+\./, 'lien.')
    .replace(/^(insurance)\d+\./, 'insurance.')
    .replace(/^(propertytax)\d+\./, 'propertytax.')
    .replace(/^(notes_entry)\d+\./, 'notes_entry.')
    .replace(/^(loan_trust_ledger)\d+\./, 'loan_trust_ledger.')
    .replace(/^(trust_ledger)\d+\./, 'trust_ledger.');
  // Inline co-borrower keys (borrower.coborrower.X) -> coborrower.X for dictionary lookup
  return stripped
    .replace(/^borrower\.coborrower\./, 'coborrower.')
    .replace(/^borrower\.co_borrower\./, 'co_borrower.');
}

// Extract indexed prefix from field key (e.g., "borrower1.first_name" -> "borrower1", "charge1.date_of_charge" -> "charge1")
function getIndexedPrefix(fieldKey: string): string | null {
  const match = fieldKey.match(/^(borrower\d+|coborrower\d+|co_borrower\d+|lender\d+|property\d+|broker\d+|charge\d+|lien\d+|insurance\d+|propertytax\d+|notes_entry\d+|loan_trust_ledger\d+|trust_ledger\d+)\./);
  return match ? match[1] : null;
}

// Generate composite storage key for JSONB to support multi-entity fields
// Returns "{prefix}::{fieldDictId}" for indexed fields, or just "{fieldDictId}" for non-indexed
function getStorageKey(fieldKey: string, fieldDictId: string): string {
  const prefix = getIndexedPrefix(fieldKey);
  return prefix ? `${prefix}::${fieldDictId}` : fieldDictId;
}

// Parse composite storage key back to components
function parseStorageKey(storageKey: string): { prefix: string | null; fieldDictId: string } {
  if (storageKey.includes('::')) {
    const [prefix, fieldDictId] = storageKey.split('::');
    return { prefix, fieldDictId };
  }
  return { prefix: null, fieldDictId: storageKey };
}

// Map field data types to value columns
function getValueFromRecord(record: FieldValue, dataType: FieldDataType): string {
  switch (dataType) {
    case 'number':
    case 'currency':
    case 'percentage':
      return record.value_number?.toString() || '';
    case 'date':
      return record.value_date || '';
    case 'boolean':
      return record.value_text || '';
    default:
      return record.value_text || '';
  }
}

// Format a raw numeric value as US currency display (comma-separated, 2 decimal places).
function formatCurrencyForDisplay(value: string): string {
  if (!value) return '';
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return value;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Extract typed value from JSONB structure
function extractTypedValueFromJsonb(fieldData: JsonbFieldValue, dataType: FieldDataType): string {
  switch (dataType) {
    case 'currency': {
      const raw = fieldData.value_number?.toString() || fieldData.value_text || '';
      // Return raw numeric value (e.g. "1234.00") — UI components handle display formatting
      if (!raw) return '';
      const num = parseFloat(raw.replace(/,/g, ''));
      if (isNaN(num)) return raw;
      return num.toFixed(2);
    }
    case 'number':
      return fieldData.value_number?.toString() || fieldData.value_text || '';
    case 'percentage': {
      const raw = fieldData.value_number?.toString() || fieldData.value_text || '';
      if (!raw) return '';
      const num = parseFloat(raw.replace(/,/g, ''));
      return isNaN(num) ? raw : num.toFixed(2);
    }
    case 'date':
      return fieldData.value_date || fieldData.value_text || '';
    case 'boolean':
      return fieldData.value_text || '';
    default:
      return fieldData.value_text || '';
  }
}

// --- sessionStorage helpers for unsaved values cache ---
const SESSION_CACHE_PREFIX = 'deal-values-';

function getSessionCacheKey(dealId: string): string {
  return `${SESSION_CACHE_PREFIX}${dealId}`;
}

interface SessionCache {
  unsavedValues: Record<string, string>;
  dirtyKeys: string[];
}

function readSessionCache(dealId: string): SessionCache | null {
  try {
    const raw = sessionStorage.getItem(getSessionCacheKey(dealId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionCache;
  } catch {
    return null;
  }
}

function writeSessionCache(dealId: string, unsavedValues: Record<string, string>, dirtyKeys: string[]): void {
  try {
    if (dirtyKeys.length === 0) {
      sessionStorage.removeItem(getSessionCacheKey(dealId));
      return;
    }
    const cache: SessionCache = { unsavedValues, dirtyKeys };
    sessionStorage.setItem(getSessionCacheKey(dealId), JSON.stringify(cache));
  } catch {
    // sessionStorage full or unavailable — non-blocking
  }
}

function clearSessionCache(dealId: string): void {
  try {
    sessionStorage.removeItem(getSessionCacheKey(dealId));
  } catch {
    // non-blocking
  }
}

export function useDealFields(dealId: string, packetId: string | null, active: boolean = true): UseDealFieldsReturn {
  const { toast } = useToast();
  const cache = useFieldDictionaryCacheOptional();
  const [resolvedFields, setResolvedFields] = useState<ResolvedFieldSet | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldDataTypes, setFieldDataTypes] = useState<Record<string, FieldDataType>>({});
  const [fieldIdMap, setFieldIdMap] = useState<Record<string, string>>({}); // field_key -> field_dictionary_id
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [dirtyFieldKeys, setDirtyFieldKeys] = useState<Set<string>>(new Set());
  const [requiredFieldChanged, setRequiredFieldChanged] = useState(false);
  const [deletedPrefixes, setDeletedPrefixes] = useState<string[]>([]);
  const isFetchingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const valuesRef = useRef<Record<string, string>>({});
  const savedValuesSnapshotRef = useRef<Record<string, string>>({});
  const { logFieldChanges } = useEventJournalLogger();

  // Fetch resolved fields and values - deferred until active
  useEffect(() => {
    if (!dealId || !active) return;
    if (hasLoadedRef.current) return; // Already loaded
    hasLoadedRef.current = true;
    fetchData();
  }, [dealId, packetId, active]);

  const fetchData = async () => {
    // Guard against concurrent fetches
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      setLoading(true);
      setError(null);

      // Use cached field dictionary entries if available
      const cachedEntries = (cache && !cache.loading && cache.allEntries.length > 0)
        ? cache.allEntries
        : undefined;

      // 1. Resolve fields - use packet fields if packet exists, otherwise all fields
      const resolved = packetId 
        ? await resolvePacketFields(packetId, cachedEntries)
        : await resolveAllFields(cachedEntries);

      // UI: Ensure all standard sections render as tabs when they exist in field_dictionary,
      // even if they are not mapped in TemplateFieldMap for the active packet.
      // NOTE: Required-field logic remains driven by TemplateFieldMap (resolved.requiredFieldKeys).
      const TMO_TAB_SECTIONS: FieldSection[] = [
        'borrower',
        'co_borrower',
        'property',
        'loan_terms',
        'lender',
        'broker',
        'charges',
        'dates',
        'escrow',
        'origination_fees',
        'insurance',
        'liens',
        'participants',
        'notes',
        'seller',
        'title',
        'other',
      ];

      // Sections whose fields should be merged into nearest appropriate tab
      const MERGE_INTO_OTHER: FieldSection[] = ['participants', 'title', 'liens', 'other'];

      let mergedResolved = resolved;
      try {
        // Use cache if available, otherwise fetch
        let tmoFields: any[];
        if (cache && !cache.loading && cache.allEntries.length > 0) {
          tmoFields = cache.allEntries.filter((e: any) => TMO_TAB_SECTIONS.includes(e.section));
        } else {
          tmoFields = await fetchAllRows((client) =>
            client
              .from('field_dictionary')
              .select(
                'id, field_key, label, section, data_type, description, default_value, is_calculated, is_repeatable, validation_rule, calculation_formula, calculation_dependencies'
              )
              .in('section', TMO_TAB_SECTIONS as any)
          );
        }

        const existingIds = new Set(resolved.fields.map(f => f.field_dictionary_id));
        const existingKeys = new Set(resolved.fields.map(f => f.field_key));

        const appendedFields: ResolvedField[] = (tmoFields || [])
          .filter((fd: any) => fd?.id && fd?.field_key)
          .filter((fd: any) => !existingIds.has(fd.id) && !existingKeys.has(fd.field_key))
          .map((fd: any) => ({
            field_dictionary_id: fd.id,
            field_key: fd.field_key,
            label: fd.label,
            section: fd.section,
            data_type: fd.data_type,
            description: fd.description,
            default_value: fd.default_value,
            is_calculated: !!fd.is_calculated,
            is_repeatable: !!fd.is_repeatable,
            validation_rule: fd.validation_rule,
            is_required: false,
            is_mandatory: !!fd.is_mandatory,
            form_type: fd.form_type || 'primary',
            transform_rules: [],
            calculation_formula: fd.calculation_formula || null,
            calculation_dependencies: fd.calculation_dependencies || [],
          }));

        if (appendedFields.length > 0) {
          // Merge fields
          const mergedFields = [...resolved.fields, ...appendedFields];

          // Rebuild groups, remapping MERGE_INTO_OTHER sections into 'notes'
          const mergedFieldsBySection = mergedFields.reduce((acc, field) => {
            const displaySection = MERGE_INTO_OTHER.includes(field.section) ? 'notes' as FieldSection : field.section;
            (acc[displaySection] ||= []).push(field);
            return acc;
          }, {} as Record<FieldSection, ResolvedField[]>);

          // Use TMO_TAB_SECTIONS order for consistent tab display
          // Filter out merged sections and only show sections that have fields
          const mergedSections = TMO_TAB_SECTIONS.filter(
            (s) => !MERGE_INTO_OTHER.includes(s) && (mergedFieldsBySection[s]?.length || 0) > 0
          );

          mergedResolved = {
            ...resolved,
            visibleFieldIds: [...new Set([...resolved.visibleFieldIds, ...appendedFields.map(f => f.field_dictionary_id)])],
            visibleFieldKeys: [...new Set([...resolved.visibleFieldKeys, ...appendedFields.map(f => f.field_key)])],
            fields: mergedFields,
            fieldsBySection: mergedFieldsBySection,
            sections: mergedSections,
          };
        }
      } catch (e) {
        // Non-blocking: if the dictionary lookup fails, fall back to the packet-resolved set
        console.warn('Unable to load additional TMO tab sections from field_dictionary:', e);
      }

      // Remap participants/title fields into 'notes' for the final resolved set
      const finalFieldsBySection = { ...mergedResolved.fieldsBySection } as Record<FieldSection, ResolvedField[]>;
      for (const mergeSection of MERGE_INTO_OTHER) {
        if (finalFieldsBySection[mergeSection]?.length) {
          finalFieldsBySection['notes'] = [...(finalFieldsBySection['notes'] || []), ...finalFieldsBySection[mergeSection]];
          delete finalFieldsBySection[mergeSection];
        }
      }
      const finalSections = SECTION_ORDER.filter(
        (s) => (finalFieldsBySection[s]?.length || 0) > 0
      );
      mergedResolved = {
        ...mergedResolved,
        fieldsBySection: finalFieldsBySection,
        sections: finalSections,
      };

      setResolvedFields(mergedResolved);

      // Build data type and ID lookup maps
      // Maps both DB keys (br_p_firstName) AND legacy keys (borrower.first_name) to dictionary IDs
      const dataTypeMap: Record<string, FieldDataType> = {};
      const idMap: Record<string, string> = {};
      mergedResolved.fields.forEach(f => {
        // Primary mapping: DB field_key -> dictionary ID
        dataTypeMap[f.field_key] = f.data_type;
        idMap[f.field_key] = f.field_dictionary_id;
        
        // Also map the legacy dot-notation key (if one exists) so UI lookups work
        const legacyKey = resolveDbKeyToLegacy(f.field_key);
        if (legacyKey !== f.field_key) {
          dataTypeMap[legacyKey] = f.data_type;
          idMap[legacyKey] = f.field_dictionary_id;
        }
      });
      setFieldDataTypes(dataTypeMap);
      setFieldIdMap(idMap);

      // 2. Fetch existing field values for this deal from deal_section_values
      if (mergedResolved.visibleFieldKeys.length > 0) {
        const { data: sectionValues, error: svError } = await supabase
          .from('deal_section_values')
          .select('section, field_values')
          .eq('deal_id', dealId);

        if (svError) throw svError;

        // Create lookup map from field_dictionary_id to field metadata
        const fieldDictIdToMeta = new Map<string, { field_key: string; data_type: FieldDataType }>();
        mergedResolved.fields.forEach(f => {
          fieldDictIdToMeta.set(f.field_dictionary_id, { field_key: f.field_key, data_type: f.data_type });
        });

        // Fallback: some persisted values (like Loan > Trust Ledger dynamic rows) may exist in
        // deal_section_values even when their field definitions were not part of the packet-resolved
        // field set. Load those field_dictionary rows on demand so saved values hydrate correctly.
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const missingFieldDictIds = Array.from(new Set(
          ((sectionValues || []) as any[]).flatMap((sv: any) =>
            Object.keys(sv.field_values || {}).map((storageKey) => parseStorageKey(storageKey).fieldDictId)
          )
        )).filter((fieldDictId) => fieldDictId && UUID_REGEX.test(fieldDictId) && !fieldDictIdToMeta.has(fieldDictId));

        if (missingFieldDictIds.length > 0) {
          try {
            const { data: fallbackFieldRows, error: fallbackFieldError } = await supabase
              .from('field_dictionary')
              .select('id, field_key, data_type')
              .in('id', missingFieldDictIds as any);

            if (fallbackFieldError) {
              console.warn('[useDealFields] Fallback field_dictionary lookup failed:', fallbackFieldError);
            } else {
              (fallbackFieldRows || []).forEach((row: any) => {
                if (row?.id && row?.field_key && row?.data_type) {
                  fieldDictIdToMeta.set(row.id, {
                    field_key: row.field_key,
                    data_type: row.data_type,
                  });
                }
              });
            }
          } catch (e) {
            console.warn('[useDealFields] Fallback field_dictionary lookup threw:', e);
          }
        }

        // Build values map - parse JSONB field_values with composite key support
        // Composite keys are formatted as "{prefix}::{fieldDictId}" for multi-entity fields
        // Falls back to indexed_key property for backward compatibility
        const valuesMap: Record<string, string> = {};
        ((sectionValues || []) as any[]).forEach((sv) => {
          const fieldValues = sv.field_values || {};
          const isChargeSection = sv.section === 'charges';
          
          Object.entries(fieldValues).forEach(([storageKey, fieldData]: [string, any]) => {
            const { prefix, fieldDictId } = parseStorageKey(storageKey);
            const fieldMeta = fieldDictIdToMeta.get(fieldDictId);
            
            if (fieldMeta && fieldData) {
              const value = extractTypedValueFromJsonb(fieldData as JsonbFieldValue, fieldMeta.data_type);
              if (value) {
                // Priority: 1) indexed_key property, 2) reconstruct from prefix, 3) canonical field_key
                let keyToUse = (fieldData as JsonbFieldValue).indexed_key;
                if (!keyToUse && prefix) {
                  // Reconstruct indexed key from prefix and canonical field key
                  // First, resolve the DB field_key to legacy dot-notation if possible
                  const legacyFieldKey = resolveDbKeyToLegacy(fieldMeta.field_key);
                  
                  // For charge fields, we need to reverse-map dictionary keys to UI format
                  if (isChargeSection && prefix.startsWith('charge')) {
                    const uiCanonicalKey = mapChargeFieldKey(fieldMeta.field_key, false);
                    if (uiCanonicalKey.startsWith('charge.')) {
                      const fieldSuffix = uiCanonicalKey.replace(/^charge\./, '');
                      keyToUse = `${prefix}.${fieldSuffix}`;
                    } else if (legacyFieldKey.startsWith('charge.')) {
                      const fieldSuffix = legacyFieldKey.replace(/^charge\./, '');
                      keyToUse = `${prefix}.${fieldSuffix}`;
                    } else {
                      keyToUse = `${prefix}.${fieldMeta.field_key}`;
                    }
                  } else if (legacyFieldKey !== fieldMeta.field_key) {
                    // DB key has a legacy equivalent - use the legacy format for UI compatibility
                    // e.g., DB key "br_p_firstName" -> legacy "borrower.first_name"
                    // Extract the suffix after the entity prefix (borrower., lender., etc.)
                    const entityPrefixMatch = legacyFieldKey.match(/^(borrower|coborrower|co_borrower|lender|property\d*|broker|lien|insurance|propertytax|notes_entry)\.(.*)/);
                    if (entityPrefixMatch) {
                      keyToUse = `${prefix}.${entityPrefixMatch[2]}`;
                    } else {
                      // Non-entity legacy key (e.g., ach.bank_name, loan_terms.loan_amount)
                      keyToUse = legacyFieldKey;
                    }
                  } else {
                    // No legacy mapping - use DB field_key with prefix
                    const canonicalField = fieldMeta.field_key.replace(/^(borrower|coborrower|co_borrower|lender|property\d*|broker|lien|insurance|propertytax|notes_entry)\./, '');
                    keyToUse = `${prefix}.${canonicalField}`;
                  }
                }
                // For non-indexed keys, also translate DB key to legacy if possible
                if (!keyToUse) {
                  const legacyFieldKey = resolveDbKeyToLegacy(fieldMeta.field_key);
                  keyToUse = legacyFieldKey; // Will be the same as field_key if no mapping exists
                }
                const existingValue = valuesMap[keyToUse];
                if (keyToUse === 'loan_terms.funding_records' && existingValue) {
                  try {
                    const existingCount = Array.isArray(JSON.parse(existingValue)) ? JSON.parse(existingValue).length : 0;
                    const nextCount = Array.isArray(JSON.parse(value)) ? JSON.parse(value).length : 0;
                    if (nextCount >= existingCount) valuesMap[keyToUse] = value;
                  } catch {
                    valuesMap[keyToUse] = value;
                  }
                } else {
                  valuesMap[keyToUse] = value;
                }
              }
            }
          });
        });

        // Apply default values for fields without values
        mergedResolved.fields.forEach(field => {
          if (!valuesMap[field.field_key] && field.default_value) {
            valuesMap[field.field_key] = field.default_value;
          }
        });

        // Snapshot reflects DB + defaults (canonical "saved" state)
        savedValuesSnapshotRef.current = { ...valuesMap };

        // Always load clean: ignore any session cache to prevent phantom
        // dirty state from key-format mismatches between cache and snapshot.
        clearSessionCache(dealId);
        setValues(valuesMap);
        valuesRef.current = valuesMap;
        setDirtyFieldKeys(new Set());
        setIsDirty(false);
      }
    } catch (err: any) {
      console.error('Error fetching deal fields:', err);
      setError(err.message || 'Failed to load fields');
      toast({
        title: 'Error',
        description: 'Failed to load deal fields',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  const updateValue = useCallback((fieldKey: string, value: string, isRequiredField?: boolean) => {
    setValues(prev => {
      const next = { ...prev, [fieldKey]: value };
      valuesRef.current = next;

      // Update sessionStorage cache with current unsaved state
      const savedValue = savedValuesSnapshotRef.current[fieldKey] ?? '';
      const newIsDirty = value !== savedValue;

      setDirtyFieldKeys(prevDirty => {
        const nextDirty = new Set(prevDirty);
        if (newIsDirty) {
          nextDirty.add(fieldKey);
        } else {
          nextDirty.delete(fieldKey);
        }

        // Build unsaved values object (only dirty keys)
        const unsavedValues: Record<string, string> = {};
        nextDirty.forEach(k => {
          unsavedValues[k] = k === fieldKey ? value : (next[k] ?? '');
        });
        writeSessionCache(dealId, unsavedValues, [...nextDirty]);

        if (nextDirty.size === 0) setIsDirty(false);
        else setIsDirty(true);
        return nextDirty;
      });

      return next;
    });
    
    // Track if a required field was changed
    if (isRequiredField || resolvedFields?.requiredFieldKeys.includes(fieldKey)) {
      setRequiredFieldChanged(true);
    }
  }, [resolvedFields, dealId]);

  // Remove all values with a given prefix (e.g., "borrower2") from state and persist deletion to backend
  const removeValuesByPrefix = useCallback(async (prefix: string) => {
    // Capture deleted values for event journal logging before removing
    const deletedFields: FieldChange[] = [];
    const currentValues = { ...values };
    Object.keys(currentValues).forEach(key => {
      if (key.startsWith(`${prefix}.`) && currentValues[key]) {
        deletedFields.push({
          fieldLabel: key,
          oldValue: currentValues[key],
          newValue: '(deleted)',
        });
      }
    });

    setValues(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        if (key.startsWith(`${prefix}.`)) {
          delete updated[key];
        }
      });
      return updated;
    });
    setDeletedPrefixes(prev => [...prev, prefix]);
    setIsDirty(true);

    // Log deletion to event journal
    if (deletedFields.length > 0) {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          // Determine section from prefix (e.g., "borrower1" -> "borrower", "lender2" -> "lender")
          const sectionMatch = prefix.match(/^([a-z_]+)\d*$/);
          const section = sectionMatch ? sectionMatch[1] : 'unknown';
          await logFieldChanges(dealId, section, [{
            fieldLabel: `${prefix} (Bulk Delete)`,
            oldValue: `${deletedFields.length} field(s)`,
            newValue: '(deleted)',
          }], currentUser.id);
        }
      } catch (err) {
        console.error('Error logging deletion to event journal:', err);
      }
    }

    // Update sessionStorage cache: remove keys with this prefix
    setDirtyFieldKeys(prev => {
      const next = new Set(prev);
      for (const key of prev) {
        if (key.startsWith(`${prefix}.`)) {
          next.delete(key);
        }
      }
      // Rebuild unsaved cache without the deleted prefix keys
      const cachedData = readSessionCache(dealId);
      if (cachedData) {
        const unsaved = { ...cachedData.unsavedValues };
        Object.keys(unsaved).forEach(k => {
          if (k.startsWith(`${prefix}.`)) delete unsaved[k];
        });
        writeSessionCache(dealId, unsaved, [...next]);
      }
      return next;
    });

    // Immediately persist the deletion to backend by cleaning JSONB storage
    try {
      const { data: allSections, error: fetchError } = await supabase
        .from('deal_section_values')
        .select('id, section, field_values, version')
        .eq('deal_id', dealId);

      if (fetchError) throw fetchError;

      for (const sv of (allSections || [])) {
        const existingFieldValues = (sv.field_values as unknown as Record<string, JsonbFieldValue>) || {};
        let modified = false;

        Object.keys(existingFieldValues).forEach(storageKey => {
          // Check composite key prefix (e.g., "borrower2::uuid")
          const { prefix: keyPrefix } = parseStorageKey(storageKey);
          if (keyPrefix && keyPrefix === prefix) {
            delete existingFieldValues[storageKey];
            modified = true;
          }
          // Also check indexed_key inside the value
          const val = existingFieldValues[storageKey];
          if (val?.indexed_key && val.indexed_key.startsWith(`${prefix}.`)) {
            delete existingFieldValues[storageKey];
            modified = true;
          }
        });

        if (modified) {
          await supabase
            .from('deal_section_values')
            .update({
              field_values: JSON.parse(JSON.stringify(existingFieldValues)),
              updated_at: new Date().toISOString(),
              version: (sv.version || 0) + 1,
            })
            .eq('id', sv.id);
        }
      }

      toast({
        title: 'Deleted',
        description: 'Record deleted successfully',
      });
    } catch (err: any) {
      console.error('Error persisting deletion:', err);
      toast({
        title: 'Error',
        description: 'Failed to persist deletion',
        variant: 'destructive',
      });
    }
  }, [dealId, toast]);

  // Memoize calculated fields list
  const calculatedFieldsList = useMemo((): CalculatedField[] => {
    if (!resolvedFields) return [];
    return resolvedFields.fields
      .filter(f => f.is_calculated && f.calculation_formula)
      .map(f => ({
        field_key: f.field_key,
        calculation_formula: f.calculation_formula!,
        calculation_dependencies: f.calculation_dependencies,
        data_type: f.data_type,
      }));
  }, [resolvedFields]);

  // Store calculation results
  const [calculationResults, setCalculationResults] = useState<Record<string, CalculationResult>>({});

  const computeCalculatedFields = useCallback((): Record<string, string> => {
    if (!resolvedFields || calculatedFieldsList.length === 0) return values;
    
    // Run the calculation engine
    const results = runCalculations(calculatedFieldsList, values);
    setCalculationResults(results);
    
    // Merge computed values — only update state if values actually changed
    const newValues = mergeCalculatedValues(values, results);
    const hasChanges = Object.keys(newValues).length !== Object.keys(values).length ||
      Object.keys(newValues).some(k => newValues[k] !== values[k]);
    if (hasChanges) {
      setValues(newValues);
    }
    
    return newValues;
  }, [resolvedFields, calculatedFieldsList, values]);

  const saveDraft = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    const silent = options?.silent === true;

    try {
      setSaving(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Compute calculated fields before saving using the latest in-memory values
      const latestValues = valuesRef.current;
      const finalValues = resolvedFields && calculatedFieldsList.length > 0
        ? (() => {
            const results = runCalculations(calculatedFieldsList, latestValues);
            setCalculationResults(results);
            return mergeCalculatedValues(latestValues, results);
          })()
        : latestValues;

      // Get all field keys that have values
      const fieldKeysToSave = Object.keys(finalValues).filter(key => 
        finalValues[key] !== undefined && finalValues[key] !== ''
      );

      // Group values by section and build JSONB structure
      if (fieldKeysToSave.length > 0) {
        // ---- Fallback dictionary lookup (ensures we can always persist even if packet-resolved fields are incomplete)
        const candidateKeys = new Set<string>();
        for (const fieldKey of fieldKeysToSave) {
          const canonical = getCanonicalKey(fieldKey);
          candidateKeys.add(fieldKey);
          candidateKeys.add(canonical);
          // Also add the DB-convention key via legacy translation
          const dbKey = resolveLegacyKey(canonical);
          if (dbKey !== canonical) candidateKeys.add(dbKey);
          // For charge fields, also add the dictionary-format key
          if (canonical.startsWith('charge.')) {
            candidateKeys.add(mapChargeFieldKey(canonical, true));
          }
        }

        const keysMissingFromMap = [...candidateKeys].filter(k => !fieldIdMap[k]);
        const fallbackMetaByKey = new Map<string, { id: string; section: FieldSection; data_type: FieldDataType }>();

        if (keysMissingFromMap.length > 0) {
          const { data: fallbackRows, error: fbError } = await supabase
            .from('field_dictionary')
            .select('id, field_key, section, data_type')
            .in('field_key', keysMissingFromMap as any);

          if (fbError) throw fbError;

          (fallbackRows || []).forEach((r: any) => {
            if (r?.field_key && r?.id && r?.section && r?.data_type) {
              fallbackMetaByKey.set(r.field_key, {
                id: r.id,
                section: r.section,
                data_type: r.data_type,
              });
              // Also map back to legacy key for easier lookup
              const legacyKey = resolveDbKeyToLegacy(r.field_key);
              if (legacyKey !== r.field_key) {
                fallbackMetaByKey.set(legacyKey, {
                  id: r.id,
                  section: r.section,
                  data_type: r.data_type,
                });
              }
            }
          });
        }

        // Build section -> field_dictionary_id -> value object mapping
        const sectionUpdates: Record<string, Record<string, JsonbFieldValue>> = {};

        for (const fieldKey of fieldKeysToSave) {
          // Get canonical key for dictionary lookup (lender1.first_name -> lender.first_name)
          const canonicalKey = getCanonicalKey(fieldKey);
          
          // Translate legacy canonical key to DB key (borrower.first_name -> br_p_firstName)
          const dbMappedKey = resolveLegacyKey(canonicalKey);
          
          // For charge fields, also try the dictionary-format key (charge.date_of_charge -> charge_date)
          const dictMappedKey = canonicalKey.startsWith('charge.') 
            ? mapChargeFieldKey(canonicalKey, true) 
            : null;

          const fallbackMeta = fallbackMetaByKey.get(canonicalKey) 
            || fallbackMetaByKey.get(fieldKey) 
            || (dbMappedKey !== canonicalKey ? fallbackMetaByKey.get(dbMappedKey) : null)
            || (dictMappedKey ? fallbackMetaByKey.get(dictMappedKey) : null);
          const fieldDictId = fieldIdMap[canonicalKey] 
            || fieldIdMap[fieldKey] 
            || (dbMappedKey !== canonicalKey ? fieldIdMap[dbMappedKey] : null)
            || (dictMappedKey ? fieldIdMap[dictMappedKey] : null)
            || fallbackMeta?.id;
          if (!fieldDictId) {
            console.warn(`[useDealFields] Skipping field "${fieldKey}" (canonical: "${canonicalKey}") — no field_dictionary match found. Data for this key will NOT be persisted.`);
            continue;
          }

          // Prefer resolvedFields for section/type; fall back to dictionary lookup when not present
          const field = resolvedFields?.fields.find(
            f => f.field_key === canonicalKey || f.field_key === fieldKey || f.field_key === dbMappedKey || (dictMappedKey && f.field_key === dictMappedKey)
          );

          const section = field?.section || fallbackMeta?.section;
          if (!section) continue;

          if (!sectionUpdates[section]) {
            sectionUpdates[section] = {};
          }

          const dataType = (fieldDataTypes[canonicalKey] || fieldDataTypes[fieldKey] || fallbackMeta?.data_type || 'text') as FieldDataType;
          const stringValue = finalValues[fieldKey];

          // Build the JSONB field value object
          // Store indexed_key to preserve the full key (e.g., "lender1.first_name") for multi-entity support
          const fieldValueObj: JsonbFieldValue = {
            indexed_key: fieldKey !== canonicalKey ? fieldKey : undefined, // Only store if different from canonical
            value_text: null,
            value_number: null,
            value_date: null,
            value_json: null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          };

          switch (dataType) {
            case 'number':
            case 'currency':
            case 'percentage': {
              const numValue = parseFloat(stringValue.replace(/[,$]/g, ''));
              fieldValueObj.value_number = isNaN(numValue) ? null : numValue;
              break;
            }
            case 'date':
              fieldValueObj.value_date = stringValue || null;
              break;
            case 'boolean':
              fieldValueObj.value_text = stringValue;
              break;
            default:
              fieldValueObj.value_text = stringValue;
          }

          // Use composite storage key for multi-entity fields to prevent overwrites
          const storageKey = getStorageKey(fieldKey, fieldDictId);
          sectionUpdates[section][storageKey] = fieldValueObj;
        }

        const sectionsToPersist = Object.entries(sectionUpdates).filter(([, v]) => Object.keys(v).length > 0);
        
        // Batch: fetch ALL existing sections for this deal in one query (used for both deleted-prefix cleanup AND upsert)
        const { data: allExistingSections, error: batchFetchError } = await supabase
          .from('deal_section_values')
          .select('id, section, field_values, version')
          .eq('deal_id', dealId);

        if (batchFetchError) throw batchFetchError;

        // Build a lookup map: section -> existing row
        const existingSectionMap = new Map<string, { id: string; field_values: Record<string, JsonbFieldValue>; version: number }>();
        (allExistingSections || []).forEach((sv: any) => {
          existingSectionMap.set(sv.section, {
            id: sv.id,
            field_values: (sv.field_values as unknown as Record<string, JsonbFieldValue>) || {},
            version: sv.version || 0,
          });
        });

        // Clean deleted prefixes from sections NOT in sectionsToPersist (those are handled during merge below)
        if (deletedPrefixes.length > 0) {
          for (const [sectionKey, existing] of existingSectionMap.entries()) {
            // Skip sections already in sectionsToPersist (handled below)
            if (sectionUpdates[sectionKey] && Object.keys(sectionUpdates[sectionKey]).length > 0) continue;

            const existingFieldValues = { ...existing.field_values };
            let modified = false;

            Object.keys(existingFieldValues).forEach(storageKey => {
              const { prefix } = parseStorageKey(storageKey);
              if (prefix && deletedPrefixes.includes(prefix)) {
                delete existingFieldValues[storageKey];
                modified = true;
              }
              const val = existingFieldValues[storageKey];
              if (val?.indexed_key) {
                for (const dp of deletedPrefixes) {
                  if (val.indexed_key.startsWith(`${dp}.`)) {
                    delete existingFieldValues[storageKey];
                    modified = true;
                    break;
                  }
                }
              }
            });

            if (modified) {
              await supabase
                .from('deal_section_values')
                .update({
                  field_values: JSON.parse(JSON.stringify(existingFieldValues)),
                  updated_at: new Date().toISOString(),
                  version: (existing.version || 0) + 1,
                })
                .eq('id', existing.id);
            }
          }
        }

        // Build all payloads
        const updates: { id: string; payload: any }[] = [];
        const inserts: any[] = [];

        for (const [section, newFieldValues] of sectionsToPersist) {
          const existing = existingSectionMap.get(section);
          const existingFieldValues = existing?.field_values || {};
          const mergedFieldValues: Record<string, JsonbFieldValue> = {
            ...existingFieldValues,
            ...newFieldValues,
          };

          // Remove composite keys belonging to deleted prefixes
          if (deletedPrefixes.length > 0) {
            Object.keys(mergedFieldValues).forEach(storageKey => {
              const { prefix } = parseStorageKey(storageKey);
              if (prefix && deletedPrefixes.includes(prefix)) {
                delete mergedFieldValues[storageKey];
              }
              const val = mergedFieldValues[storageKey];
              if (val?.indexed_key) {
                for (const dp of deletedPrefixes) {
                  if (val.indexed_key.startsWith(`${dp}.`)) {
                    delete mergedFieldValues[storageKey];
                    break;
                  }
                }
              }
            });
          }

          const newVersion = (existing?.version || 0) + 1;
          const payload = {
            deal_id: dealId,
            section: section as FieldSection,
            field_values: JSON.parse(JSON.stringify(mergedFieldValues)),
            updated_at: new Date().toISOString(),
            version: newVersion,
          };

          if (existing?.id) {
            updates.push({ id: existing.id, payload });
          } else {
            inserts.push(payload);
          }
        }

        // Execute inserts in a single batch
        if (inserts.length > 0) {
          const { error: insertError } = await supabase
            .from('deal_section_values')
            .insert(inserts);
          if (insertError) throw insertError;
        }

        // Execute updates (must be per-row due to different payloads per id)
        for (const { id: rowId, payload } of updates) {
          const { error: updateError } = await supabase
            .from('deal_section_values')
            .update(payload)
            .eq('id', rowId);
          if (updateError) throw updateError;
        }
      }

      // --- Sync denormalized fields to deals table ---
      try {
        const dealUpdates: Record<string, any> = {};
        const borrowerNameKey = 'loan_terms.details_borrower_name';
        if (finalValues[borrowerNameKey] !== undefined) {
          dealUpdates.borrower_name = finalValues[borrowerNameKey] || null;
        }
        if (Object.keys(dealUpdates).length > 0) {
          await supabase.from('deals').update(dealUpdates).eq('id', dealId);
        }
      } catch (syncErr) {
        console.warn('[useDealFields] Failed to sync denormalized deal fields:', syncErr);
      }

      // Clear deleted prefixes and sessionStorage cache after successful save
      setDeletedPrefixes([]);
      clearSessionCache(dealId);
      setDirtyFieldKeys(new Set());
      setIsDirty(false);

      // --- Event Journal: compute diff and log changes ---
      try {
        const snapshot = savedValuesSnapshotRef.current;
        const changedBySection: Record<string, FieldChange[]> = {};

        // Compare ALL keys between snapshot and finalValues to detect changes
        const allKeys = new Set([...Object.keys(snapshot), ...Object.keys(finalValues)]);
        for (const fieldKey of allKeys) {
          const oldVal = snapshot[fieldKey] || '';
          const newVal = finalValues[fieldKey] || '';
          if (oldVal === newVal) continue;

          // Resolve field label and section
          const canonicalKey = getCanonicalKey(fieldKey);
          const field = resolvedFields?.fields.find(
            f => f.field_key === canonicalKey || f.field_key === fieldKey
          );
          const label = field?.label || fieldKey;
          const section = field?.section || 'other';

          if (!changedBySection[section]) changedBySection[section] = [];
          changedBySection[section].push({
            fieldLabel: label,
            oldValue: oldVal,
            newValue: newVal,
          });
        }

        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          for (const [section, changes] of Object.entries(changedBySection)) {
            if (changes.length > 0) {
              await logFieldChanges(dealId, section, changes, currentUser.id);
            }
          }
        }

        // Update snapshot
        savedValuesSnapshotRef.current = { ...finalValues };
      } catch (journalErr) {
        console.error('Event journal logging failed (non-blocking):', journalErr);
      }

      if (!silent) {
        toast({
          title: 'Saved',
          description: 'File data saved successfully',
        });
      }

      return true;
    } catch (err: any) {
      console.error('Error saving deal data:', err);
      if (!silent) {
        toast({
          title: 'Error',
          description: err.message || 'Failed to save deal data',
          variant: 'destructive',
        });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [dealId, values, fieldDataTypes, fieldIdMap, resolvedFields, computeCalculatedFields, deletedPrefixes, toast]);

  const getMissingRequiredFields = useCallback((section?: FieldSection): ResolvedField[] => {
    if (!resolvedFields) return [];
    return getResolverMissingFields(resolvedFields, values, section);
  }, [resolvedFields, values]);

  const getValidationErrors = useCallback((section?: FieldSection): string[] => {
    return getMissingRequiredFields(section).map(field => `${field.label} is required`);
  }, [getMissingRequiredFields]);

  const isSectionComplete = useCallback((section: FieldSection): boolean => {
    if (!resolvedFields) return true;
    return isResolverSectionComplete(resolvedFields, values, section);
  }, [resolvedFields, values]);

  const isPacketComplete = useCallback((): boolean => {
    return getMissingRequiredFields().length === 0;
  }, [getMissingRequiredFields]);

  const hasRequiredFieldChanged = useCallback((): boolean => {
    return requiredFieldChanged;
  }, [requiredFieldChanged]);

  const resetDirty = useCallback(() => {
    setIsDirty(false);
    setDirtyFieldKeys(new Set());
    setRequiredFieldChanged(false);
    clearSessionCache(dealId);
  }, [dealId]);

  const refetchData = useCallback(async () => {
    hasLoadedRef.current = false;
    isFetchingRef.current = false;
    setDeletedPrefixes([]);
    await fetchData();
  }, [dealId, packetId]);

  return {
    fields: resolvedFields?.fields || [],
    fieldsBySection: resolvedFields?.fieldsBySection || ({} as Record<FieldSection, ResolvedField[]>),
    sections: resolvedFields?.sections || [],
    values,
    visibleFieldKeys: resolvedFields?.visibleFieldKeys || [],
    requiredFieldKeys: resolvedFields?.requiredFieldKeys || [],
    loading,
    saving,
    error,
    isDirty,
    dirtyFieldKeys,
    updateValue,
    removeValuesByPrefix,
    saveDraft,
    getValidationErrors,
    getMissingRequiredFields,
    isSectionComplete,
    isPacketComplete,
    computeCalculatedFields,
    calculationResults,
    calculatedFields: calculatedFieldsList,
    hasRequiredFieldChanged,
    resetDirty,
    refetchData,
  };
}

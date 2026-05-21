/**
 * Field Resolution Utilities
 * 
 * Handles extracting raw values from deal field values,
 * case-insensitive field lookups, and merge tag mapping resolution.
 * 
 * Supports backward compatibility between:
 * - Old keys (e.g., "borrower.first_name", "LoanTerms.Amount")
 * - New keys (e.g., "br_p_firstname", "lt_d_amount")
 * - canonical_key lookups for migrated fields
 */

import type { 
  FieldValueData, 
  LabelMapping, 
  MergeTagAlias, 
  MergeTagMappings 
} from "./types.ts";

// In-memory cache for merge tag aliases with TTL
let cachedMergeTagMap: Record<string, string> | null = null;
let cachedLabelMap: Record<string, LabelMapping> | null = null;
let cachedFieldKeyMigrations: Map<string, string> | null = null;
let cachedCanonicalKeyMap: Map<string, string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DOC_GEN_DEBUG = Deno.env.get("DOC_GEN_DEBUG") === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) {
    console.log(...args);
  }
};

/**
 * Fetch field key migrations and canonical_key mappings for backward compatibility
 */
export async function fetchFieldKeyMappings(supabase: any): Promise<{
  migrationsMap: Map<string, string>;
  canonicalKeyMap: Map<string, string>;
}> {
  const now = Date.now();
  
  // Return cached values if still valid
  if (cachedFieldKeyMigrations && cachedCanonicalKeyMap && (now - cacheTimestamp) < CACHE_TTL_MS) {
    debugLog("[field-resolver] Using cached field key mappings");
    return { 
      migrationsMap: cachedFieldKeyMigrations, 
      canonicalKeyMap: cachedCanonicalKeyMap 
    };
  }
  
  debugLog("[field-resolver] Fetching field key mappings for backward compatibility");
  
  // Fetch completed migrations (old_key -> new_key)
  const { data: migrations, error: migError } = await supabase
    .from("field_key_migrations")
    .select("old_key, new_key")
    .eq("status", "migrated");
  
  // Fetch field_dictionary for canonical_key mappings (paginated to avoid 1000-row limit)
  const PAGE_SIZE = 1000;
  const allFields: any[] = [];
  let fdFrom = 0;
  while (true) {
    const fdTo = fdFrom + PAGE_SIZE - 1;
    const { data: fdPage, error: fdPageError } = await supabase
      .from("field_dictionary")
      .select("field_key, canonical_key")
      .not("canonical_key", "is", null)
      .range(fdFrom, fdTo);
    if (fdPageError) {
      debugLog("[field-resolver] Field dictionary page fetch error:", fdPageError.message);
      break;
    }
    const rows = fdPage || [];
    allFields.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    fdFrom += PAGE_SIZE;
  }
  const fields = allFields;
  const fieldError = null;
  
  const migrationsMap = new Map<string, string>();
  const canonicalKeyMap = new Map<string, string>();
  
  // Build migrations map: old_key -> new_key
  if (!migError && migrations) {
    for (const m of migrations) {
      migrationsMap.set(m.old_key.toLowerCase(), m.new_key);
      // Also map new_key -> new_key for direct lookups
      migrationsMap.set(m.new_key.toLowerCase(), m.new_key);
    }
    debugLog(`[field-resolver] Loaded ${migrations.length} field key migrations`);
  } else if (migError) {
    debugLog("[field-resolver] Field key migrations unavailable:", migError.message);
  }
  
  // Build canonical_key map: canonical_key -> field_key (current key)
  if (!fieldError && fields) {
    for (const f of fields) {
      if (f.canonical_key) {
        // Map old canonical_key -> current field_key
        canonicalKeyMap.set(f.canonical_key.toLowerCase(), f.field_key);
        // Also map current field_key -> itself
        canonicalKeyMap.set(f.field_key.toLowerCase(), f.field_key);
      }
    }
    debugLog(`[field-resolver] Loaded ${fields.length} canonical_key mappings`);
  } else if (fieldError) {
    debugLog("[field-resolver] Field dictionary lookup failed");
  }
  
  // Update cache
  cachedFieldKeyMigrations = migrationsMap;
  cachedCanonicalKeyMap = canonicalKeyMap;
  cacheTimestamp = now;
  
  return { migrationsMap, canonicalKeyMap };
}

/**
 * Fetch merge tag aliases from database and build lookup maps
 * Note: Aliases are now optional - the system can resolve tags directly from field_dictionary
 */
export async function fetchMergeTagMappings(supabase: any): Promise<MergeTagMappings> {
  const now = Date.now();
  
  // Return cached values if still valid
  if (cachedMergeTagMap && cachedLabelMap && (now - cacheTimestamp) < CACHE_TTL_MS) {
    debugLog("[field-resolver] Using cached merge tag mappings");
    return { mergeTagMap: cachedMergeTagMap, labelMap: cachedLabelMap };
  }
  
  debugLog("[field-resolver] Fetching merge tag mappings from database (optional fallback)");
  
  const { data: aliases, error } = await supabase
    .from("merge_tag_aliases")
    .select("tag_name, field_key, tag_type, replace_next, is_active")
    .eq("is_active", true);
  
  // Gracefully handle missing table or errors - aliases are optional now
  if (error) {
    debugLog("[field-resolver] Merge tag aliases unavailable (this is OK - using direct field_key resolution):", error.message);
    cachedMergeTagMap = {};
    cachedLabelMap = {};
    cacheTimestamp = now;
    return { mergeTagMap: {}, labelMap: {} };
  }
  
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  
  for (const alias of (aliases || []) as MergeTagAlias[]) {
    if (alias.tag_type === 'merge_tag' || alias.tag_type === 'f_code') {
      mergeTagMap[alias.tag_name] = alias.field_key;
    } else if (alias.tag_type === 'label') {
      labelMap[alias.tag_name] = {
        fieldKey: alias.field_key,
        replaceNext: alias.replace_next || undefined,
      };
    }
  }
  
  // Update cache
  cachedMergeTagMap = mergeTagMap;
  cachedLabelMap = labelMap;
  cacheTimestamp = now;
  
  debugLog(`[field-resolver] Loaded ${Object.keys(mergeTagMap).length} legacy aliases and ${Object.keys(labelMap).length} labels`);
  
  return { mergeTagMap, labelMap };
}

/**
 * Resolve a field key to its current form using all available mappings
 * Supports: new keys, old keys, canonical_key, and migration mappings
 * 
 * Resolution priority:
 * 1. Direct match in validFieldKeys
 * 2. Migration mapping (old_key -> new_key)
 * 3. Canonical key mapping (canonical_key -> current field_key)
 * 4. Merge tag alias mapping
 * 5. Case-insensitive fallback
 */
// Module-level cache for lowercase valid-key index
let _lowerValidKeysCache: Map<string, string> | null = null;
let _lowerValidKeysSource: Set<string> | null = null;

function getLowerValidKeysIndex(validFieldKeys: Set<string>): Map<string, string> {
  if (_lowerValidKeysCache && _lowerValidKeysSource === validFieldKeys) {
    return _lowerValidKeysCache;
  }
  const m = new Map<string, string>();
  for (const k of validFieldKeys) {
    const lower = k.toLowerCase();
    if (!m.has(lower)) m.set(lower, k);
  }
  _lowerValidKeysCache = m;
  _lowerValidKeysSource = validFieldKeys;
  return m;
}

export function resolveFieldKeyWithBackwardCompat(
  tagName: string,
  mergeTagMap: Record<string, string>,
  migrationsMap: Map<string, string>,
  canonicalKeyMap: Map<string, string>,
  validFieldKeys?: Set<string>
): string {
  const cleanedTag = tagName.replace(/_+$/, "").trim();
  const lowerTag = cleanedTag.toLowerCase();
  
  // Priority 1: Direct match in current field keys
  if (validFieldKeys) {
    if (validFieldKeys.has(cleanedTag)) return cleanedTag;
    if (validFieldKeys.has(tagName)) return tagName;
  }
  
  // Priority 2: Migration mapping (handles old_key -> new_key)
  const migratedKey = migrationsMap.get(lowerTag);
  if (migratedKey) {
    debugLog(`[field-resolver] Resolved via migration: ${tagName} -> ${migratedKey}`);
    return migratedKey;
  }
  
  // Priority 3: Canonical key mapping (handles canonical_key -> current field_key)
  const canonicalResolved = canonicalKeyMap.get(lowerTag);
  if (canonicalResolved) {
    debugLog(`[field-resolver] Resolved via canonical_key: ${tagName} -> ${canonicalResolved}`);
    return canonicalResolved;
  }
  
  // Priority 4: Explicit merge tag alias mapping
  if (mergeTagMap[tagName]) return mergeTagMap[tagName];
  if (mergeTagMap[cleanedTag]) return mergeTagMap[cleanedTag];
  
  // Priority 5: Case-insensitive lookup against valid field keys (O(1) via index)
  if (validFieldKeys) {
    const lowerIndex = getLowerValidKeysIndex(validFieldKeys);
    const ciMatch = lowerIndex.get(lowerTag);
    if (ciMatch) return ciMatch;
    
    // Try with underscores converted to dots (legacy format)
    const dotVersion = cleanedTag.replace(/_/g, ".");
    if (validFieldKeys.has(dotVersion)) return dotVersion;
    const dotMatch = lowerIndex.get(dotVersion.toLowerCase());
    if (dotMatch) return dotMatch;
  }
  
  // Fallback: return as-is (might not match)
  return tagName;
}

/**
 * Legacy resolver - maintained for backward compatibility
 * Delegates to new resolver with empty migration maps
 */
export function resolveFieldKeyWithMap(
  tagName: string, 
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>
): string {
  return resolveFieldKeyWithBackwardCompat(
    tagName,
    mergeTagMap,
    cachedFieldKeyMigrations || new Map(),
    cachedCanonicalKeyMap || new Map(),
    validFieldKeys
  );
}

/**
 * Case-insensitive field value lookup with backward compatibility
 * Tries: exact match, lowercase match, canonical_key resolution, migration resolution
 */
// Module-level cache for lowercase field-values index
let _lowerFieldValuesCache: Map<string, string> | null = null;
let _lowerFieldValuesSource: Map<string, FieldValueData> | null = null;

function getLowerFieldValuesIndex(fieldValues: Map<string, FieldValueData>): Map<string, string> {
  if (_lowerFieldValuesCache && _lowerFieldValuesSource === fieldValues) {
    return _lowerFieldValuesCache;
  }
  const m = new Map<string, string>();
  for (const k of fieldValues.keys()) {
    const lower = k.toLowerCase();
    if (!m.has(lower)) m.set(lower, k);
  }
  _lowerFieldValuesCache = m;
  _lowerFieldValuesSource = fieldValues;
  return m;
}

export function getFieldData(
  canonicalKey: string, 
  fieldValues: Map<string, FieldValueData>
): { key: string; data: FieldValueData } | null {
  // Try exact match first
  const exact = fieldValues.get(canonicalKey);
  if (exact) return { key: canonicalKey, data: exact };

  const target = canonicalKey.toLowerCase();
  const lowerIndex = getLowerFieldValuesIndex(fieldValues);
  
  // Try case-insensitive match (O(1))
  const ciKey = lowerIndex.get(target);
  if (ciKey) {
    const v = fieldValues.get(ciKey);
    if (v) return { key: ciKey, data: v };
  }
  
  // Try migration resolution (old_key -> new_key)
  if (cachedFieldKeyMigrations) {
    const migratedKey = cachedFieldKeyMigrations.get(target);
    if (migratedKey) {
      const migrated = fieldValues.get(migratedKey);
      if (migrated) return { key: migratedKey, data: migrated };
      const migratedLower = lowerIndex.get(migratedKey.toLowerCase());
      if (migratedLower) {
        const v = fieldValues.get(migratedLower);
        if (v) return { key: migratedLower, data: v };
      }
    }
  }
  
  // Try canonical_key resolution
  if (cachedCanonicalKeyMap) {
    const resolved = cachedCanonicalKeyMap.get(target);
    if (resolved) {
      const resolvedData = fieldValues.get(resolved);
      if (resolvedData) return { key: resolved, data: resolvedData };
      const resolvedLower = lowerIndex.get(resolved.toLowerCase());
      if (resolvedLower) {
        const v = fieldValues.get(resolvedLower);
        if (v) return { key: resolvedLower, data: v };
      }
    }
  }
  
  return null;
}

/**
 * Extract raw value from JSONB structure based on data type
 */
export function extractRawValueFromJsonb(data: any, dataType: string): string | number | null {
  switch (dataType) {
    case "currency":
    case "number":
    case "percentage":
    case "decimal":
    case "integer":
      // Prefer value_number; fall back to value_text if stored as string
      return data.value_number ?? data.value_text ?? null;
    case "date":
    case "datetime":
      // Prefer value_date; fall back to value_text if stored as string
      return data.value_date ?? data.value_text ?? null;
    case "text":
    case "boolean":
    case "phone":
    case "dropdown":
    default:
      return data.value_text;
  }
}

/**
 * Clear all caches (useful for testing or forced refresh)
 */
export function clearMergeTagCache(): void {
  cachedMergeTagMap = null;
  cachedLabelMap = null;
  cachedFieldKeyMigrations = null;
  cachedCanonicalKeyMap = null;
  cacheTimestamp = 0;
  _lowerValidKeysCache = null;
  _lowerValidKeysSource = null;
  _lowerFieldValuesCache = null;
  _lowerFieldValuesSource = null;
}

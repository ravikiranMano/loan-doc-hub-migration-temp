/** Field resolution utilities — NestJS port of the edge function field resolver. */

import type {
  FieldValueData,
  LabelMapping,
  MergeTagMappings,
} from "./types";

import { formatCurrency } from "./formatting.util";

// In-memory cache (per-process, warm for the lifetime of the NestJS server)
let cachedMergeTagMap: Record<string, string> | null = null;
let cachedLabelMap: Record<string, LabelMapping> | null = null;
let cachedFieldKeyMigrations: Map<string, string> | null = null;
let cachedCanonicalKeyMap: Map<string, string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const DOC_GEN_DEBUG = process.env["DOC_GEN_DEBUG"] === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) console.log(...args);
};

// ── Cache setters (called by GenerationService after fetching from Prisma) ──

export function setFieldKeyMappingsCache(
  migrationsMap: Map<string, string>,
  canonicalKeyMap: Map<string, string>,
): void {
  cachedFieldKeyMigrations = migrationsMap;
  cachedCanonicalKeyMap = canonicalKeyMap;
  cacheTimestamp = Date.now();
}

export function setMergeTagMappingsCache(
  mergeTagMap: Record<string, string>,
  labelMap: Record<string, LabelMapping>,
): void {
  cachedMergeTagMap = mergeTagMap;
  cachedLabelMap = labelMap;
  cacheTimestamp = Date.now();
}

// ── Resolution helpers (identical logic to original) ──

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
  validFieldKeys?: Set<string>,
): string {
  const cleanedTag = tagName.replace(/_+$/, "").trim();
  const lowerTag = cleanedTag.toLowerCase();

  if (validFieldKeys) {
    if (validFieldKeys.has(cleanedTag)) return cleanedTag;
    if (validFieldKeys.has(tagName)) return tagName;
  }

  const migratedKey = migrationsMap.get(lowerTag);
  if (migratedKey) {
    debugLog(`[field-resolver] Resolved via migration: ${tagName} -> ${migratedKey}`);
    return migratedKey;
  }

  const canonicalResolved = canonicalKeyMap.get(lowerTag);
  if (canonicalResolved) {
    debugLog(`[field-resolver] Resolved via canonical_key: ${tagName} -> ${canonicalResolved}`);
    return canonicalResolved;
  }

  if (mergeTagMap[tagName]) return mergeTagMap[tagName];
  if (mergeTagMap[cleanedTag]) return mergeTagMap[cleanedTag];

  if (validFieldKeys) {
    const lowerIndex = getLowerValidKeysIndex(validFieldKeys);
    const ciMatch = lowerIndex.get(lowerTag);
    if (ciMatch) return ciMatch;

    const dotVersion = cleanedTag.replace(/_/g, ".");
    if (validFieldKeys.has(dotVersion)) return dotVersion;
    const dotMatch = lowerIndex.get(dotVersion.toLowerCase());
    if (dotMatch) return dotMatch;
  }

  return tagName;
}

export function resolveFieldKeyWithMap(
  tagName: string,
  mergeTagMap: Record<string, string>,
  validFieldKeys?: Set<string>,
): string {
  return resolveFieldKeyWithBackwardCompat(
    tagName,
    mergeTagMap,
    cachedFieldKeyMigrations || new Map(),
    cachedCanonicalKeyMap || new Map(),
    validFieldKeys,
  );
}

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
  fieldValues: Map<string, FieldValueData>,
): { key: string; data: FieldValueData } | null {
  const exact = fieldValues.get(canonicalKey);
  if (exact) return { key: canonicalKey, data: exact };

  const target = canonicalKey.toLowerCase();
  const lowerIndex = getLowerFieldValuesIndex(fieldValues);

  const ciKey = lowerIndex.get(target);
  if (ciKey) {
    const v = fieldValues.get(ciKey);
    if (v) return { key: ciKey, data: v };
  }

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

export function extractRawValueFromJsonb(data: Record<string, unknown>, dataType: string): string | number | null {
  const asStringOrNumber = (v: unknown): string | number | null =>
    typeof v === 'string' || typeof v === 'number' ? v : null;

  switch (dataType) {
    case "currency":
    case "number":
    case "percentage":
    case "decimal":
    case "integer":
      return asStringOrNumber(data.value_number) ?? asStringOrNumber(data.value_text) ?? null;
    case "date":
    case "datetime":
      return asStringOrNumber(data.value_date) ?? asStringOrNumber(data.value_text) ?? null;
    case "text":
    case "boolean":
    case "phone":
    case "dropdown":
    default:
      return asStringOrNumber(data.value_text);
  }
}

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

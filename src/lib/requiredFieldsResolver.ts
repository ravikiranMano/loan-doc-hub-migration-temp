import { fetchFieldDictionaryBySections, fetchFieldDictionaryByIds } from '@/services/admin/field-dictionary.service';
import { fetchPacketTemplateIds } from '@/services/documents/packets.service';
import { fetchFieldMapsByTemplateIds } from '@/services/documents/template-field-maps.service';
import { resolveDbKeyToLegacy, resolveLegacyKey } from '@/lib/legacyKeyMap';
import type { FieldSection, FieldDataType } from '@/types';

export interface ResolvedField {
  field_dictionary_id: string;
  field_key: string;
  label: string;
  section: FieldSection;
  data_type: FieldDataType;
  description: string | null;
  default_value: string | null;
  is_calculated: boolean;
  is_repeatable: boolean;
  validation_rule: string | null;
  is_required: boolean;
  is_mandatory: boolean;
  form_type: string;
  transform_rules: string[];
  calculation_formula: string | null;
  calculation_dependencies: string[];
}

export interface ResolvedFieldSet {
  /** All unique field dictionary IDs visible for this packet (required + optional) */
  visibleFieldIds: string[];
  /** All unique field keys visible for this packet */
  visibleFieldKeys: string[];
  /** Field dictionary IDs that are required (ANY template requires them) */
  requiredFieldIds: string[];
  /** Field keys that are required (ANY template requires them) */
  requiredFieldKeys: string[];
  /** Full field definitions with metadata */
  fields: ResolvedField[];
  /** Fields grouped by section */
  fieldsBySection: Record<FieldSection, ResolvedField[]>;
  /** Sections that have fields, in display order */
  sections: FieldSection[];
}

// Section display order - main UI sections only
// These are the primary sections shown in the CSR data entry tabs
export const SECTION_ORDER: FieldSection[] = [
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
  'notes',
  'seller',
];

// Custom UI-only sections (not in database enum)
export const CUSTOM_UI_SECTIONS = ['origination_fees'] as const;
export type CustomUISection = typeof CUSTOM_UI_SECTIONS[number];

/**
 * Fallback resolver when no packet is assigned.
 * Loads ALL fields from field_dictionary grouped by section.
 * No fields are marked as required since there's no template mapping.
 */
export async function resolveAllFields(cachedEntries?: any[]): Promise<ResolvedFieldSet> {
  const fieldDictEntries = cachedEntries
    ? cachedEntries.filter((e: any) => SECTION_ORDER.includes(e.section))
    : await fetchFieldDictionaryBySections(SECTION_ORDER as string[]);

  const fields: ResolvedField[] = (fieldDictEntries || []).map(fd => ({
    field_dictionary_id: fd.id,
    field_key: fd.field_key,
    label: fd.label,
    section: fd.section,
    data_type: fd.data_type,
    description: fd.description,
    default_value: fd.default_value,
    is_calculated: fd.is_calculated,
    is_repeatable: fd.is_repeatable,
    validation_rule: fd.validation_rule,
    is_required: false,
    is_mandatory: !!fd.is_mandatory,
    form_type: fd.form_type || 'primary',
    transform_rules: [],
    calculation_formula: fd.calculation_formula || null,
    calculation_dependencies: fd.calculation_dependencies || [],
  }));

  // Sort by section order, then by label
  fields.sort((a, b) => {
    const sectionOrderA = SECTION_ORDER.indexOf(a.section);
    const sectionOrderB = SECTION_ORDER.indexOf(b.section);
    if (sectionOrderA !== sectionOrderB) return sectionOrderA - sectionOrderB;
    return a.label.localeCompare(b.label);
  });

  // Group by section
  const fieldsBySection = fields.reduce((acc, field) => {
    if (!acc[field.section]) {
      acc[field.section] = [];
    }
    acc[field.section].push(field);
    return acc;
  }, {} as Record<FieldSection, ResolvedField[]>);

  // Get sections in order that have fields
  const sections = SECTION_ORDER.filter(section => 
    fieldsBySection[section] && fieldsBySection[section].length > 0
  );

  // Build visible arrays
  const visibleFieldIds = fields.map(f => f.field_dictionary_id);
  const visibleFieldKeys = fields.map(f => f.field_key);

  return {
    visibleFieldIds,
    visibleFieldKeys,
    requiredFieldIds: [], // No required fields without packet
    requiredFieldKeys: [], // No required fields without packet
    fields,
    fieldsBySection,
    sections,
  };
}

/**
 * Deterministic resolver that computes the required field set for a deal
 * based on the selected packet.
 * 
 * Logic:
 * 1. Load all templates in the packet (via PacketTemplate → Template)
 * 2. Load all TemplateFieldMap rows for those templates (with field_dictionary join)
 * 3. Deduplicate by field_dictionary_id
 * 4. Mark a field as required = true if ANY TemplateFieldMap.requiredFlag is true
 * 
 * @param packetId - The packet ID to resolve fields for
 * @returns ResolvedFieldSet with visible and required field keys
 */
export async function resolvePacketFields(packetId: string, cachedEntries?: any[]): Promise<ResolvedFieldSet> {
  // 1. Load all templates in the packet
  const templateIds = await fetchPacketTemplateIds(packetId);

  if (templateIds.length === 0) {
    return {
      visibleFieldIds: [],
      visibleFieldKeys: [],
      requiredFieldIds: [],
      requiredFieldKeys: [],
      fields: [],
      fieldsBySection: {} as Record<FieldSection, ResolvedField[]>,
      sections: [],
    };
  }

  // 2. Load all TemplateFieldMap rows
  const fieldMaps = await fetchFieldMapsByTemplateIds(templateIds);

  if (!fieldMaps || fieldMaps.length === 0) {
    return {
      visibleFieldIds: [],
      visibleFieldKeys: [],
      requiredFieldIds: [],
      requiredFieldKeys: [],
      fields: [],
      fieldsBySection: {} as Record<FieldSection, ResolvedField[]>,
      sections: [],
    };
  }

  // Get unique field dictionary IDs
  const fieldDictIds = [...new Set(fieldMaps.map(fm => fm.field_dictionary_id).filter(Boolean))] as string[];
  
  if (fieldDictIds.length === 0) {
    return {
      visibleFieldIds: [],
      visibleFieldKeys: [],
      requiredFieldIds: [],
      requiredFieldKeys: [],
      fields: [],
      fieldsBySection: {} as Record<FieldSection, ResolvedField[]>,
      sections: [],
    };
  }

  // 3. Load field dictionary entries for those IDs (use cache if available)
  const fieldDictEntries = cachedEntries
    ? cachedEntries.filter((e: any) => fieldDictIds.includes(e.id))
    : await fetchFieldDictionaryByIds(fieldDictIds);

  // Create lookup map for field dictionary by ID
  const fieldDictMap = new Map<string, any>();
  (fieldDictEntries || []).forEach(fd => fieldDictMap.set(fd.id, fd));

  // 4. Deduplicate and aggregate
  // - requiredFieldIds: field is required if ANY template requires it
  // - visibleFieldIds: all unique field dictionary IDs
  // - transformRulesMap: collect all transform rules per field
  const requiredSet = new Set<string>();
  const transformRulesMap: Record<string, string[]> = {};
  const fieldDataMap = new Map<string, any>(); // field_dictionary_id -> field_dictionary data

  (fieldMaps as any[]).forEach(fm => {
    const fieldDictId = fm.field_dictionary_id;
    if (!fieldDictId) return;
    
    const fieldDict = fieldDictMap.get(fieldDictId);
    if (!fieldDict) return; // Skip if no dictionary entry found
    
    // Store field dictionary data
    if (!fieldDataMap.has(fieldDictId)) {
      fieldDataMap.set(fieldDictId, fieldDict);
    }
    
    // Mark as required if ANY template requires this field
    if (fm.required_flag) {
      requiredSet.add(fieldDictId);
    }
    
    // Collect transform rules (deduplicated per field)
    if (fm.transform_rule) {
      if (!transformRulesMap[fieldDictId]) {
        transformRulesMap[fieldDictId] = [];
      }
      if (!transformRulesMap[fieldDictId].includes(fm.transform_rule)) {
        transformRulesMap[fieldDictId].push(fm.transform_rule);
      }
    }
  });

  // Get unique visible field IDs
  const visibleFieldIds = [...fieldDataMap.keys()];
  const requiredFieldIds = [...requiredSet];

  if (visibleFieldIds.length === 0) {
    return {
      visibleFieldIds: [],
      visibleFieldKeys: [],
      requiredFieldIds: [],
      requiredFieldKeys: [],
      fields: [],
      fieldsBySection: {} as Record<FieldSection, ResolvedField[]>,
      sections: [],
    };
  }

  // Build resolved fields from the joined data
  const fields: ResolvedField[] = visibleFieldIds.map(fieldDictId => {
    const fd = fieldDataMap.get(fieldDictId)!;
    return {
      field_dictionary_id: fd.id,
      field_key: fd.field_key,
      label: fd.label,
      section: fd.section,
      data_type: fd.data_type,
      description: fd.description,
      default_value: fd.default_value,
      is_calculated: fd.is_calculated,
      is_repeatable: fd.is_repeatable,
      validation_rule: fd.validation_rule,
      is_required: requiredSet.has(fieldDictId),
      is_mandatory: !!fd.is_mandatory,
      form_type: fd.form_type || 'primary',
      transform_rules: transformRulesMap[fieldDictId] || [],
      calculation_formula: fd.calculation_formula || null,
      calculation_dependencies: fd.calculation_dependencies || [],
    };
  });

  // Get visible and required field keys for backwards compatibility
  const visibleFieldKeys = fields.map(f => f.field_key);
  const requiredFieldKeys = fields.filter(f => f.is_required).map(f => f.field_key);

  // Sort by section order, then by label
  fields.sort((a, b) => {
    const sectionOrderA = SECTION_ORDER.indexOf(a.section);
    const sectionOrderB = SECTION_ORDER.indexOf(b.section);
    if (sectionOrderA !== sectionOrderB) return sectionOrderA - sectionOrderB;
    return a.label.localeCompare(b.label);
  });

  // Group by section
  const fieldsBySection = fields.reduce((acc, field) => {
    if (!acc[field.section]) {
      acc[field.section] = [];
    }
    acc[field.section].push(field);
    return acc;
  }, {} as Record<FieldSection, ResolvedField[]>);

  // Get sections in order that have fields
  const sections = SECTION_ORDER.filter(section => 
    fieldsBySection[section] && fieldsBySection[section].length > 0
  );

  return {
    visibleFieldIds,
    visibleFieldKeys,
    requiredFieldIds,
    requiredFieldKeys,
    fields,
    fieldsBySection,
    sections,
  };
}

/**
 * Resolve a field value from the values map.
 * UI / JSONB persistence uses legacy dot-notation and indexed keys (borrower1.first_name);
 * field_dictionary uses DB keys (br_p_firstName). Check all aliases so completeness matches saved data.
 */
function trimFieldValue(raw: unknown): string {
  if (raw == null || raw === '') return '';
  return (typeof raw === 'string' ? raw : String(raw)).trim();
}

export function getValueForResolvedField(
  values: Record<string, string>,
  field: Pick<ResolvedField, 'field_key'>,
): string {
  const keysToTry = new Set<string>();
  keysToTry.add(field.field_key);
  const legacy = resolveDbKeyToLegacy(field.field_key);
  if (legacy) keysToTry.add(legacy);
  const dbFromLegacy = resolveLegacyKey(field.field_key);
  if (dbFromLegacy !== field.field_key) keysToTry.add(dbFromLegacy);

  for (const key of keysToTry) {
    const direct = trimFieldValue(values[key]);
    if (direct) return direct;

    const dotIdx = key.indexOf('.');
    if (dotIdx <= 0) continue;

    const entityPart = key.slice(0, dotIdx);
    const suffix = key.slice(dotIdx + 1);
    const entityBase = entityPart.replace(/\d+$/, '');

    for (let n = 1; n <= 9; n++) {
      const indexed = `${entityBase}${n}.${suffix}`;
      const indexedVal = trimFieldValue(values[indexed]);
      if (indexedVal) return indexedVal;
    }
  }

  return '';
}

/**
 * Mark-ready / packet completeness uses template-required fields only (same as CSR progress bar).
 */
export function getMissingTemplateRequiredFields(
  resolvedFields: ResolvedFieldSet,
  values: Record<string, string>,
): ResolvedField[] {
  const requiredKeys = new Set(resolvedFields.requiredFieldKeys);
  return resolvedFields.fields.filter((field) => {
    if (!requiredKeys.has(field.field_key)) return false;
    return !getValueForResolvedField(values, field);
  });
}

export function isPacketReadyForMark(
  resolvedFields: ResolvedFieldSet,
  values: Record<string, string>,
): boolean {
  return getMissingTemplateRequiredFields(resolvedFields, values).length === 0;
}

/**
 * Check if a specific field is required for a packet
 */
export function isFieldRequired(resolvedFields: ResolvedFieldSet, fieldKey: string): boolean {
  return resolvedFields.requiredFieldKeys.includes(fieldKey);
}

/**
 * Check if a specific field is visible for a packet
 */
export function isFieldVisible(resolvedFields: ResolvedFieldSet, fieldKey: string): boolean {
  return resolvedFields.visibleFieldKeys.includes(fieldKey);
}

/**
 * Get all required fields that are missing values
 */
export function getMissingRequiredFields(
  resolvedFields: ResolvedFieldSet,
  values: Record<string, string>,
  section?: FieldSection
): ResolvedField[] {
  return resolvedFields.fields.filter(field => {
    if (section && field.section !== section) return false;
    if (!field.is_required && !field.is_mandatory) return false;
    return !getValueForResolvedField(values, field);
  });
}

/**
 * Check if all required fields in a section have values
 */
export function isSectionComplete(
  resolvedFields: ResolvedFieldSet,
  values: Record<string, string>,
  section: FieldSection
): boolean {
  return getMissingRequiredFields(resolvedFields, values, section).length === 0;
}

/**
 * Check if all required fields have values
 */
export function isPacketComplete(
  resolvedFields: ResolvedFieldSet,
  values: Record<string, string>
): boolean {
  // Mark-ready gate: template-required fields only (aligns with CSR progress bar on DealDataEntryPage).
  return isPacketReadyForMark(resolvedFields, values);
}

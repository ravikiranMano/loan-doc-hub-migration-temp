/**
 * Field Value Resolver
 * 
 * Converts canonical DealFieldValue records into merge-ready strings
 * for document generation. Applies formatting based on data type and
 * transform rules from the field dictionary and template field maps.
 */

import { supabase } from '@/integrations/supabase/client';
import { formatRate, formatProRata } from '@/lib/precisionFormat';
import {
  formatCurrency,
  formatCurrencyInWords,
  formatDateMMDDYYYY,
  formatDateLong,
  formatDateShort,
  formatPercentage,
  formatUppercase,
  formatTitlecase,
  formatLowercase,
  formatPhone,
  formatSSNMasked,
  type TransformType,
} from './fieldTransforms';
import type { Database } from '@/integrations/supabase/types';

type FieldDataType = Database['public']['Enums']['field_data_type'];

export interface ResolvedFieldValue {
  fieldKey: string;
  fieldDictionaryId: string;
  rawValue: string | number | null;
  formattedValue: string;
  dataType: FieldDataType;
  isEmpty: boolean;
}

export interface FieldValueResolverResult {
  /** Map of fieldKey → merge-ready string value */
  values: Record<string, string>;
  /** Detailed resolution info for each field */
  details: Record<string, ResolvedFieldValue>;
  /** Field keys that had no value */
  emptyFields: string[];
  /** Any errors encountered during resolution */
  errors: string[];
}

interface DealFieldValue {
  field_dictionary_id: string;
  field_key: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
  data_type: FieldDataType;
}

// JSONB field value structure from deal_section_values
interface JsonbFieldValue {
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
  updated_at: string;
  updated_by: string | null;
}

interface FieldDefinition {
  id: string;
  field_key: string;
  data_type: FieldDataType;
  label: string;
}

/**
 * Get the raw canonical value from a deal field value record
 */
function extractRawValue(
  fieldValue: DealFieldValue | undefined,
  dataType: FieldDataType
): string | number | null {
  if (!fieldValue) return null;

  switch (dataType) {
    case 'currency':
    case 'number':
    case 'percentage':
      return fieldValue.value_number;
    case 'date':
      return fieldValue.value_date;
    case 'text':
    case 'boolean':
    default:
      return fieldValue.value_text;
  }
}

/**
 * Format a value based on its data type for merge output
 * This produces the default formatted output for document generation
 */
function formatByDataType(
  value: string | number | null,
  dataType: FieldDataType
): string {
  if (value === null || value === undefined) return '';

  switch (dataType) {
    case 'currency':
      return formatCurrency(value);
    
    case 'percentage':
      return formatPercentage(value, 2);
    
    case 'date':
      return formatDateMMDDYYYY(String(value));
    
    case 'number':
      if (typeof value === 'number') {
        return new Intl.NumberFormat('en-US').format(value);
      }
      const num = parseFloat(String(value));
      return isNaN(num) ? String(value) : new Intl.NumberFormat('en-US').format(num);
    
    case 'boolean':
      const boolStr = String(value).toLowerCase();
      if (boolStr === 'true' || boolStr === '1' || boolStr === 'yes') {
        return 'Yes';
      }
      if (boolStr === 'false' || boolStr === '0' || boolStr === 'no') {
        return 'No';
      }
      return String(value);
    
    case 'text':
    default:
      return String(value);
  }
}

/**
 * Apply a specific transform rule to a value
 * Transform rules can override the default data type formatting
 */
function applyTransformRule(
  value: string | number | null,
  transformRule: string
): string {
  if (value === null || value === undefined) return '';
  
  const valueStr = String(value);
  const transform = transformRule.toLowerCase() as TransformType;
  
  switch (transform) {
    case 'currency':
      return formatCurrency(value);
    case 'currency_words':
      return formatCurrencyInWords(value);
    case 'date_mmddyyyy':
      return formatDateMMDDYYYY(valueStr);
    case 'date_long':
      return formatDateLong(valueStr);
    case 'date_short':
      return formatDateShort(valueStr);
    case 'uppercase':
      return formatUppercase(valueStr);
    case 'titlecase':
      return formatTitlecase(valueStr);
    case 'lowercase':
      return formatLowercase(valueStr);
    case 'percentage':
      return formatPercentage(value);
    case 'phone':
      return formatPhone(valueStr);
    case 'ssn_masked':
      return formatSSNMasked(valueStr);
    default:
      // Unknown transform, return as-is
      return valueStr;
  }
}

/**
 * Resolve field values for a deal into merge-ready strings
 * 
 * @param dealId - The deal ID to resolve values for
 * @param fieldKeys - Optional list of specific field keys to resolve. If not provided, resolves all fields for the deal.
 * @param transformRules - Optional map of fieldKey → transformRule to apply specific transforms
 * @returns FieldValueResolverResult with formatted values ready for document merge
 */
export async function resolveFieldValues(
  dealId: string,
  fieldKeys?: string[],
  transformRules?: Record<string, string>
): Promise<FieldValueResolverResult> {
  const result: FieldValueResolverResult = {
    values: {},
    details: {},
    emptyFields: [],
    errors: [],
  };

  try {
    // 1. Fetch deal section values from deal_section_values
    const { data: sectionValues, error: svError } = await supabase
      .from('deal_section_values')
      .select('section, field_values')
      .eq('deal_id', dealId);

    if (svError) {
      result.errors.push(`Failed to fetch deal section values: ${svError.message}`);
      return result;
    }

    // Collect all field_dictionary_ids from JSONB keys
    const allFieldDictIds: string[] = [];
    ((sectionValues || []) as any[]).forEach((sv) => {
      Object.keys(sv.field_values || {}).forEach(id => {
        if (!allFieldDictIds.includes(id)) allFieldDictIds.push(id);
      });
    });

    if (allFieldDictIds.length === 0) {
      return result;
    }
    
    // Fetch field dictionary entries
    const { data: fieldDictEntries, error: fdError } = await supabase
      .from('field_dictionary')
      .select('id, field_key, data_type, label')
      .in('id', allFieldDictIds);

    if (fdError) {
      result.errors.push(`Failed to fetch field dictionary: ${fdError.message}`);
      return result;
    }

    // Build field dictionary lookup map
    const fieldDictMap = new Map<string, any>();
    (fieldDictEntries || []).forEach((fd: any) => fieldDictMap.set(fd.id, fd));

    // Create lookup map for field values by field_key (parse from JSONB)
    const fieldValueMap: Record<string, DealFieldValue> = {};
    ((sectionValues || []) as any[]).forEach((sv) => {
      Object.entries(sv.field_values || {}).forEach(([fieldDictId, data]: [string, any]) => {
        const fieldDict = fieldDictMap.get(fieldDictId);
        if (fieldDict) {
          fieldValueMap[fieldDict.field_key] = {
            field_dictionary_id: fieldDictId,
            field_key: fieldDict.field_key,
            value_text: data.value_text,
            value_number: data.value_number,
            value_date: data.value_date,
            value_json: data.value_json,
            data_type: fieldDict.data_type,
          };
        }
      });
    });

    // 2. Get the list of field keys to resolve
    const keysToResolve = fieldKeys || Object.keys(fieldValueMap);

    if (keysToResolve.length === 0) {
      return result;
    }

    // 3. Resolve each field
    for (const fieldKey of keysToResolve) {
      const fieldValue = fieldValueMap[fieldKey];

      // Default to 'text' if field value not found
      const dataType: FieldDataType = fieldValue?.data_type || 'text';

      // Extract raw value based on data type
      const rawValue = extractRawValue(fieldValue, dataType);

      // Check if value is empty
      const isEmpty = rawValue === null || rawValue === undefined || 
        (typeof rawValue === 'string' && rawValue.trim() === '');

      // Determine formatted value
      let formattedValue: string;

      if (isEmpty) {
        formattedValue = '';
        result.emptyFields.push(fieldKey);
      } else {
        // Check if a specific transform rule was provided
        const transformRule = transformRules?.[fieldKey];
        
        if (transformRule) {
          // Apply explicit transform rule
          formattedValue = applyTransformRule(rawValue, transformRule);
        } else {
          // Apply default formatting based on data type
          formattedValue = formatByDataType(rawValue, dataType);
        }
      }

      // Store results
      result.values[fieldKey] = formattedValue;
      result.details[fieldKey] = {
        fieldKey,
        fieldDictionaryId: fieldValue?.field_dictionary_id || '',
        rawValue,
        formattedValue,
        dataType,
        isEmpty,
      };
    }

    // Step 4: Expand loan_terms.funding_records into per-lender document merge fields.

    // FundingRecord.lenderRate is already the override-resolved effective rate

    // (set by handleAddFunding in LoanTermsFundingForm.tsx), so no re-resolution needed.

    const fundingRaw = result.values['loan_terms.funding_records'];

    if (fundingRaw) {

      try {

        const records: Array<Record<string, any>> = JSON.parse(fundingRaw);

        if (Array.isArray(records)) {

          records.forEach((rec, idx) => {

            const n = idx + 1;

            const rateNum = typeof rec.lenderRate === 'number'

              ? rec.lenderRate

              : parseFloat(rec.lenderRate || '') || 0;

            const rateStr = rateNum > 0

              ? formatRate(rateNum)

              : '';

            const fundingAmt = typeof rec.originalAmount === 'number'

              ? rec.originalAmount

              : parseFloat(rec.originalAmount || '') || 0;

            const balance = typeof rec.currentBalance === 'number'

              ? rec.currentBalance

              : fundingAmt;

            const pct = typeof rec.pctOwned === 'number'

              ? rec.pctOwned

              : parseFloat(rec.pctOwned || '') || 0;

            const payment = typeof rec.regularPayment === 'number'

              ? rec.regularPayment

              : parseFloat(rec.regularPayment || '') || 0;

            const fmt$ = (v: number) =>

              v > 0

                ? new Intl.NumberFormat('en-US', {

                    style: 'currency',

                    currency: 'USD',

                    minimumFractionDigits: 2,

                  }).format(v)

                : '';

            const expanded: Record<string, string> = {

              [`lender_${n}_rate`]:          rateStr,

              [`lender_${n}_name`]:          String(rec.lenderName || rec.lenderFullName || ''),

              [`lender_${n}_account`]:       String(rec.lenderAccount || rec.lenderId || ''),

              [`lender_${n}_amount`]:        fmt$(fundingAmt),

              [`lender_${n}_balance`]:       fmt$(balance),

              [`lender_${n}_pct_owned`]:     pct > 0

                ? formatProRata(pct)

                : '',

              [`lender_${n}_payment`]:       fmt$(payment),

              [`lender_${n}_rate_override`]: rec.lenderRateOverride === true ? 'Yes' : 'No',

            };

            // Alias first lender to un-indexed names for single-lender templates

            if (idx === 0) {

              Object.entries(expanded).forEach(([k, v]) => {

                result.values[k.replace(/^lender_1_/, 'lender_')] = v;

              });

            }

            Object.entries(expanded).forEach(([k, v]) => {

              result.values[k] = v;

            });

          });

        }

      } catch {

        result.errors.push(

          'Warning: could not expand loan_terms.funding_records for per-lender merge fields.'

        );

      }

    }

  } catch (error: any) {
    result.errors.push(`Unexpected error: ${error.message}`);
  }

  return result;
}

/**
 * Resolve field values for a specific template
 * Includes transform rules from template_field_maps
 * 
 * @param dealId - The deal ID to resolve values for
 * @param templateId - The template ID to get field mappings from
 * @returns FieldValueResolverResult with formatted values ready for document merge
 */
export async function resolveFieldValuesForTemplate(
  dealId: string,
  templateId: string
): Promise<FieldValueResolverResult> {
  // 1. Fetch template field maps
  const { data: fieldMaps, error: fmError } = await supabase
    .from('template_field_maps')
    .select('field_dictionary_id, transform_rule')
    .eq('template_id', templateId);

  if (fmError) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [`Failed to fetch template field maps: ${fmError.message}`],
    };
  }

  if (!fieldMaps || fieldMaps.length === 0) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [],
    };
  }

  // Get unique field dictionary IDs
  const fieldDictIds = [...new Set(fieldMaps.map(fm => fm.field_dictionary_id).filter(Boolean))] as string[];

  // Fetch field dictionary entries
  const { data: fieldDictEntries, error: fdError } = await supabase
    .from('field_dictionary')
    .select('id, field_key')
    .in('id', fieldDictIds);

  if (fdError || !fieldDictEntries) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [`Failed to fetch field dictionary: ${fdError?.message || 'No data'}`],
    };
  }

  // Create lookup map for field dictionary
  const fieldDictMap = new Map<string, string>();
  fieldDictEntries.forEach(fd => fieldDictMap.set(fd.id, fd.field_key));

  // Extract field keys and transform rules
  const fieldKeys: string[] = [];
  const transformRules: Record<string, string> = {};
  
  (fieldMaps as any[]).forEach((fm) => {
    const fieldKey = fieldDictMap.get(fm.field_dictionary_id);
    if (fieldKey) {
      fieldKeys.push(fieldKey);
      if (fm.transform_rule) {
        transformRules[fieldKey] = fm.transform_rule;
      }
    }
  });

  // 2. Resolve values with transform rules
  return resolveFieldValues(dealId, fieldKeys, transformRules);
}

/**
 * Resolve field values for an entire packet (all templates)
 * Merges transform rules from all templates in the packet
 * 
 * @param dealId - The deal ID to resolve values for
 * @param packetId - The packet ID to get templates from
 * @returns FieldValueResolverResult with formatted values ready for document merge
 */
export async function resolveFieldValuesForPacket(
  dealId: string,
  packetId: string
): Promise<FieldValueResolverResult> {
  // 1. Fetch all template IDs in the packet
  const { data: packetTemplates, error: ptError } = await supabase
    .from('packet_templates')
    .select('template_id')
    .eq('packet_id', packetId);

  if (ptError) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [`Failed to fetch packet templates: ${ptError.message}`],
    };
  }

  if (!packetTemplates || packetTemplates.length === 0) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [],
    };
  }

  const templateIds = packetTemplates.map((pt) => pt.template_id);

  // 2. Fetch all field maps
  const { data: fieldMaps, error: fmError } = await supabase
    .from('template_field_maps')
    .select('field_dictionary_id, transform_rule')
    .in('template_id', templateIds);

  if (fmError) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [`Failed to fetch template field maps: ${fmError.message}`],
    };
  }

  if (!fieldMaps || fieldMaps.length === 0) {
    return {
      values: {},
      details: {},
      emptyFields: [],
      errors: [],
    };
  }

  // Get unique field dictionary IDs
  const fieldDictIds = [...new Set(fieldMaps.map(fm => fm.field_dictionary_id).filter(Boolean))] as string[];

  // Fetch field dictionary entries
  const { data: fieldDictEntries, error: fdError } = await supabase
    .from('field_dictionary')
    .select('id, field_key')
    .in('id', fieldDictIds);

  // Create lookup map for field dictionary
  const fieldDictMap = new Map<string, string>();
  if (!fdError && fieldDictEntries) {
    fieldDictEntries.forEach(fd => fieldDictMap.set(fd.id, fd.field_key));
  }

  // Extract unique field keys and merge transform rules
  // If multiple templates have different transforms for the same field,
  // the last one wins (could be refined based on requirements)
  const fieldKeySet = new Set<string>();
  const transformRules: Record<string, string> = {};

  (fieldMaps as any[]).forEach((fm) => {
    const fieldKey = fieldDictMap.get(fm.field_dictionary_id);
    if (fieldKey) {
      fieldKeySet.add(fieldKey);
      if (fm.transform_rule) {
        transformRules[fieldKey] = fm.transform_rule;
      }
    }
  });

  const fieldKeys = [...fieldKeySet];

  // 3. Resolve values with transform rules
  return resolveFieldValues(dealId, fieldKeys, transformRules);
}

/**
 * Quick utility to get a single formatted field value
 */
export async function resolveSingleFieldValue(
  dealId: string,
  fieldKey: string,
  transformRule?: string
): Promise<string> {
  const transformRules = transformRule ? { [fieldKey]: transformRule } : undefined;
  const result = await resolveFieldValues(dealId, [fieldKey], transformRules);
  return result.values[fieldKey] || '';
}

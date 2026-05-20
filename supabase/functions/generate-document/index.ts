/**
 * Generate Document Edge Function
 * 
 * Orchestrates document generation by processing DOCX templates
 * with deal field values. Supports single document and packet generation.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

// Import shared modules
import type {
  OutputType,
  RequestType,
  GenerationStatus,
  GenerateDocumentRequest,
  TemplateFieldMap,
  FieldDefinition,
  Template,
  GenerationResult,
  JobResult,
  FieldValueData,
} from "../_shared/types.ts";
import { fetchMergeTagMappings, fetchFieldKeyMappings, extractRawValueFromJsonb, getFieldData } from "../_shared/field-resolver.ts";
import { processDocx, validateContentXmlPart, repairTableCellParagraphs, repairOrphanedSdtOpen, repairUnclosedRunProperties, repairUnclosedParagraphsBeforeStructuralClose, repairStraySdtClosingPair } from "../_shared/docx-processor.ts";
import { normalizeWordXml, escapeXmlValue } from "../_shared/tag-parser.ts";
import { formatByDataType, formatCurrency } from "../_shared/formatting.ts";

const DOC_GEN_DEBUG = Deno.env.get("DOC_GEN_DEBUG") === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) {
    console.log(...args);
  }
};

const repairOoXmlTagBoundaries = (xml: string): { xml: string; repaired: number } => {
  let repaired = 0;
  const fixed = xml.replace(/<[^<>]*>/g, (tag) => {
    let next = tag;
    let prev: string;
    do {
      prev = next;
      next = next.replace(
        /(<\/?[A-Za-z][\w.-]*:[A-Za-z][\w.-]*)([A-Za-z][\w.-]*:[A-Za-z][\w.-]*=)/g,
        "$1 $2",
      );
      next = next.replace(
        /(="[^"]*")([A-Za-z][\w.-]*:[A-Za-z][\w.-]*=)/g,
        "$1 $2",
      );
    } while (next !== prev);
    if (next !== tag) repaired += next.length - tag.length;
    return next;
  });
  return { xml: fixed, repaired };
};

let cachedValidFieldKeys: Set<string> | null = null;
let validFieldKeysCacheTimestamp = 0;
const VALID_FIELD_KEYS_TTL_MS = 5 * 60 * 1000;

async function getValidFieldKeys(supabase: any): Promise<Set<string>> {
  const now = Date.now();
  if (cachedValidFieldKeys && now - validFieldKeysCacheTimestamp < VALID_FIELD_KEYS_TTL_MS) {
    debugLog(`[generate-document] Using cached validFieldKeys set with ${cachedValidFieldKeys.size} entries`);
    return cachedValidFieldKeys;
  }

  const PAGE_SIZE = 1000;
  const completeFieldDictionary: Array<{ field_key: string; canonical_key: string | null }> = [];
  let fdFrom = 0;

  while (true) {
    const { data: page, error: fdErr } = await supabase
      .from("field_dictionary")
      .select("field_key, canonical_key")
      .range(fdFrom, fdFrom + PAGE_SIZE - 1);

    if (fdErr) {
      console.error("[generate-document] field_dictionary fetch error:", fdErr.message);
      break;
    }

    const rows = page || [];
    completeFieldDictionary.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    fdFrom += PAGE_SIZE;
  }

  const nextValidFieldKeys = new Set<string>();
  completeFieldDictionary.forEach((fd) => {
    nextValidFieldKeys.add(fd.field_key);
    if (fd.canonical_key) nextValidFieldKeys.add(fd.canonical_key);
  });

  cachedValidFieldKeys = nextValidFieldKeys;
  validFieldKeysCacheTimestamp = now;
  debugLog(`[generate-document] Built validFieldKeys set with ${nextValidFieldKeys.size} entries (including canonical keys)`);

  return nextValidFieldKeys;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================
// Single Document Generation
// ============================================

async function generateSingleDocument(
  supabase: any,
  dealId: string,
  templateId: string,
  packetId: string | null,
  packetName: string | null,
  outputType: OutputType,
  userId: string,
  generationBatchId: string | null
): Promise<GenerationResult> {
  const result: GenerationResult = {
    templateId,
    templateName: "",
    success: false,
  };

  try {
    // 1. Fetch template info
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .select("id, name, file_path, is_active")
      .eq("id", templateId)
      .single();

    if (templateError || !template) {
      result.error = "Template not found";
      return result;
    }

    result.templateName = template.name;
    const isTemplate885 = /885/i.test(template.name || "");
    const isTemplate851D = /851d/i.test(template.name || "");
    // "Lien Mappings" template reuses the RE851D encumbrance pipeline
    // (bucketing + publishSection already runs for ALL templates; here we
    // also enable the indexed-tag rewrite, valid-key extension, addendum
    // appender, and authoring-noise strip so pr_li_* _N_S tags resolve and
    // overflow liens (3+) get appended). Strictly additive: no other
    // RE851D-only behavior (multi-property checkboxes, taxes, Q1–Q6,
    // safety passes, etc.) is enabled here.
    const isLienMappingTemplate = /lien[_\s-]?mapping/i.test(template.name || "");
    const isTemplate851A = /851a/i.test(template.name || "");
    const isEncumbrancePipeline = isTemplate851D || isLienMappingTemplate || isTemplate851A;
    const t885Total = performance.now();
    const tDataFetchStart = performance.now();
    const tDataMappingStart = performance.now();

    if (!template.file_path) {
      result.error = "Template has no DOCX file";
      return result;
    }

    debugLog(`[generate-document] Processing template: ${template.name}`);

    // ── Generation result cache (5 min TTL) ──
    // If the same (deal, template, outputType) was generated successfully in the
    // last 5 minutes AND no deal_section_values have been updated since, clone
    // the prior result instead of re-running the heavy DOCX pipeline.
    // This stops repeated "CPU limit exceeded" failures when the user retries
    // the same RE851D document multiple times in a row.
    try {
      const CACHE_TTL_MS = 5 * 60 * 1000;
      const cacheCutoffIso = new Date(Date.now() - CACHE_TTL_MS).toISOString();

      if (isTemplate851D || /851a/i.test(template.name || "")) {
        throw new Error("Template cache bypassed so runtime field publisher fixes always regenerate the DOCX");
      }

      const { data: cachedDocs } = await supabase
        .from("generated_documents")
        .select("id, output_docx_path, output_pdf_path, output_type, version_number, created_at")
        .eq("deal_id", dealId)
        .eq("template_id", templateId)
        .eq("generation_status", "success")
        .gte("created_at", cacheCutoffIso)
        .order("created_at", { ascending: false })
        .limit(1);

      const cached = cachedDocs && cachedDocs[0];
      if (cached && cached.output_docx_path) {
        // Match outputType: a cached docx_only entry can satisfy a docx_only
        // request; for docx_and_pdf we additionally require the PDF to exist.
        const outputMatches =
          (outputType === "docx_only") ||
          (outputType === "docx_and_pdf" && !!cached.output_pdf_path);

        if (outputMatches) {
          // Check that no deal data has been edited since the cached result.
          const { data: latestSv } = await supabase
            .from("deal_section_values")
            .select("updated_at")
            .eq("deal_id", dealId)
            .order("updated_at", { ascending: false })
            .limit(1);
          const latestSvAt = latestSv && latestSv[0]?.updated_at;
          const cachedAt = cached.created_at;
          const dataIsStableSinceCache = !latestSvAt || new Date(latestSvAt) <= new Date(cachedAt);

          if (dataIsStableSinceCache) {
            // Reuse the cached storage objects by inserting a NEW
            // generated_documents row pointing at the same files. The
            // version trigger auto-increments version_number per
            // (deal_id, template_id) so history stays intact.
            const { data: reusedDoc, error: reuseInsertError } = await supabase
              .from("generated_documents")
              .insert({
                deal_id: dealId,
                template_id: templateId,
                packet_id: packetId,
                template_name: template.name,
                packet_name: packetName,
                generation_batch_id: generationBatchId,
                output_docx_path: cached.output_docx_path,
                output_pdf_path: cached.output_pdf_path,
                output_type: outputType,
                created_by: userId,
                generation_status: "success",
                error_message: null,
              })
              .select()
              .single();

            if (!reuseInsertError && reusedDoc) {
              console.log(
                `[generate-document] Cache HIT for deal=${dealId} template=${templateId} (cached at ${cachedAt}); skipped full regeneration`
              );
              result.success = true;
              result.documentId = reusedDoc.id;
              result.versionNumber = reusedDoc.version_number;
              result.outputPath = cached.output_docx_path;
              return result;
            }
            // If the cached-clone insert fails for any reason, fall through
            // to a normal generation rather than returning an error.
          }
        }
      }
    } catch (cacheErr) {
      console.warn(
        "[generate-document] Generation cache check failed (continuing with full generation):",
        cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
      );
    }

    // 2. Fetch template field maps
    const { data: fieldMaps, error: fmError } = await supabase
      .from("template_field_maps")
      .select("field_dictionary_id, transform_rule, required_flag")
      .eq("template_id", templateId);

    if (fmError) {
      result.error = "Failed to fetch template field maps";
      return result;
    }

    // Get unique field dictionary IDs
    const fieldDictIds = [...new Set((fieldMaps || []).map((fm: any) => fm.field_dictionary_id).filter(Boolean))];

    // Fetch field dictionary entries (include canonical_key for backward compat)
    const { data: fieldDictEntries } = await supabase
      .from("field_dictionary")
      .select("id, field_key, data_type, label, canonical_key")
      .in("id", fieldDictIds);

    // Create lookup map for field dictionary by ID
    const fieldDictMap = new Map<string, FieldDefinition>();
    (fieldDictEntries || []).forEach((fd: any) => fieldDictMap.set(fd.id, fd));

    // Build field maps with field_key from lookup
    const mappedFields: TemplateFieldMap[] = (fieldMaps || []).map((fm: any) => {
      const fieldDict = fieldDictMap.get(fm.field_dictionary_id);
      return {
        field_dictionary_id: fm.field_dictionary_id,
        field_key: fieldDict?.field_key || "",
        transform_rule: fm.transform_rule,
        required_flag: fm.required_flag,
      };
    });

    const fieldTransforms = new Map<string, string>();
    mappedFields.forEach((fm) => {
      if (fm.transform_rule && fm.field_key) {
        fieldTransforms.set(fm.field_key, fm.transform_rule);
      }
    });

    // 3. Fetch ALL deal field values from deal_section_values
    const { data: sectionValues, error: svError } = await supabase
      .from("deal_section_values")
      .select("section, field_values")
      .eq("deal_id", dealId);

    if (svError) {
      console.error(`[generate-document] Failed to fetch deal_section_values:`, svError.message);
      result.error = "Failed to fetch deal section values";
      return result;
    }

    // Get all field_dictionary_ids from JSONB keys
    // Handle composite keys like "borrower1::uuid" used by multi-entity sections
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const allFieldDictIdSet = new Set<string>();
    (sectionValues || []).forEach((sv: any) => {
      Object.keys(sv.field_values || {}).forEach((key: string) => {
        const fieldDictId = key.includes("::") ? key.split("::")[1] : key;
        if (fieldDictId && UUID_RE.test(fieldDictId)) allFieldDictIdSet.add(fieldDictId);
      });
    });
    const allFieldDictIds = [...allFieldDictIdSet];

    debugLog(`[generate-document] Found ${allFieldDictIds.length} unique field_dictionary IDs from deal section values`);
    
    // Fetch ALL field dictionary entries for deal values using batched queries
    // to avoid URL length limits with large .in() arrays
    const FD_BATCH_SIZE = 100;
    const allFieldDictEntries: any[] = [];
    for (let i = 0; i < allFieldDictIds.length; i += FD_BATCH_SIZE) {
      const chunk = allFieldDictIds.slice(i, i + FD_BATCH_SIZE);
      const { data: batchData, error: batchError } = await supabase
        .from("field_dictionary")
        .select("id, field_key, data_type, label, canonical_key")
        .in("id", chunk);
      if (batchError) {
        console.error(`[generate-document] field_dictionary batch fetch error (offset ${i}):`, batchError.message);
        continue;
      }
      allFieldDictEntries.push(...(batchData || []));
    }

    // Create a complete lookup map for all field dictionary entries
    const allFieldDictMap = new Map<string, FieldDefinition>();
    allFieldDictEntries.forEach((fd: any) => allFieldDictMap.set(fd.id, fd));
    debugLog(`[generate-document] Built allFieldDictMap with ${allFieldDictMap.size} entries from ${allFieldDictIds.length} IDs`);

    // Property field_key to short suffix mapping for bridging propertyN.* keys
    const prKeyToSuffix: Record<string, string> = {
      'pr_p_street': 'street', 'pr_p_city': 'city', 'pr_p_state': 'state',
      'pr_p_zip': 'zip', 'pr_p_county': 'county', 'pr_p_address': 'address',
      'pr_p_apn': 'apn', 'pr_p_marketValue': 'marketValue',
      'pr_p_legalDescri': 'legalDescription', 'pr_p_propertyTyp': 'propertyType',
      'pr_p_occupancySt': 'occupancyStatus', 'pr_p_yearBuilt': 'yearBuilt',
      'pr_p_lotSize': 'lotSize', 'pr_p_squareFeet': 'squareFeet',
      'pr_p_numberOfUni': 'numberOfUnits', 'pr_p_country': 'country',
      // RE851D multi-property bridging — UI form keys (PropertyDetailsForm)
      'pr_p_appraiseValue': 'appraised_value',
      'pr_p_owner': 'owner',
      'pr_p_remainingSenior': 'remaining_senior',
      'pr_p_expectedSenior': 'expected_senior',
      // RE851D bridging — additional CSR-saved keys (PropertyDetailsForm)
      'pr_p_propertyType': 'appraisal_property_type',
      'pr_p_occupanc': 'appraisal_occupancy',
      'pr_p_appraiseDate': 'appraised_date',
      'pr_p_ltv': 'ltv',
      'pr_p_cltv': 'cltv',
      'pr_p_descript': 'description',
      'pr_p_purchasePrice': 'purchase_price',
      'pr_p_downPayme': 'down_payment',
      'pr_p_construcType': 'construction_type',
      'pr_p_protectiveEquity': 'protective_equity',
      'pr_p_appraiserStreet': 'appraiser_street',
      'pr_p_appraiserCity': 'appraiser_city',
      'pr_p_appraiserState': 'appraiser_state',
      'pr_p_appraiserZip': 'appraiser_zip',
      'pr_p_appraiserPhone': 'appraiser_phone',
      'pr_p_appraiserEmail': 'appraiser_email',
      'pr_p_zoning': 'zoning',
      'pr_p_floodZone': 'flood_zone',
      'pr_p_pledgedEquity': 'pledged_equity',
      'pr_p_performedBy': 'appraisal_performed_by',
      'pr_p_performeBy': 'appraisal_performed_by',
    };

    if (isTemplate885) {
      debugLog(`[RE885] Data Fetch: ${Math.round(performance.now() - tDataFetchStart)} ms (sections=${(sectionValues || []).length}, fields=${allFieldDictEntries.length})`);
    }
    const tDataProcessingStart = performance.now();

    const fieldValues = new Map<string, FieldValueData>();
    (sectionValues || []).forEach((sv: any) => {
      Object.entries(sv.field_values || {}).forEach(([key, data]: [string, any]) => {
        // Extract actual field_dictionary_id from composite keys (e.g., "borrower1::uuid" -> "uuid")
        const fieldDictId = key.includes("::") ? key.split("::")[1] : key;
        const fieldDict = allFieldDictMap.get(fieldDictId);
        if (fieldDict) {
          const dataType = fieldDict.data_type || "text";
          const rawValue = extractRawValueFromJsonb(data, dataType);
          // Use indexed_key if available for more specific field mapping, otherwise use canonical field_key
          const indexedKey = (data as any)?.indexed_key;
          const resolvedKey = indexedKey || fieldDict.field_key;
          fieldValues.set(resolvedKey, { rawValue, dataType });
          // Also set the canonical field_key so merge tags can match either way
          // BUT only if the canonical key doesn't already belong to a different indexed entity
          // e.g., don't overwrite property1.street (canonical) with property2's data
          if (indexedKey && indexedKey !== fieldDict.field_key) {
            const canonicalHasIndex = /^[a-zA-Z_]+\d+\./.test(fieldDict.field_key);
            if (!canonicalHasIndex && !fieldValues.has(fieldDict.field_key)) {
              fieldValues.set(fieldDict.field_key, { rawValue, dataType });
            }
          }

          // Bridge property composite keys (e.g., "property2::uuid") to propertyN.suffix format
          // so multi-property auto-compute works correctly
          if (key.includes("::")) {
            const entityPrefix = key.split("::")[0]; // e.g., "property1", "property2"
            if (/^property\d+$/i.test(entityPrefix)) {
              const suffix = prKeyToSuffix[fieldDict.field_key];
              if (suffix) {
                const bridgedKey = `${entityPrefix}.${suffix}`;
                fieldValues.set(bridgedKey, { rawValue, dataType });
                debugLog(`[generate-document] Bridged ${key} -> ${bridgedKey} = "${rawValue}"`);
              }
              // Additional bridge: some dictionary entries hard-code their
              // field_key under property1.* (e.g. property1.property_owner,
              // property1.land_classification, property1.fire_zone,
              // property1.net_monthly_income). When these dictionary IDs are
              // re-used under composite keys for property2..N, the resolvedKey
              // above collapses every property's value onto the same
              // "property1.<suffix>" slot — so PROPERTY blocks 2..N render
              // blank. Re-bridge by stripping the literal "property1." prefix
              // from the dictionary's field_key and re-attaching the actual
              // composite entityPrefix. Strictly scoped to the property{N}
              // entity family; no cross-section bleed.
              const fk = fieldDict.field_key || "";
              if (fk.startsWith("property1.") && entityPrefix.toLowerCase() !== "property1") {
                const reBridged = `${entityPrefix}.${fk.substring("property1.".length)}`;
                fieldValues.set(reBridged, { rawValue, dataType });
                debugLog(`[generate-document] Re-bridged ${key} -> ${reBridged} = "${rawValue}"`);
              }
            }
            // RE851D: bridge propertytax{N}::uuid composite keys to propertytax{N}.<suffix>
            // Dictionary keys are propertytax.<suffix>; we strip the canonical prefix
            // and re-attach the indexed entity prefix so per-index publishers below
            // can read propertytax{N}.annual_payment / .delinquent / .delinquent_amount /
            // .source_of_information directly. No cross-index fallback.
            else if (/^propertytax\d+$/i.test(entityPrefix)) {
              const fk = fieldDict.field_key || "";
              if (fk.startsWith("propertytax.")) {
                const suffix = fk.substring("propertytax.".length);
                if (suffix) {
                  const bridgedKey = `${entityPrefix}.${suffix}`;
                  fieldValues.set(bridgedKey, { rawValue, dataType });
                  debugLog(`[generate-document] Bridged ${key} -> ${bridgedKey} = "${rawValue}"`);
                }
              }
            }
          }
        }
      });
    });

    // Ensure field_dictionary field_key is populated even when indexed_key took priority
    for (const sv of (sectionValues || [])) {
      for (const [key, data] of Object.entries((sv as any).field_values || {})) {
        const fieldDictId = key.includes("::") ? key.split("::")[1] : key;
        const fieldDict = allFieldDictMap.get(fieldDictId);
        if (fieldDict && !fieldValues.has(fieldDict.field_key)) {
          const rawValue = extractRawValueFromJsonb(data, fieldDict.data_type || "text");
          fieldValues.set(fieldDict.field_key, { rawValue, dataType: fieldDict.data_type || "text" });
        }
      }
    }

    // ── RE851A: publish primary-property description ──
    // RE851A is single-property and the per-property RE851D publisher does not
    // run for this template. CSR saves the Property Description under composite
    // keys (property{N}::<dict_id> for pr_p_descript), so the bare "pr_p_descript"
    // / "pr_p_descript_1" merge tags can resolve blank depending on forEach
    // ordering. Publish them deterministically from the lowest property index
    // present, falling back to the canonical "description" field if needed.
    if (/851a/i.test(template?.name || "")) {
      // Discover lowest propertyN.description bridged value
      let descSource = "";
      let descValue = "";
      const propIdxRe = /^property(\d+)\.description$/;
      const candidates: Array<{ idx: number; key: string; val: string }> = [];
      for (const [k, v] of fieldValues.entries()) {
        const m = k.match(propIdxRe);
        if (m && v && v.rawValue !== undefined && v.rawValue !== null && String(v.rawValue) !== "") {
          candidates.push({ idx: parseInt(m[1], 10), key: k, val: String(v.rawValue) });
        }
      }
      candidates.sort((a, b) => a.idx - b.idx);
      if (candidates.length > 0) {
        descSource = candidates[0].key;
        descValue = candidates[0].val;
      } else {
        const bare = fieldValues.get("description");
        if (bare && bare.rawValue !== undefined && bare.rawValue !== null && String(bare.rawValue) !== "") {
          descSource = "description";
          descValue = String(bare.rawValue);
        }
      }
      if (descValue) {
        fieldValues.set("pr_p_descript", { rawValue: descValue, dataType: "text" });
        fieldValues.set("pr_p_descript_1", { rawValue: descValue, dataType: "text" });
        console.log(`[RE851A] published pr_p_descript="${descValue}" (source=${descSource})`);
      }

      // RE851A: publish bare pr_pt_actual / pr_pt_estimated (+ _glyph) + pr_pt_annualTaxes
      // for the primary property. The per-property RE851D publisher (gated to /851d/i)
      // never runs for RE851A, so {{#if pr_pt_actual}} / {{#if pr_pt_estimated}}
      // would otherwise resolve falsy. Resolve confidence + annual taxes from the
      // lowest property index present (matches the description publisher above).
      {
        let primaryIdx: number | null = null;
        const idxRe = /^property(\d+)\./;
        const idxs = new Set<number>();
        for (const k of fieldValues.keys()) {
          const m = k.match(idxRe);
          if (m) idxs.add(parseInt(m[1], 10));
        }
        if (idxs.size > 0) primaryIdx = Math.min(...idxs);

        const getVal = (k: string) => {
          const v = fieldValues.get(k);
          return v && v.rawValue !== undefined && v.rawValue !== null ? String(v.rawValue) : "";
        };

        let conf = "";
        let annual = "";
        if (primaryIdx !== null) {
          conf =
            getVal(`propertytax${primaryIdx}.tax_confidence`) ||
            getVal(`property${primaryIdx}.tax_confidence`);
          annual =
            getVal(`propertytax${primaryIdx}.annual_payment`) ||
            getVal(`property${primaryIdx}.annual_property_taxes`) ||
            getVal(`property${primaryIdx}.annual_tax`) ||
            getVal(`property${primaryIdx}.propertytax_annual_payment`);
        }
        // Fallback: scan ALL propertytax{N} / property{N} indices and use the
        // first non-empty tax_confidence / annual figure. Handles deals where
        // the primary property has no propertytax record but a sibling does.
        if (!conf || !annual) {
          const ptIdxRe = /^propertytax(\d+)\./;
          const ptIdxs = new Set<number>();
          for (const k of fieldValues.keys()) {
            const m = k.match(ptIdxRe);
            if (m) ptIdxs.add(parseInt(m[1], 10));
          }
          const allIdxs = Array.from(new Set([...idxs, ...ptIdxs])).sort((a, b) => a - b);
          for (const i of allIdxs) {
            if (!conf) {
              conf =
                getVal(`propertytax${i}.tax_confidence`) ||
                getVal(`property${i}.tax_confidence`);
            }
            if (!annual) {
              annual =
                getVal(`propertytax${i}.annual_payment`) ||
                getVal(`property${i}.annual_property_taxes`) ||
                getVal(`property${i}.annual_tax`) ||
                getVal(`property${i}.propertytax_annual_payment`);
            }
            if (conf && annual) break;
          }
        }
        if (!conf) conf = getVal("tax_confidence");
        if (!annual) {
          annual =
            getVal("annual_property_taxes") ||
            getVal("annual_tax") ||
            getVal("propertytax_annual_payment");
        }
        const confNorm = conf.trim().toLowerCase();
        const isActual = confNorm === "actual";
        const isEstimated = confNorm === "estimated";

        fieldValues.set("pr_pt_actual",          { rawValue: isActual    ? "true" : "false", dataType: "boolean" });
        fieldValues.set("pr_pt_estimated",       { rawValue: isEstimated ? "true" : "false", dataType: "boolean" });
        fieldValues.set("pr_pt_actual_glyph",    { rawValue: isActual    ? "☑" : "☐",        dataType: "text" });
        fieldValues.set("pr_pt_estimated_glyph", { rawValue: isEstimated ? "☑" : "☐",        dataType: "text" });
        if (annual !== "") {
          fieldValues.set("pr_pt_annualTaxes", { rawValue: annual, dataType: "currency" });
        }
        console.log(`[RE851A] published pr_pt_actual=${isActual} pr_pt_estimated=${isEstimated} (confidence="${confNorm || "(none)"}", annual="${annual}", primaryIdx=${primaryIdx ?? "(none)"})`);
      }
    }

    // ── Participant-based contact lookup ──
    // Fetch participants from deal_participants, then resolve their contact records
    {
      const { data: participants, error: partError } = await supabase
        .from("deal_participants")
        .select("role, contact_id, name, email, phone, sequence_order, created_at")
        .eq("deal_id", dealId);

      if (partError) {
        console.error(`[generate-document] Failed to fetch deal_participants:`, partError.message);
      }

      const participantRows = participants || [];
      debugLog(`[generate-document] Found ${participantRows.length} participant(s) for deal`);

      // Collect unique contact_id UUIDs (these are UUID references to contacts.id)
      const contactUuids = [...new Set(
        participantRows.map((p: any) => p.contact_id).filter(Boolean)
      )];

      // Fetch full contact records by UUID id
      let contactRowsByUuid = new Map<string, any>();
      if (contactUuids.length > 0) {
        const { data: contactRows } = await supabase
          .from("contacts")
          .select("id, contact_id, contact_type, full_name, first_name, last_name, email, phone, city, state, company, contact_data")
          .in("id", contactUuids);

        if (contactRows) {
          for (const cr of contactRows) {
            contactRowsByUuid.set(cr.id, cr);
          }
          debugLog(`[generate-document] Fetched ${contactRows.length} contact(s) via participant lookup`);
        }
      }

      const setIfEmpty = (key: string, value: string) => {
        if (value && (!fieldValues.has(key) || !fieldValues.get(key)?.rawValue)) {
          fieldValues.set(key, { rawValue: value, dataType: "text" });
        }
      };

      const forceSet = (key: string, value: string) => {
        if (value) {
          fieldValues.set(key, { rawValue: value, dataType: "text" });
        }
      };

      const injectContact = (contact: any, dotPrefixes: string[], shortPrefix?: string) => {
        const cd = contact.contact_data || {};
        const firstName = cd.first_name || contact.first_name || "";
        const middleName = cd.middle_initial || "";
        const lastName = cd.last_name || contact.last_name || "";
        const assembledName = [firstName, middleName, lastName].filter(Boolean).join(" ");
        const fullName = assembledName || cd.full_name || contact.full_name || "";
        const email = cd.email || contact.email || "";
        const company = cd.company || contact.company || "";
        const phone = cd["phone.cell"] || cd["phone.work"] || cd["phone.home"] || contact.phone || "";
        const fax = cd["phone.fax"] || "";

        // Dot-notation prefixes (e.g., borrower1.full_name, borrower.full_name)
        for (const prefix of dotPrefixes) {
          setIfEmpty(`${prefix}.full_name`, fullName);
          setIfEmpty(`${prefix}.first_name`, firstName);
          setIfEmpty(`${prefix}.last_name`, lastName);
          setIfEmpty(`${prefix}.middle_initial`, middleName);
          setIfEmpty(`${prefix}.email`, email);
          setIfEmpty(`${prefix}.company`, company);
          setIfEmpty(`${prefix}.phone`, phone);
          setIfEmpty(`${prefix}.fax`, fax);
          if (cd["address.street"]) setIfEmpty(`${prefix}.address.street`, cd["address.street"]);
          if (cd["address.city"] || contact.city) setIfEmpty(`${prefix}.address.city`, cd["address.city"] || contact.city);
          if (cd["address.state"] || contact.state) setIfEmpty(`${prefix}.state`, cd["address.state"] || contact.state);
          if (cd["address.zip"]) setIfEmpty(`${prefix}.address.zip`, cd["address.zip"]);
          if (cd["mailing.street"]) setIfEmpty(`${prefix}.mailing_address.street`, cd["mailing.street"]);
          if (cd["mailing.city"]) setIfEmpty(`${prefix}.mailing_address.city`, cd["mailing.city"]);
          if (cd["mailing.state"]) setIfEmpty(`${prefix}.mailing_address.state`, cd["mailing.state"]);
          if (cd["mailing.zip"]) setIfEmpty(`${prefix}.mailing_address.zip`, cd["mailing.zip"]);
          if (cd.tax_id) setIfEmpty(`${prefix}.tax_id`, cd.tax_id);
          if (cd.dob) setIfEmpty(`${prefix}.dob`, cd.dob);
          if (cd.capacity) setIfEmpty(`${prefix}.capacity`, cd.capacity);
          if (cd.vesting) setIfEmpty(`${prefix}.vesting`, cd.vesting);
          if (cd.borrower_type) setIfEmpty(`${prefix}.borrower_type`, cd.borrower_type);
          if (cd.license_number) setIfEmpty(`${prefix}.license_number`, cd.license_number);
        }

        // Short-prefix keys (e.g., br_p_fullName, ld_p_fullName)
        if (shortPrefix) {
          setIfEmpty(`${shortPrefix}_fullName`, fullName);
          setIfEmpty(`${shortPrefix}_firstName`, firstName);
          setIfEmpty(`${shortPrefix}_lastName`, lastName);
          setIfEmpty(`${shortPrefix}_middleInitia`, middleName);
          setIfEmpty(`${shortPrefix}_email`, email);
          setIfEmpty(`${shortPrefix}_company`, company);
          setIfEmpty(`${shortPrefix}_phone`, phone);
          setIfEmpty(`${shortPrefix}_fax`, fax);
          if (cd.tax_id) setIfEmpty(`${shortPrefix}_taxId`, cd.tax_id);
          if (cd["address.street"]) {
            setIfEmpty(`${shortPrefix}_street`, cd["address.street"]);
            setIfEmpty(`${shortPrefix}_address`, cd["address.street"]);
          }
          if (cd["address.city"] || contact.city) setIfEmpty(`${shortPrefix}_city`, cd["address.city"] || contact.city);
          if (cd["address.state"] || contact.state) setIfEmpty(`${shortPrefix}_state`, cd["address.state"] || contact.state);
          if (cd["address.zip"]) setIfEmpty(`${shortPrefix}_zip`, cd["address.zip"]);
          if (cd.capacity) setIfEmpty(`${shortPrefix}_capacity`, cd.capacity);
          if (cd.vesting) setIfEmpty(`${shortPrefix}_vesting`, cd.vesting);
        }
      };

      // Group participants by role
      const borrowerParticipants = participantRows.filter((p: any) => p.role === "borrower");
      const lenderParticipants = participantRows.filter((p: any) => p.role === "lender");
      const brokerParticipants = participantRows.filter((p: any) => p.role === "broker");

      // Select primary borrower (check contact_data.capacity from resolved contacts)
      const primaryBorrower = borrowerParticipants.find((p: any) => {
        if (!p.contact_id) return false;
        const c = contactRowsByUuid.get(p.contact_id);
        const cap = c?.contact_data?.capacity;
        return cap && String(cap).toLowerCase().includes("primary");
      }) || borrowerParticipants[0];

      // Select additional guarantor BEFORE co-borrower to prevent fallback collision
      debugLog(`[generate-document] Borrower participants: ${borrowerParticipants.length}, primary: ${primaryBorrower?.name || 'none'}`);
      for (const bp of borrowerParticipants) {
        const bpc = bp.contact_id ? contactRowsByUuid.get(bp.contact_id) : null;
        const bpCap = bpc?.contact_data?.capacity;
        debugLog(`[generate-document]   participant: name=${bp.name}, contact_id=${bp.contact_id}, capacity=${bpCap}, isPrimary=${bp === primaryBorrower}`);
      }
      const guarantorParticipant = borrowerParticipants.find((p: any) => {
        if (!p.contact_id) return false;
        const c = contactRowsByUuid.get(p.contact_id);
        const cap = c?.contact_data?.capacity;
        return cap && String(cap).toLowerCase().includes("additional guarantor");
      }) || borrowerParticipants.find((p: any) => {
        // Fallback: any borrower participant that is NOT primary and not trustee
        if (!p.contact_id) return false;
        if (p === primaryBorrower) return false;
        const c = contactRowsByUuid.get(p.contact_id);
        const cap = c?.contact_data?.capacity;
        const capLower = cap ? String(cap).toLowerCase() : "";
        return !capLower.includes("primary") && !capLower.includes("co-borrower")
          && !capLower.includes("co-trustee") && !capLower.includes("trustee");
      });

      debugLog(`[generate-document] Guarantor selected: ${guarantorParticipant?.name || 'NONE'}, contact_id=${guarantorParticipant?.contact_id || 'NONE'}`);

      // Select co-borrower (check contact_data.capacity, or fall back to second borrower excluding guarantor)
      const coBorrower = borrowerParticipants.find((p: any) => {
        if (!p.contact_id) return false;
        const c = contactRowsByUuid.get(p.contact_id);
        const cap = c?.contact_data?.capacity;
        return cap && String(cap).toLowerCase().includes("co-borrower");
      }) || borrowerParticipants.find((p: any) => p !== primaryBorrower && p !== guarantorParticipant);

      // Inject primary borrower
      if (primaryBorrower?.contact_id) {
        const bc = contactRowsByUuid.get(primaryBorrower.contact_id);
        if (bc) {
          injectContact(bc, ["borrower1", "borrower"], "br_p");
          debugLog(`[generate-document] Injected borrower contact fields from participant (contact ${bc.contact_id})`);
        }
      }

      // Address fallback: if primary borrower had no address, fill br_p_address /
      // br_p_street / borrower(1).address.* from any borrower participant that has one
      if (!fieldValues.get("br_p_address")?.rawValue) {
        for (const bp of borrowerParticipants) {
          if (!bp.contact_id) continue;
          const c = contactRowsByUuid.get(bp.contact_id);
          const cd = c?.contact_data || {};
          const street = cd["address.street"];
          if (street && String(street).trim() !== "") {
            setIfEmpty("br_p_address", String(street));
            setIfEmpty("br_p_street", String(street));
            setIfEmpty("borrower.address.street", String(street));
            setIfEmpty("borrower1.address.street", String(street));
            if (cd["address.city"] || c?.city) {
              setIfEmpty("br_p_city", cd["address.city"] || c.city);
              setIfEmpty("borrower.address.city", cd["address.city"] || c.city);
              setIfEmpty("borrower1.address.city", cd["address.city"] || c.city);
            }
            if (cd["address.state"] || c?.state) {
              setIfEmpty("br_p_state", cd["address.state"] || c.state);
              setIfEmpty("borrower.state", cd["address.state"] || c.state);
              setIfEmpty("borrower1.state", cd["address.state"] || c.state);
            }
            if (cd["address.zip"]) {
              setIfEmpty("br_p_zip", cd["address.zip"]);
              setIfEmpty("borrower.address.zip", cd["address.zip"]);
              setIfEmpty("borrower1.address.zip", cd["address.zip"]);
            }
            debugLog(`[generate-document] br_p_address fallback from participant ${bp.name}: "${street}"`);
            break;
          }
        }
      }

      // Inject co-borrower (only if different from primary)
      if (coBorrower?.contact_id && coBorrower.contact_id !== primaryBorrower?.contact_id) {
        const cbc = contactRowsByUuid.get(coBorrower.contact_id);
        if (cbc) {
          injectContact(cbc, ["co_borrower1", "coborrower", "co_borrower"], undefined);
          debugLog(`[generate-document] Injected co-borrower contact fields from participant (contact ${cbc.contact_id})`);
        }
      }

      if (guarantorParticipant?.contact_id) {
        const gc = contactRowsByUuid.get(guarantorParticipant.contact_id);
        if (gc) {
          const cd = gc.contact_data || {};
          const firstName = cd.first_name || gc.first_name || "";
          const middleName = cd.middle_initial || "";
          const lastName = cd.last_name || gc.last_name || "";
          const assembledName = [firstName, middleName, lastName].filter(Boolean).join(" ");
          const fullName = assembledName || cd.full_name || gc.full_name || "";
          const email = cd.email || gc.email || "";
          const phone = cd["phone.cell"] || cd["phone.work"] || cd["phone.home"] || gc.phone || "";

          debugLog(`[generate-document] Guarantor injection: fullName="${fullName}", firstName="${firstName}", lastName="${lastName}"`);

          setIfEmpty("br_p_guarantoFullName", fullName);
          setIfEmpty("br_p_guarantoFirstName", firstName);
          setIfEmpty("br_p_guarantoLastName", lastName);
          setIfEmpty("br_p_guarantoMiddleInitia", middleName);
          setIfEmpty("br_ag_fullName", fullName);
          setIfEmpty("br_ag_firstName", firstName);
          setIfEmpty("br_ag_lastName", lastName);
          setIfEmpty("br_ag_email", email);
          setIfEmpty("br_ag_phone", phone);

          debugLog(`[generate-document] After setIfEmpty, br_ag_fullName = "${fieldValues.get("br_ag_fullName")?.rawValue}"`);
          debugLog(`[generate-document] Injected guarantor contact fields from participant (contact ${gc.contact_id})`);
        }
      } else {
        debugLog(`[generate-document] WARNING: No guarantor participant found!`);
      }

      // Inject lender
      const orderedLenderParticipants = [...lenderParticipants].sort((a: any, b: any) => {
        const aSeq = typeof a.sequence_order === "number" ? a.sequence_order : Number.MAX_SAFE_INTEGER;
        const bSeq = typeof b.sequence_order === "number" ? b.sequence_order : Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
      const primaryLender = orderedLenderParticipants[0];
      if (primaryLender?.contact_id) {
        const lc = contactRowsByUuid.get(primaryLender.contact_id);
        if (lc) {
          injectContact(lc, ["lender1", "lender"], "ld_p");

          // Bridge lender name to ld_p_lenderName / lender.name so template tags
          // like «Lender_Name» (which resolve via alias to lender.name → ld_p_lenderName)
          // can find the value.
          const lcd = lc.contact_data || {};
          const lFirstName = lcd.first_name || lc.first_name || "";
          const lMiddleName = lcd.middle_initial || "";
          const lLastName = lcd.last_name || lc.last_name || "";
          const lAssembledName = [lFirstName, lMiddleName, lLastName].filter(Boolean).join(" ");
          const lFullName = lAssembledName || lcd.full_name || lc.full_name || "";
          setIfEmpty("ld_p_lenderName", lFullName);
          setIfEmpty("lender.name", lFullName);
          setIfEmpty("Lender.Name", lFullName);
          setIfEmpty("ld_p_fullNameIfEntity", lFullName);

          // Bridge Lender Vesting (CSR Lender Info → Vesting) to ALL aliases
          // the templates may reference. Field dictionary uses `ld_p_vesting`,
          // but some templates (e.g. RE851D) reference the truncated legacy
          // tag `{{ld_p_vestin}}` and the dot-key `lender.vesting`.
          const primaryVesting = lcd.vesting !== undefined && lcd.vesting !== null ? String(lcd.vesting).trim() : "";
          const fallbackVesting = orderedLenderParticipants
            .map((p: any) => p.contact_id ? contactRowsByUuid.get(p.contact_id)?.contact_data?.vesting : "")
            .find((v: any) => v !== undefined && v !== null && String(v).trim() !== "");
          const lVesting = primaryVesting || (fallbackVesting !== undefined && fallbackVesting !== null ? String(fallbackVesting).trim() : "");
          if (lVesting) {
            setIfEmpty("ld_p_vesting", lVesting);
            setIfEmpty("ld_p_vestin", lVesting);
            setIfEmpty("lender.vesting", lVesting);
            setIfEmpty("lender1.vesting", lVesting);
          }

          // Bridge lender type from contact_data
          if (lcd.type) {
            setIfEmpty("ld_p_lenderType", lcd.type);
            setIfEmpty("lender1.type", lcd.type);
            setIfEmpty("lender.type", lcd.type);
          }

          // Bridge investor questionnaire due date from contact_data
          if (lcd.investor_questionnaire_due_date) {
            setIfEmpty("ld_p_investorQuestiDueDate", lcd.investor_questionnaire_due_date);
            setIfEmpty("lender1.investor_questionnaire_due_date", lcd.investor_questionnaire_due_date);
          }

          // Bridge investor questionnaire due (boolean checkbox) from contact_data
          const iqDueRaw = lcd.investor_questionnaire_due;
          const iqDueChecked =
            iqDueRaw === true || iqDueRaw === 'true' || iqDueRaw === 1 || iqDueRaw === '1' || iqDueRaw === 'yes';
          setIfEmpty("ld_p_investorQuestiDue", iqDueChecked ? "true" : "false");
          setIfEmpty("lender1.investor_questionnaire_due", iqDueChecked ? "true" : "false");
          setIfEmpty("lender.investor_questionnaire_due", iqDueChecked ? "true" : "false");
          // Pre-rendered checkbox glyph for templates that prefer a single placeholder
          setIfEmpty("ld_p_investorQuestiDueCheckbox", iqDueChecked ? "☑" : "☐");

          debugLog(`[generate-document] Injected lender contact fields from participant (contact ${lc.contact_id}), lenderName="${lFullName}"`);
        }
      }

      // Inject broker (force-override since broker data is authoritative from Contacts)
      const primaryBroker = brokerParticipants[0];
      if (primaryBroker?.contact_id) {
        const cr = contactRowsByUuid.get(primaryBroker.contact_id);
        if (cr) {
          const cd = cr.contact_data || {};
          const firstName = cd.first_name || cr.first_name || "";
          const middleName = cd.middle_initial || "";
          const lastName = cd.last_name || cr.last_name || "";
          const assembledName = [firstName, middleName, lastName].filter(Boolean).join(" ");
          const fullName = assembledName || cd.full_name || cr.full_name || "";
          const email = cd.email || cr.email || "";
          const company = cd.company || cr.company || "";
          const phone = cd["phone.cell"] || cd["phone.work"] || cd["phone.home"] || cr.phone || "";
          const fax = cd["phone.fax"] || "";
          const license = cd.license_number || cd.License || cd.license || cr.license_number || "";

          // Build full broker address from components
          const addrStreet = cd["address.street"] || "";
          const addrCity = cd["address.city"] || cr.city || "";
          const addrState = cd["address.state"] || cr.state || "";
          const addrZip = cd["address.zip"] || "";
          const fullAddress = [addrStreet, [addrCity, addrState, addrZip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

          // Representative name: use explicit broker_representative if set, else assemble from first/last
          const representativeName = cd.broker_representative || cd.representative || fullName;
          // Representative license: use rep_license if available, else fall back to broker license
          const repLicense = cd.rep_license || cd.representative_license || license;

          // Force-set short prefix keys (bk_p_*)
          forceSet("bk_p_fullName", fullName);
          // Add trailing non-breaking space (\u00A0) to firstName and lastName so adjacent tags like
          // {{bk_p_firstName}}{{bk_p_lastName}}{{bk_p_license}} render with proper spacing.
          // Regular spaces get stripped by Word XML; \u00A0 is preserved.
          forceSet("bk_p_firstName", firstName ? firstName + "\u00A0" : "");
          forceSet("bk_p_lastName", lastName ? lastName + "\u00A0" : "");
          forceSet("bk_p_middleInitia", middleName);
          forceSet("bk_p_email", email);
          forceSet("bk_p_company", company);
          forceSet("bk_p_phone", phone);
          forceSet("bk_p_cellPhone", cd["phone.cell"] || cd["phone.mobile"] || "");
          forceSet("bk_p_fax", fax);
          forceSet("bk_p_brokerName", company);
          forceSet("bk_p_brokerRepres", representativeName);
          forceSet("bk_p_brokerSignat", fullName);
          forceSet("bk_p_repSignature", representativeName);
          if (fullAddress) forceSet("bk_p_brokerAddres", fullAddress);
          if (license) {
            forceSet("bk_p_brokerLicens", String(license));
            forceSet("bk_p_license", String(license));
            forceSet("broker.License", String(license));
            forceSet("broker.license_number", String(license));
            forceSet("broker1.license_number", String(license));
          }
          if (repLicense) {
            forceSet("bk_p_repLicense", String(repLicense));
          }

          // Force-set dot-notation keys
          for (const prefix of ["broker1", "broker"]) {
            forceSet(`${prefix}.full_name`, fullName);
            forceSet(`${prefix}.first_name`, firstName);
            forceSet(`${prefix}.last_name`, lastName);
            forceSet(`${prefix}.middle_initial`, middleName);
            forceSet(`${prefix}.email`, email);
            forceSet(`${prefix}.company`, company);
            forceSet(`${prefix}.phone`, phone);
            forceSet(`${prefix}.fax`, fax);
            if (addrStreet) forceSet(`${prefix}.address.street`, addrStreet);
            if (addrCity) forceSet(`${prefix}.address.city`, addrCity);
            if (addrState) forceSet(`${prefix}.state`, addrState);
            if (addrZip) forceSet(`${prefix}.address.zip`, addrZip);
            if (cd.tax_id) forceSet(`${prefix}.tax_id`, cd.tax_id);
            if (license) forceSet(`${prefix}.License`, String(license));
          }

          debugLog(`[generate-document] Force-injected broker contact fields from participant (contact ${cr.contact_id}, license: ${license || 'n/a'}, rep: ${representativeName || 'n/a'}, address: ${fullAddress || 'n/a'})`);
        }
      }
    }
    // Bridge indexed entity keys (e.g., borrower1.full_name) to non-indexed aliases
    // (e.g., borrower.full_name) so legacy merge tag aliases can resolve
    const indexedPattern = /^([a-zA-Z_]+?)(\d+)\.(.+)$/;
    for (const [key, val] of [...fieldValues.entries()]) {
      const m = key.match(indexedPattern);
      if (m && m[2] === "1") {
        const nonIndexedKey = `${m[1]}.${m[3]}`;
        if (!fieldValues.has(nonIndexedKey)) {
          fieldValues.set(nonIndexedKey, val);
        }
      }
    }

    // Force text dataType for identifier fields that should never be number-formatted
    for (const [key, val] of fieldValues.entries()) {
      const lk = key.toLowerCase();
      if (lk.includes("loannumber") || lk.includes("loan_number") || lk.includes("accountnumber") || lk.includes("account_number") || lk.includes("licensenumber") || lk.includes("license_number") || lk.includes("brokerlicens") || lk.includes("brokerid")) {
        if (val.dataType !== "text") {
          debugLog(`[generate-document] Overriding dataType for ${key}: ${val.dataType} -> text`);
          fieldValues.set(key, { ...val, dataType: "text" });
        }
      }
    }

    // Bridge dot-notation origination keys to short-form aliases
    // e.g., origination_esc.escrow_number -> escrow_number
    // This ensures legacy template tags can resolve origination fields
    for (const [key, val] of [...fieldValues.entries()]) {
      if (key.startsWith("origination_")) {
        const dotIdx = key.indexOf(".");
        if (dotIdx > 0) {
          const shortKey = key.substring(dotIdx + 1);
          if (shortKey && !fieldValues.has(shortKey)) {
            fieldValues.set(shortKey, val);
          }
        }
      }
    }

    debugLog(`[generate-document] Resolved ${fieldValues.size} field values for ${template.name}`);
    // Log a sample of field values for debugging
    const sampleKeys = [...fieldValues.keys()].slice(0, 30);
    debugLog(`[generate-document] Sample field keys: ${sampleKeys.join(", ")}`);
    // Log specific fields we expect to find
    const debugFields = ["ln_p_loanAmount", "ln_p_originalAmount", "of_fe_801LenderLoanOrigin", "pr_p_street", "br_p_fullName", "of_re_interestRate", "of_re_impoundHazardIns", "of_re_subtotalDeductions", "origination_esc.estimated_closing", "of_re_estimatedClosing"];
    for (const df of debugFields) {
      const val = fieldValues.get(df);
      debugLog(`[generate-document] Field "${df}" = ${val ? JSON.stringify(val) : "NOT FOUND"}`);
    }

    // RE885 alias publisher: ensure newly added dictionary keys are exposed under the
    // merge-tag names the template expects. Templates may reference the dotted key
    // (`{{origination_esc.estimated_closing}}`) OR a flat alias (`{{of_re_estimatedClosing}}`).
    {
      // Estimated Closing — bind to all known tag variants the template may use.
      // DOCX engines often fail to resolve deep dot notation reliably, so we
      // publish flat aliases as well.
      const ec = fieldValues.get("origination_esc.estimated_closing");
      if (ec && (ec.rawValue !== null && ec.rawValue !== undefined && ec.rawValue !== "")) {
        const ecData = { rawValue: ec.rawValue, dataType: ec.dataType || "date" };
        const ecAliases = [
          "of_re_estimatedClosing",
          "origination_esc_estimated_closing",
          "estimatedClosing",
          "estimated_closing",
          "origination_esc.estimated_closing",
        ];
        for (const a of ecAliases) {
          if (!fieldValues.has(a)) fieldValues.set(a, ecData);
        }
      }

      // Credit Life / Disability Insurance Label — flat-key field (of_fe_creditLifediInsuraLabel)
      // is loaded by id->key mapping; publish additional safe aliases to cover any
      // template variant (legacy dot-notation or flat alternates). Source value is
      // taken from the dictionary key first, then any pre-existing alias.
      const clRaw =
        fieldValues.get("of_fe_creditLifediInsuraLabel") ||
        fieldValues.get("origination_fees.credit_life_disability_insurance_label") ||
        fieldValues.get("creditLifeDisabilityInsurance_label");
      if (clRaw && (clRaw.rawValue !== null && clRaw.rawValue !== undefined && clRaw.rawValue !== "")) {
        const clData = { rawValue: clRaw.rawValue, dataType: clRaw.dataType || "text" };
        const clAliases = [
          "of_fe_creditLifediInsuraLabel",
          "of_fe_creditLifeDisabilityInsuraLabel",
          "of_fe_creditLifeDisabilityInsurance_label",
          "creditLifeDisabilityInsurance_label",
          "credit_life_disability_insurance_label",
          "origination_fees.credit_life_disability_insurance_label",
          "origination_fees_credit_life_disability_insurance_label",
        ];
        for (const a of clAliases) {
          if (!fieldValues.has(a)) fieldValues.set(a, clData);
        }
      }

      const sd = fieldValues.get("of_re_subtotalDeductions") || fieldValues.get("origination_fees.re885_subtotal_deductions");
      if (sd && sd.rawValue) {
        if (!fieldValues.has("of_re_subtotalDeductions")) {
          fieldValues.set("of_re_subtotalDeductions", { rawValue: sd.rawValue, dataType: sd.dataType || "currency" });
        }
        if (!fieldValues.has("origination_fees.re885_subtotal_deductions")) {
          fieldValues.set("origination_fees.re885_subtotal_deductions", { rawValue: sd.rawValue, dataType: sd.dataType || "currency" });
        }
      }

      // Estimated Cash at Closing alias publisher (RE885)
      const ecac = fieldValues.get("origination_fees.re885_cash_at_closing_amount")
        || fieldValues.get("of_re_estimatedCashAtClosing");
      if (ecac && ecac.rawValue !== null && ecac.rawValue !== undefined && ecac.rawValue !== "") {
        const ecacData = { rawValue: ecac.rawValue, dataType: ecac.dataType || "currency" };
        for (const a of [
          "origination_fees.re885_cash_at_closing_amount",
          "origination_fees_re885_cash_at_closing_amount",
          "of_re_estimatedCashAtClosing",
          "re885_cash_at_closing_amount",
        ]) {
          if (!fieldValues.has(a)) fieldValues.set(a, ecacData);
        }
      }

      // RE885 Cash at Closing — derive boolean checkbox flags + canonical label
      // from origination_fees.re885_cash_at_closing_option (UI stores codes:
      // "payable_to_you" / "you_must_pay"). Publishes:
      //   re885_cash_payable_to_you / re885_cash_you_must_pay (boolean)
      //   origination_fees.re885_cash_at_closing_option (normalized label, overwrite)
      //   origination_fees.re885_cash_at_closing_amount_label (alias)
      {
        const rawOpt = String(
          fieldValues.get("origination_fees.re885_cash_at_closing_option")?.rawValue ?? ""
        ).trim();
        const norm = rawOpt.toLowerCase().replace(/[\s_-]+/g, "");
        let canonical = "";
        if (norm === "payabletoyou")    canonical = "Payable to you";
        else if (norm === "youmustpay") canonical = "You Must Pay";

        // Direct boolean dictionary fields (UI checkboxes) take precedence when set true
        const boolPayable = String(
          fieldValues.get("origination_fees.re885_cash_payable_to_you")?.rawValue ??
          fieldValues.get("of_fe_estimatedCashPayableToYou")?.rawValue ?? ""
        ).toLowerCase() === "true";
        const boolMustPay = String(
          fieldValues.get("origination_fees.re885_cash_you_must_pay")?.rawValue ??
          fieldValues.get("of_fe_estimatedCashYouMustPay")?.rawValue ?? ""
        ).toLowerCase() === "true";

        const isPayable = boolPayable || canonical === "Payable to you";
        const isMustPay = boolMustPay || canonical === "You Must Pay";

        fieldValues.set("re885_cash_payable_to_you", { rawValue: isPayable ? "true" : "false", dataType: "boolean" });
        fieldValues.set("re885_cash_you_must_pay",   { rawValue: isMustPay ? "true" : "false", dataType: "boolean" });
        fieldValues.set("of_fe_estimatedCashPayableToYou", { rawValue: isPayable ? "true" : "false", dataType: "boolean" });
        fieldValues.set("of_fe_estimatedCashYouMustPay",   { rawValue: isMustPay ? "true" : "false", dataType: "boolean" });

        if (!canonical) {
          if (isPayable) canonical = "Payable to you";
          else if (isMustPay) canonical = "You Must Pay";
        }
        if (canonical) {
          fieldValues.set("origination_fees.re885_cash_at_closing_option",       { rawValue: canonical, dataType: "text" });
          fieldValues.set("origination_fees.re885_cash_at_closing_amount_label", { rawValue: canonical, dataType: "text" });
        }
        debugLog(
          `[generate-document] RE885 CashAtClosingType raw="${rawOpt}" canonical="${canonical}" payable=${isPayable} mustPay=${isMustPay}`
        );
      }

      debugLog(
        `[generate-document] RE885 alias publisher: ` +
          `of_re_estimatedClosing="${fieldValues.get("of_re_estimatedClosing")?.rawValue ?? ""}" ` +
          `origination_esc.estimated_closing="${fieldValues.get("origination_esc.estimated_closing")?.rawValue ?? ""}" ` +
          `of_fe_creditLifediInsuraLabel="${fieldValues.get("of_fe_creditLifediInsuraLabel")?.rawValue ?? ""}" ` +
          `of_re_subtotalDeductions="${fieldValues.get("of_re_subtotalDeductions")?.rawValue ?? ""}" ` +
          `EstimatedCashAtClosing="${fieldValues.get("origination_fees.re885_cash_at_closing_amount")?.rawValue ?? ""}"`
      );

      // RE885 Interest / Hazard / MI / Property-Tax short-name alias publisher.
      // The UI persists these under the dotted dictionary keys (901/1001/1002/1004),
      // but the RE885 template uses the short tags `of_int_days`, `of_int_pd`,
      // `of_haz_mon`, `of_haz_amt`, `of_mi_mon`, `of_mi_amt`, `of_tax_mon`, `of_tax_amt`.
      // Resolve from (short alias → dictionary alias → dotted UI key) and publish
      // only when the target is empty so existing publishers are never overridden.
      const re885ShortAliasMap: Array<{
        out: string;
        sources: string[];
        dataType: string;
      }> = [
        { out: "of_int_days", sources: ["of_int_days", "origination_fees.901_interest_for_days_days"], dataType: "number" },
        { out: "of_int_pd",   sources: ["of_int_pd",   "origination_fees.901_interest_for_days_per_day"], dataType: "currency" },
        { out: "of_haz_mon",  sources: ["of_haz_mon",  "of_fe_hazardInsuraMonths",  "origination_fees.1001_hazard_insurance_months"],     dataType: "number" },
        { out: "of_haz_amt",  sources: ["of_haz_amt",  "of_fe_hazardInsuraPerMonth","origination_fees.1001_hazard_insurance_per_month"],  dataType: "currency" },
        { out: "of_mi_mon",   sources: ["of_mi_mon",   "of_fe_mortgageInsuraMonths","origination_fees.1002_mortgage_insurance_months"],   dataType: "number" },
        { out: "of_mi_amt",   sources: ["of_mi_amt",   "of_fe_mortgageInsuraPerMonth","origination_fees.1002_mortgage_insurance_per_month"], dataType: "currency" },
        { out: "of_tax_mon",  sources: ["of_tax_mon",  "of_fe_coProperTaxesMonths", "origination_fees.1004_co_property_taxes_months"],    dataType: "number" },
        { out: "of_tax_amt",  sources: ["of_tax_amt",  "of_fe_coProperTaxesPer",    "origination_fees.1004_co_property_taxes_per_month"], dataType: "currency" },
      ];
      const re885ShortAliasResolved: Record<string, unknown> = {};
      for (const { out, sources, dataType } of re885ShortAliasMap) {
        let src: any = undefined;
        for (const s of sources) {
          const resolved = getFieldData(s, fieldValues)?.data;
          if (resolved && resolved.rawValue !== null && resolved.rawValue !== undefined && resolved.rawValue !== "") {
            src = resolved;
            break;
          }
        }

        const existingOut = getFieldData(out, fieldValues)?.data;
        const hasUsableOut = !!existingOut && existingOut.rawValue !== null && existingOut.rawValue !== undefined && existingOut.rawValue !== "";

        if (src) {
          if (!hasUsableOut) {
            fieldValues.set(out, { rawValue: src.rawValue, dataType: src.dataType || dataType });
          }
          re885ShortAliasResolved[out] = fieldValues.get(out)?.rawValue ?? "";
        } else {
          re885ShortAliasResolved[out] = existingOut?.rawValue ?? "";
        }
      }
      debugLog(
        `[generate-document] RE885 short-alias publisher: ${JSON.stringify(re885ShortAliasResolved)}`
      );

      // RE885 Proposed Loan Term unit -> mutually exclusive boolean checkboxes.
      // UI persists single text value `of_re_loanTermUnit` ('years'|'months').
      // Template uses `{{#if of_re_proposedLoanTerm.years}}` / `.months`.
      const rawUnit = (
        fieldValues.get("of_re_loanTermUnit")?.rawValue ??
        fieldValues.get("origination_fees.re885_loan_term_unit")?.rawValue ??
        ""
      );
      const unit = String(rawUnit ?? "").trim().toLowerCase();
      const isYears = unit === "years" || unit === "year" || unit === "y";
      const isMonths = unit === "months" || unit === "month" || unit === "m";
      fieldValues.set("of_re_proposedLoanTerm.years", { rawValue: isYears ? "true" : "false", dataType: "boolean" });
      fieldValues.set("of_re_proposedLoanTerm.months", { rawValue: isMonths ? "true" : "false", dataType: "boolean" });
      debugLog(`[generate-document] RE885 loan term checkboxes: unit="${unit}" years=${isYears} months=${isMonths}`);

      // RE885 Interest Rate Fixed/Adjustable -> mutually exclusive boolean checkboxes.
      // UI persists `origination_fees.re885_rate_type_fixed` / `_adjustable` (boolean).
      // Template uses `{{#if of_re_interestRate.fixed}}` / `.adjustable`.
      const toBool = (v: unknown): boolean => {
        if (v === true) return true;
        if (v === false || v === null || v === undefined) return false;
        const s = String(v).trim().toLowerCase();
        return s === "true" || s === "yes" || s === "y" || s === "1" || s === "checked" || s === "on";
      };
      const fixedRaw =
        fieldValues.get("origination_fees.re885_rate_type_fixed")?.rawValue ??
        fieldValues.get("of_re_rateTypeFixed")?.rawValue;
      const adjRaw =
        fieldValues.get("origination_fees.re885_rate_type_adjustable")?.rawValue ??
        fieldValues.get("of_re_rateTypeAdjustable")?.rawValue;
      const isFixed = toBool(fixedRaw);
      const isAdjustable = toBool(adjRaw);
      fieldValues.set("of_re_interestRate.fixed", { rawValue: isFixed ? "true" : "false", dataType: "boolean" });
      fieldValues.set("of_re_interestRate.adjustable", { rawValue: isAdjustable ? "true" : "false", dataType: "boolean" });
      debugLog(`[generate-document] RE885 interest rate checkboxes: fixed=${isFixed} adjustable=${isAdjustable} (raw fixed="${fixedRaw}" adjustable="${adjRaw}")`);

      // RE885 Prepayment Penalty enabled -> boolean checkbox.
      // UI persists `loan_terms.penalties.prepayment.enabled` as 'true'/'false' string.
      // Template uses `{{#if ln_pn_prepaymePenalt}}`.
      const ppRaw =
        fieldValues.get("loan_terms.penalties.prepayment.enabled")?.rawValue ??
        fieldValues.get("loan_terms.prepayment_penalty_enabled")?.rawValue;
      const isPP = toBool(ppRaw);
      fieldValues.set("ln_pn_prepaymePenalt", { rawValue: isPP ? "true" : "false", dataType: "boolean" });
      debugLog(`[generate-document] RE885 prepayment penalty checkbox: enabled=${isPP} (raw="${ppRaw}")`);

      // RE885 Interest Guarantee enabled -> boolean checkbox.
      // UI persists `loan_terms.penalties.interest_guarantee.enabled` as 'true'/'false' string.
      // Template references nested dot path which some engines mishandle; publish a strict
      // boolean under the same key plus a flat alias for safety.
      const igRaw = fieldValues.get("loan_terms.penalties.interest_guarantee.enabled")?.rawValue;
      const isIG = toBool(igRaw);
      fieldValues.set("loan_terms.penalties.interest_guarantee.enabled", { rawValue: isIG ? "true" : "false", dataType: "boolean" });
      fieldValues.set("loan_terms_penalties_interest_guarantee_enabled", { rawValue: isIG ? "true" : "false", dataType: "boolean" });
      debugLog(`[generate-document] RE885 interest guarantee checkbox: enabled=${isIG} (raw="${igRaw}")`);
    }

    // Inject systemDate so only templates using {{systemDate}} get the current date
    const systemDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    fieldValues.set("systemDate", { rawValue: systemDate, dataType: "date" });
    fieldValues.set("currentDate", { rawValue: systemDate, dataType: "date" });
    debugLog(`[generate-document] Injected systemDate and currentDate: ${systemDate}`);

    // Auto-compute origination_app.income.total_income as the sum of all income components.
    // Treats null/undefined/non-numeric values as 0. Does not overwrite if already provided.
    {
      const incomeKeys = [
        "origination_app.income.salary",
        "origination_app.income.interest",
        "origination_app.income.dividend",
        "origination_app.income.rental",
        "origination_app.income.other",
      ];
      const toNumber = (v: unknown): number => {
        if (v === null || v === undefined || v === "") return 0;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
        return isNaN(n) ? 0 : n;
      };
      const totalIncomeKey = "origination_app.income.total_income";
      const existingTotal = fieldValues.get(totalIncomeKey);
      if (!existingTotal || existingTotal.rawValue === null || existingTotal.rawValue === undefined || existingTotal.rawValue === "") {
        let total = 0;
        for (const k of incomeKeys) {
          const fd = getFieldData(k, fieldValues);
          if (fd) total += toNumber(fd.data.rawValue);
        }
        fieldValues.set(totalIncomeKey, { rawValue: total, dataType: "currency" });
        debugLog(`[generate-document] Computed ${totalIncomeKey} = ${total}`);
      }
      // Backend-only alias for document mapping: {{oo_totalIncome}}
      const finalTotal = fieldValues.get(totalIncomeKey);
      if (finalTotal) {
        fieldValues.set("oo_totalIncome", { rawValue: finalTotal.rawValue, dataType: "currency" });
      }
    }

    // Auto-compute origination_app.expense.total_expenses as the sum of all expense components.
    // Treats null/undefined/non-numeric values as 0. Does not overwrite if already provided.
    {
      const expenseKeys = [
        "origination_app.expense.credit_card",
        "origination_app.expense.mortgage",
        "origination_app.expense.spousal_child_support",
        "origination_app.expense.insurance",
        "origination_app.expense.automobile",
        "origination_app.expense.other",
      ];
      const toNumber = (v: unknown): number => {
        if (v === null || v === undefined || v === "") return 0;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
        return isNaN(n) ? 0 : n;
      };
      const totalExpenseKey = "origination_app.expense.total_expenses";
      const existingTotal = fieldValues.get(totalExpenseKey);
      if (!existingTotal || existingTotal.rawValue === null || existingTotal.rawValue === undefined || existingTotal.rawValue === "") {
        let total = 0;
        for (const k of expenseKeys) {
          const fd = getFieldData(k, fieldValues);
          if (fd) total += toNumber(fd.data.rawValue);
        }
        fieldValues.set(totalExpenseKey, { rawValue: total, dataType: "currency" });
        debugLog(`[generate-document] Computed ${totalExpenseKey} = ${total}`);
      }
      // Backend-only alias for document mapping: {{oo_totalExpenses}}
      const finalTotalExp = fieldValues.get(totalExpenseKey);
      if (finalTotalExp) {
        fieldValues.set("oo_totalExpenses", { rawValue: finalTotalExp.rawValue, dataType: "currency" });
      }
      // Backend-only alias: {{oo_netAnnualIncome}} = (oo_totalIncome * 12) - oo_totalExpenses
      {
        const toNum = (v: any) => {
          const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
          return isNaN(n) ? 0 : n;
        };
        const inc = toNum(fieldValues.get("oo_totalIncome")?.rawValue);
        const exp = toNum(fieldValues.get("oo_totalExpenses")?.rawValue);
        const net = (inc * 12) - exp;
        fieldValues.set("oo_netAnnualIncome", { rawValue: net, dataType: "currency" });
        debugLog(`[generate-document] Computed oo_netAnnualIncome = ${inc}*12 - ${exp} = ${net}`);
      }
    }

    // Auto-compute borrower.borrower_description if not already set
    const existingDesc = fieldValues.get("borrower.borrower_description");
    if (!existingDesc || !existingDesc.rawValue) {
      const borrowerNames: { index: number; name: string }[] = [];
      for (const [key, val] of fieldValues.entries()) {
        const m = key.match(/^borrower(\d+)\.full_name$/);
        if (m && val.rawValue) {
          borrowerNames.push({ index: parseInt(m[1], 10), name: String(val.rawValue) });
        }
      }
      if (borrowerNames.length > 0) {
        borrowerNames.sort((a, b) => a.index - b.index);
        const description = borrowerNames.map(b => b.name).join(" and ");
        fieldValues.set("borrower.borrower_description", { rawValue: description, dataType: "text" });
        debugLog(`[generate-document] Auto-computed borrower.borrower_description = "${description}"`);
      }
    }

    // Auto-compute propertyN.address from component fields for all properties
    // First, discover all property indices from field values
    const propertyIndices = new Set<number>();
    for (const [key] of fieldValues.entries()) {
      const propMatch = key.match(/^property(\d+)\./i);
      if (propMatch) {
        propertyIndices.add(parseInt(propMatch[1], 10));
      }
    }
    // Ensure at least property1 is checked
    propertyIndices.add(1);

    for (const idx of [...propertyIndices].sort((a, b) => a - b)) {
      const prefix = `property${idx}`;
      const existingAddr = fieldValues.get(`${prefix}.address`) || fieldValues.get(`Property${idx}.Address`);
      if (!existingAddr || !existingAddr.rawValue) {
        const street = fieldValues.get(`${prefix}.street`)?.rawValue;
        const city = fieldValues.get(`${prefix}.city`)?.rawValue;
        const state = fieldValues.get(`${prefix}.state`)?.rawValue;
        const zip = fieldValues.get(`${prefix}.zip`)?.rawValue;
        const county = fieldValues.get(`${prefix}.county`)?.rawValue;
        const country = fieldValues.get(`${prefix}.country`)?.rawValue;

        const parts = [street, city, state, country, zip].filter(Boolean).map(String);
        if (parts.length > 0) {
          const fullAddress = parts.join(", ");
          fieldValues.set(`${prefix}.address`, { rawValue: fullAddress, dataType: "text" });
          fieldValues.set(`Property${idx}.Address`, { rawValue: fullAddress, dataType: "text" });
          debugLog(`[generate-document] Auto-computed ${prefix}.address = "${fullAddress}"`);
        }
      }
    }

    // ── RE851D Multi-Property: publish per-index aliases (_1 ... _5) ──
    // For each property record present in CSR (property1..propertyN), publish
    // pr_p_<short>_<N>, propertytax_annual_payment_<N>, pr_p_delinquHowMany_<N>,
    // and computed pr_p_totalSenior_<N> / pr_p_totalSeniorPlusLoan_<N> /
    // ln_p_loanToValueRatio_<N>. Indices not present in CSR get NO alias set,
    // so the resolver falls through to empty string and the corresponding
    // RE851D block stays blank. Capped at 5 per spec; extras ignored.
    // Template-gated: only run for RE851D templates. The publisher writes
    // ~160 _N alias keys per generation; running it for unrelated templates
    // (e.g. RE885 HUD-1) is pure overhead that contributed to the
    // "Generation timed out (CPU limit exceeded)" failure.
    if (/851d/i.test(template.name || "")) {
      const MAX_PROPERTIES = 5;
      // Reverse: short suffix -> pr_p_* full key (mirrors prKeyToSuffix above)
      const suffixToPrKey: Record<string, string> = {};
      for (const [prKey, sfx] of Object.entries(prKeyToSuffix)) {
        suffixToPrKey[sfx] = prKey;
      }

      // Pre-compute total of all lien current_balance values per property name
      // (lien.property carries the property identifier the lien belongs to).
      const lienTotalsByPropertyName: Record<string, number> = {};
      for (const [key, val] of fieldValues.entries()) {
        const m = key.match(/^lien(\d*)\.current_balance$/);
        if (!m || !val.rawValue) continue;
        const lienIdx = m[1] ? parseInt(m[1], 10) : 0;
        const propKey = lienIdx > 0 ? `lien${lienIdx}.property` : "lien.property";
        const propName = String(fieldValues.get(propKey)?.rawValue || "").trim().toLowerCase();
        if (!propName) continue;
        const num = parseFloat(String(val.rawValue).replace(/[^0-9.-]/g, ""));
        if (!isNaN(num)) {
          lienTotalsByPropertyName[propName] = (lienTotalsByPropertyName[propName] || 0) + num;
        }
      }

      const loanAmountForLtv = parseFloat(
        String(
          fieldValues.get("ln_p_loanAmount")?.rawValue ||
          fieldValues.get("loan_terms.loan_amount")?.rawValue ||
          ""
        ).replace(/[^0-9.-]/g, "")
      );

      const sortedPropIndices = [...propertyIndices].sort((a, b) => a - b).slice(0, MAX_PROPERTIES);

      // ── RE851D: Multiple Properties Yes/No checkboxes ──
      // YES if >1 real property, NO if ≤1. Counts only properties with at
      // least one non-empty identifier field (address/street/city/etc.) so
      // stale empty property{N}.* keys do not inflate the count.
      const PROP_PRESENCE_FIELDS = ["address", "street", "city", "state", "zip", "county", "legal_description"];
      const realPropertyIndices = sortedPropIndices.filter((idx) => {
        const prefix = `property${idx}`;
        return PROP_PRESENCE_FIELDS.some((f) => {
          const v = fieldValues.get(`${prefix}.${f}`)?.rawValue;
          return v !== undefined && v !== null && String(v).trim() !== "";
        });
      });
      const realPropertyCount = realPropertyIndices.length;
      {
        const isMultiple = realPropertyCount > 1;
        const isSingle   = !isMultiple; // ≤1 → NO checked (covers 0 and 1)
        const base = "pr_p_multipleProperties";
        fieldValues.set(`${base}_yes`,       { rawValue: isMultiple ? "true" : "false", dataType: "boolean" });
        fieldValues.set(`${base}_no`,        { rawValue: isSingle   ? "true" : "false", dataType: "boolean" });
        fieldValues.set(`${base}_yes_glyph`, { rawValue: isMultiple ? "☑" : "☐",       dataType: "text" });
        fieldValues.set(`${base}_no_glyph`,  { rawValue: isSingle   ? "☑" : "☐",       dataType: "text" });
        // Per-property indexed variants — every property section gets the same
        // global decision so all N sections render YES when count>1, NO when ≤1.
        for (const idx of sortedPropIndices) {
          fieldValues.set(`${base}_yes_${idx}`,       { rawValue: isMultiple ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`${base}_no_${idx}`,        { rawValue: isSingle   ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`${base}_yes_glyph_${idx}`, { rawValue: isMultiple ? "☑" : "☐",       dataType: "text" });
          fieldValues.set(`${base}_no_glyph_${idx}`,  { rawValue: isSingle   ? "☑" : "☐",       dataType: "text" });
        }
        fieldValues.set("total_property_count", { rawValue: String(realPropertyCount), dataType: "number" });
        debugLog(`[RE851D] multipleProperties: realCount=${realPropertyCount} rawIndices=[${sortedPropIndices.join(",")}] realIndices=[${realPropertyIndices.join(",")}] → YES=${isMultiple} NO=${isSingle} (per-index published for [${sortedPropIndices.join(",")}])`);
      }

      // ── RE851D: Build property-address → property-index map ──
      // Used to route propertytax{N} rows to their associated property by the
      // tax row's `.property` field (which carries the property's address).
      const normAddr = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      // Per-property candidate strings: full label/address + components so tax
      // rows can be routed by the Property Tax `.property` dropdown selection.
      type PropCandidate = { idx: number; label: string; desc: string; full: string; street: string; city: string; state: string; zip: string };
      const propCandidates: PropCandidate[] = [];
      const addressToPropIndex = new Map<string, number>();
      for (const pi of sortedPropIndices) {
        const desc = normAddr(String(fieldValues.get(`property${pi}.description`)?.rawValue || ""));
        const full = normAddr(String(fieldValues.get(`property${pi}.address`)?.rawValue || ""));
        const street = normAddr(String(fieldValues.get(`property${pi}.street`)?.rawValue || ""));
        const city = normAddr(String(fieldValues.get(`property${pi}.city`)?.rawValue || ""));
        const state = normAddr(String(fieldValues.get(`property${pi}.state`)?.rawValue || ""));
        const zip = normAddr(String(fieldValues.get(`property${pi}.zip`)?.rawValue || ""));
        const label = normAddr([desc, [street, city, state, zip].filter(Boolean).join(", ")].filter(Boolean).join(" - "));
        propCandidates.push({ idx: pi, label, desc, full, street, city, state, zip });
        if (full && !addressToPropIndex.has(full)) addressToPropIndex.set(full, pi);
        if (label && !addressToPropIndex.has(label)) addressToPropIndex.set(label, pi);
      }

      const resolvePropertyTaxPropertyIndex = (propertyLabelRaw: string): number | undefined => {
        const taxNorm = normAddr(propertyLabelRaw);
        if (!taxNorm) return undefined;
        const sortedCandidates = [...propCandidates].sort((a, b) => a.idx - b.idx);
        const exact = addressToPropIndex.get(taxNorm);
        if (exact) return exact;
        for (const c of sortedCandidates) {
          if (c.label && taxNorm === c.label) return c.idx;
          if (c.full && taxNorm === c.full) return c.idx;
        }
        for (const c of sortedCandidates) {
          if (c.desc && taxNorm.includes(c.desc) && ((c.street && taxNorm.includes(c.street)) || (c.zip && taxNorm.includes(c.zip)))) {
            return c.idx;
          }
        }
        return undefined;
      };

      const propertyTaxIndices = new Set<number>();
      for (const [key] of fieldValues.entries()) {
        const m = key.match(/^propertytax(\d+)\./);
        if (m) propertyTaxIndices.add(parseInt(m[1], 10));
      }
      for (let taxIdx = 1; taxIdx <= 10; taxIdx++) {
        if (fieldValues.has(`propertytax${taxIdx}.property`)) propertyTaxIndices.add(taxIdx);
      }
      const propertyTaxToProperty = new Map<number, number>();
      const propertyToTax = new Map<number, number>();
      for (const taxIdx of [...propertyTaxIndices].sort((a, b) => a - b)) {
        const propLabel = String(fieldValues.get(`propertytax${taxIdx}.property`)?.rawValue || "");
        const propIdx = resolvePropertyTaxPropertyIndex(propLabel);
        if (!propIdx) continue;
        propertyTaxToProperty.set(taxIdx, propIdx);
        if (!propertyToTax.has(propIdx)) propertyToTax.set(propIdx, taxIdx);
      }
      if (propertyTaxToProperty.size > 0) {
        debugLog(`[RE851D] propertytax→property mapping: ${[...propertyTaxToProperty.entries()].map(([taxIdx, propIdx]) => `${taxIdx}→${propIdx}`).join(", ")}`);
      }

      // ── RE851D: Pre-bridge propertytax{srcIdx} → propertytax{destIdx} by address match ──
      // Match strategy (first match wins, ties → lowest property index):
      //   a) exact normalized full-address match
      //   b) property full-address is substring of tax-row .property
      //   c) tax-row .property is substring of property full-address
      //   d) token overlap: street AND (city OR zip) appear in tax-row .property
      // Only copies when destination key is empty.
      {
        const TAX_FIELDS = ["annual_payment", "delinquent", "delinquent_amount", "source_of_information", "tax_confidence"];
        const bridgeLog: string[] = [];
        const unmatchedLog: string[] = [];
        const sortedCandidates = [...propCandidates].sort((a, b) => a.idx - b.idx);
        for (const srcIdx of propertyTaxIndices) {
          const propAddrRaw = String(fieldValues.get(`propertytax${srcIdx}.property`)?.rawValue || "");
          if (!propAddrRaw) continue;
          const taxNorm = normAddr(propAddrRaw);

          let destIdx: number | undefined = propertyTaxToProperty.get(srcIdx) || addressToPropIndex.get(taxNorm);
          // (b) property full ⊂ tax string
          if (!destIdx) {
            for (const c of sortedCandidates) {
              if (c.full && taxNorm.includes(c.full)) { destIdx = c.idx; break; }
            }
          }
          // (c) tax string ⊂ property full
          if (!destIdx) {
            for (const c of sortedCandidates) {
              if (c.full && c.full.includes(taxNorm)) { destIdx = c.idx; break; }
            }
          }
          // (d) street + (city OR zip) token overlap
          if (!destIdx) {
            for (const c of sortedCandidates) {
              if (!c.street) continue;
              if (taxNorm.includes(c.street) && (
                (c.city && taxNorm.includes(c.city)) ||
                (c.zip && taxNorm.includes(c.zip))
              )) { destIdx = c.idx; break; }
            }
          }

          if (!destIdx) {
            unmatchedLog.push(
              `pt${srcIdx}.property="${propAddrRaw}" candidates=[${sortedCandidates.map(c => `${c.idx}:"${c.full || c.street}"`).join("|")}]`
            );
            continue;
          }
          if (destIdx === srcIdx) continue;
          for (const tf of TAX_FIELDS) {
            const srcKey = `propertytax${srcIdx}.${tf}`;
            const destKey = `propertytax${destIdx}.${tf}`;
            const srcVal = fieldValues.get(srcKey);
            if (
              srcVal &&
              srcVal.rawValue !== undefined &&
              srcVal.rawValue !== null &&
              srcVal.rawValue !== "" &&
              !fieldValues.has(destKey)
            ) {
              fieldValues.set(destKey, { rawValue: srcVal.rawValue, dataType: srcVal.dataType });
            }
          }
          bridgeLog.push(`${srcIdx}->${destIdx}`);
        }
        if (bridgeLog.length > 0) {
          debugLog(`[generate-document] RE851D propertytax bridge (address-keyed): ${bridgeLog.join(", ")}`);
        }
        if (unmatchedLog.length > 0) {
          debugLog(`[generate-document] RE851D propertytax UNMATCHED: ${unmatchedLog.join(" ;; ")}`);
        }
      }

      // CPU optimization: iterate only properties with real data. Empty
      // slots are handled by the anti-fallback shield further down which
      // writes default ☐ glyphs / blank values for unpublished _N tags.
      // This avoids running ~30 publisher sub-blocks for phantom indices.
      for (const idx of realPropertyIndices) {
        const prefix = `property${idx}`;
        // ── RE851D: auto-numbered Property No. for Part 1 LTV table ──
        // Set unconditionally for any index that has a property record so the
        // {{property_number_N}} tag in the Part 1 row resolves to 1, 2, 3, ...
        // Indices without a property record never reach this loop, so empty
        // template rows stay blank (matches existing per-index publisher contract).
        fieldValues.set(`property_number_${idx}`, {
          rawValue: String(idx),
          dataType: "number",
        });
        // Per-property field aliases (pr_p_<short>_<N> -> property{N}.<short>)
        for (const [sfx, prKey] of Object.entries(suffixToPrKey)) {
          const v = fieldValues.get(`${prefix}.${sfx}`);
          if (v && v.rawValue !== undefined && v.rawValue !== null && v.rawValue !== "") {
            fieldValues.set(`${prKey}_${idx}`, { rawValue: v.rawValue, dataType: v.dataType });
          }
        }
        // Per-property "Performed By" — read directly from
        // property{N}.appraisal_performed_by and publish BOTH the canonical
        // `pr_p_performedBy_<N>` and the legacy misspelled
        // `pr_p_performeBy_<N>` aliases so the template's
        // `{{#if (eq pr_p_performeBy_N "Broker")}}` conditional resolves
        // strictly per-property. No cross-property fallback: indices without
        // a saved value publish nothing here and are blanked by the
        // anti-fallback shield below so the conditional sees an empty
        // string and renders no text in that PROPERTY block.
        {
          const perfRaw = fieldValues.get(`property${idx}.appraisal_performed_by`)
            || fieldValues.get(`pr_p_performedBy_${idx}`)
            || fieldValues.get(`pr_p_performeBy_${idx}`);
          if (perfRaw && perfRaw.rawValue !== undefined && perfRaw.rawValue !== null && perfRaw.rawValue !== "") {
            const dt = perfRaw.dataType || "text";
            fieldValues.set(`pr_p_performedBy_${idx}`, { rawValue: perfRaw.rawValue, dataType: dt });
            fieldValues.set(`pr_p_performeBy_${idx}`, { rawValue: perfRaw.rawValue, dataType: dt });
          }
        }
        // RE851D — pre-resolve per-property appraiser name/address so the
        // template can use plain {{pr_p_appraiserName_N}} / {{pr_p_appraiserAddress_N}}
        // merge tags instead of unsupported {{#if (eq pr_p_performeBy_N "Broker")}}…{{/if}}
        // conditionals (which currently leak raw into the rendered document).
        // Rule: performedBy === "Broker" → name="BPO Performed by Broker", address="N/A".
        //       Otherwise → both blank (mirrors `{{else}}{{/if}}` in the template
        //       so non-Broker properties render empty cells, never raw `{{#if}}`).
        {
          const performedBy = String(
            fieldValues.get(`property${idx}.appraisal_performed_by`)?.rawValue ?? ""
          ).trim();
          const isBroker = performedBy.toLowerCase() === "broker";

          const nameOut = isBroker ? "BPO Performed by Broker" : "";
          const addrOut = isBroker ? "N/A" : "";

          fieldValues.set(`pr_p_appraiserName_${idx}`,    { rawValue: nameOut, dataType: "text" });
          fieldValues.set(`pr_p_appraiserAddress_${idx}`, { rawValue: addrOut, dataType: "text" });
        }
        // Annual property tax (UI: propertytax.annual_payment) per property
        const taxV =
          fieldValues.get(`${prefix}.annual_property_taxes`) ||
          fieldValues.get(`${prefix}.annual_tax`) ||
          fieldValues.get(`${prefix}.propertytax_annual_payment`);
        if (taxV?.rawValue) {
          fieldValues.set(`propertytax_annual_payment_${idx}`, { rawValue: taxV.rawValue, dataType: taxV.dataType || "currency" });
        }
        // RE851D ANNUAL PROPERTY TAXES — per-property publisher (STRICT).
        // Resolution chain (per index):
        //   amount: propertytax{N}.annual_payment (direct or bridged in)
        //         → property{N}.annual_property_taxes / .annual_tax / .propertytax_annual_payment
        //   confidence: propertytax{N}.tax_confidence (direct or bridged in)
        //             → property{N}.tax_confidence
        // No global single-record fallback: unmatched indices stay blank with
        // both glyphs unchecked, satisfying "each property renders independently".
        // Mutually exclusive ACTUAL/ESTIMATED checkboxes; both ☐ when blank.
        {
          const annual =
            fieldValues.get(`propertytax${idx}.annual_payment`) ||
            fieldValues.get(`${prefix}.annual_property_taxes`) ||
            fieldValues.get(`${prefix}.annual_tax`) ||
            fieldValues.get(`${prefix}.propertytax_annual_payment`);
          if (annual && annual.rawValue !== undefined && annual.rawValue !== null && String(annual.rawValue) !== "") {
            fieldValues.set(`pr_pt_annualTaxes_${idx}`, {
              rawValue: annual.rawValue,
              dataType: "currency",
            });
          }
          const conf = String(
            fieldValues.get(`propertytax${idx}.tax_confidence`)?.rawValue ||
            fieldValues.get(`${prefix}.tax_confidence`)?.rawValue ||
            ""
          ).trim().toLowerCase();
          const isActual = conf === "actual";
          const isEstimated = conf === "estimated";
          fieldValues.set(`pr_pt_actual_${idx}`,          { rawValue: isActual    ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_pt_estimated_${idx}`,       { rawValue: isEstimated ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_pt_actual_${idx}_glyph`,    { rawValue: isActual    ? "☑" : "☐",        dataType: "text" });
          fieldValues.set(`pr_pt_estimated_${idx}_glyph`, { rawValue: isEstimated ? "☑" : "☐",        dataType: "text" });
          // Always-on diagnostic so we can verify per-property tax state in logs
          // even when DOC_GEN_DEBUG is off.
          debugLog(`[RE851D] pr_pt idx=${idx} annual=${annual?.rawValue ?? ""} confidence=${conf || "(none)"} actual=${isActual} estimated=${isEstimated}`);
        }
        // RE851D ARE TAXES DELINQUENT? — per-property publisher.
        // Source of truth: the propertytax{T} row linked by its `.property`
        // dropdown to property{N}. Fallback: property{N}.delinquent (legacy).
        // Do not fall back to positional propertytax{N}: tax row order can differ
        // from property order. Always emits ☑/☐ glyphs (never blank).
        {
          const taxIdx = propertyToTax.get(idx);
          const delinqRaw =
            (taxIdx !== undefined ? fieldValues.get(`propertytax${taxIdx}.delinquent`)?.rawValue : undefined) ??
            fieldValues.get(`${prefix}.delinquent`)?.rawValue;
          const s = String(delinqRaw ?? "").trim().toLowerCase();
          const isDelinq = s === "true" || s === "1" || s === "yes" || s === "y" || s === "on" || s === "checked" || s === "☑" || s === "☒";
          fieldValues.set(`pr_pt_delinquent_${idx}`,           { rawValue: isDelinq ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_pt_delinquent_yes_glyph_${idx}`, { rawValue: isDelinq ? "☑" : "☐",        dataType: "text" });
          fieldValues.set(`pr_pt_delinquent_no_glyph_${idx}`,  { rawValue: isDelinq ? "☐" : "☑",        dataType: "text" });
          let amountStr = "";
          if (isDelinq) {
            const amtRaw =
              (taxIdx !== undefined ? fieldValues.get(`propertytax${taxIdx}.delinquent_amount`)?.rawValue : undefined) ??
              fieldValues.get(`${prefix}.delinquent_amount`)?.rawValue;
            if (amtRaw !== undefined && amtRaw !== null && String(amtRaw) !== "") {
              amountStr = String(amtRaw);
            }
          }
          fieldValues.set(`pr_pt_delinquentAmount_${idx}`, { rawValue: amountStr, dataType: "currency" });
          debugLog(`[RE851D] pr_pt_delinquent idx=${idx} taxIdx=${taxIdx ?? "legacy"} raw=${delinqRaw ?? ""} → isDelinq=${isDelinq} amount=${amountStr}`);
        }
        // Delinquent payment count
        const delinqV =
          fieldValues.get(`${prefix}.delinquent_how_many`) ||
          fieldValues.get(`${prefix}.delinqHowMany`) ||
          fieldValues.get(`${prefix}.pr_p_delinquHowMany`);
        if (delinqV?.rawValue) {
          fieldValues.set(`pr_p_delinquHowMany_${idx}`, { rawValue: delinqV.rawValue, dataType: delinqV.dataType || "number" });
        }
        // Per-property appraise value & owner (handle alternate canonical keys)
        // UI saves under `propertyN.appraised_value` (PropertyDetailsForm/fieldKeyMap.appraisedValue)
        const appraiseV =
          fieldValues.get(`${prefix}.appraised_value`) ||
          fieldValues.get(`${prefix}.appraise_value`) ||
          fieldValues.get(`${prefix}.appraiseValue`);
        if (appraiseV?.rawValue && !fieldValues.has(`pr_p_appraiseValue_${idx}`)) {
          fieldValues.set(`pr_p_appraiseValue_${idx}`, { rawValue: appraiseV.rawValue, dataType: appraiseV.dataType || "currency" });
        }
        // Per-property Pledged Equity (Property → Valuation → Pledged Equity).
        // Drives RE851D Part 1 "Amount of Equity Securing the Loan" column.
        const pledgedV =
          fieldValues.get(`${prefix}.pledged_equity`) ||
          fieldValues.get(`${prefix}.pledgedEquity`);
        if (pledgedV?.rawValue && !fieldValues.has(`pr_p_pledgedEquity_${idx}`)) {
          fieldValues.set(`pr_p_pledgedEquity_${idx}`, { rawValue: pledgedV.rawValue, dataType: pledgedV.dataType || "currency" });
        }
        // Property Owner: UI saves under property{N}.property_owner (FIELD_KEYS.propertyOwner).
        // Also accept legacy `.owner`/`.vesting`. Publish pr_p_owner_N (legacy) and
        // pr_p_ownerName_N (RE851D PROPERTY OWNER section) per-index, no cross-bleed.
        const ownerV =
          fieldValues.get(`${prefix}.property_owner`) ||
          fieldValues.get(`${prefix}.owner`) ||
          fieldValues.get(`${prefix}.vesting`);
        if (ownerV?.rawValue) {
          if (!fieldValues.has(`pr_p_owner_${idx}`)) {
            fieldValues.set(`pr_p_owner_${idx}`, { rawValue: ownerV.rawValue, dataType: ownerV.dataType || "text" });
          }
          fieldValues.set(`pr_p_ownerName_${idx}`, { rawValue: ownerV.rawValue, dataType: "text" });
        }

        // Computed: per-property total senior encumbrances.
        // Match lien.property by either property index ("property1") or by
        // property address (so users tagging by address still get totals).
        const propAddrLower = String(fieldValues.get(`${prefix}.address`)?.rawValue || "").trim().toLowerCase();
        const totalSenior =
          (lienTotalsByPropertyName[prefix.toLowerCase()] || 0) +
          (propAddrLower ? (lienTotalsByPropertyName[propAddrLower] || 0) : 0);
        if (totalSenior > 0) {
          const tsStr = totalSenior.toFixed(2);
          fieldValues.set(`pr_p_totalSenior_${idx}`, { rawValue: tsStr, dataType: "currency" });
          if (!isNaN(loanAmountForLtv)) {
            const tsPlusLoan = (totalSenior + loanAmountForLtv).toFixed(2);
            fieldValues.set(`pr_p_totalSeniorPlusLoan_${idx}`, { rawValue: tsPlusLoan, dataType: "currency" });
          }
        }

        // Per-property Current Balance alias: collect lienK.current_balance whose
        // lienK.property matches this property by index name or address.
        {
          const matched: { lienIdx: number; value: string }[] = [];
          for (const [k, v] of fieldValues.entries()) {
            const m = k.match(/^lien(\d*)\.current_balance$/);
            if (!m || !v.rawValue) continue;
            const lienIdx = m[1] ? parseInt(m[1], 10) : 0;
            const propKey = lienIdx > 0 ? `lien${lienIdx}.property` : "lien.property";
            const propName = String(fieldValues.get(propKey)?.rawValue || "").trim().toLowerCase();
            if (!propName) continue;
            if (propName === prefix.toLowerCase() || (propAddrLower && propName === propAddrLower)) {
              matched.push({ lienIdx, value: String(v.rawValue) });
            }
          }
          if (matched.length > 0) {
            matched.sort((a, b) => a.lienIdx - b.lienIdx);
            const joined = matched.map(e => e.value).join("\n");
            fieldValues.set(`pr_p_currentBalanc_${idx}`, { rawValue: joined, dataType: "currency" });
            debugLog(`[generate-document] Published pr_p_currentBalanc_${idx} (${matched.length} liens)`);
          }
        }

        // Computed: per-property LTV ratio = loan_amount / property{N}.appraised_value
        const appraiseNum = parseFloat(
          String(
            fieldValues.get(`pr_p_appraiseValue_${idx}`)?.rawValue ||
            fieldValues.get(`${prefix}.appraised_value`)?.rawValue ||
            fieldValues.get(`${prefix}.appraise_value`)?.rawValue ||
            ""
          ).replace(/[^0-9.-]/g, "")
        );
        if (!isNaN(loanAmountForLtv) && !isNaN(appraiseNum) && appraiseNum > 0) {
          const ltv = (loanAmountForLtv / appraiseNum) * 100;
          fieldValues.set(`ln_p_loanToValueRatio_${idx}`, { rawValue: ltv.toFixed(2), dataType: "percentage" });
        }

        // ── RE851D Part 2: per-property Property Type checkbox booleans ──
        // Each property block in Part 2 has its own checkbox group. Publish a
        // boolean alias per type for THIS property index only, sourced strictly
        // from property{idx}.propertyType. Missing type => all-false (no fallback
        // to another property — matches "If any field is missing: do NOT fallback"
        // acceptance criterion).
        {
          const PROPERTY_TYPES = [
            "singleFamily", "condominium", "multiUnit", "commercial",
            "land", "mobileHome", "industrial", "other",
          ];
          // Aliases: dropdown raw value → canonical type slug.
          const TYPE_ALIASES: Record<string, string> = {
            "single family": "singleFamily", "single-family": "singleFamily",
            "singlefamily": "singleFamily", "single_family": "singleFamily",
            "sfr": "singleFamily", "sfr 1-4": "singleFamily", "1-4 family": "singleFamily",
            "condo": "condominium", "condominium": "condominium",
            "condo / townhouse": "condominium", "condo/townhouse": "condominium",
            "townhouse": "condominium",
            "multi-unit": "multiUnit", "multi unit": "multiUnit",
            "multiunit": "multiUnit", "multi_unit": "multiUnit",
            "multifamily": "multiUnit", "multi family": "multiUnit",
            "multi-family": "multiUnit",
            "2-4 unit": "multiUnit", "5+ unit": "multiUnit",
            "commercial": "commercial", "office": "commercial", "retail": "commercial",
            "mixed-use": "commercial", "mixed use": "commercial",
            "restaurant / bar": "commercial", "restaurant/bar": "commercial",
            "group housing": "commercial",
            "land": "land", "vacant land": "land", "lot": "land", "farm": "land",
            "mobile home": "mobileHome", "mobile-home": "mobileHome",
            "mobilehome": "mobileHome", "manufactured": "mobileHome",
            "industrial": "industrial", "warehouse": "industrial",
            "other": "other",
          };
          const ptRaw = String(
            fieldValues.get(`pr_p_propertyTyp_${idx}`)?.rawValue ||
            fieldValues.get(`pr_p_propertyType_${idx}`)?.rawValue ||
            fieldValues.get(`${prefix}.propertyType`)?.rawValue ||
            fieldValues.get(`${prefix}.appraisal_property_type`)?.rawValue ||
            ""
          ).trim();
          const ptKey = TYPE_ALIASES[ptRaw.toLowerCase()] ||
            (PROPERTY_TYPES.includes(ptRaw) ? ptRaw : "");
          for (const t of PROPERTY_TYPES) {
            const isMatch = ptKey === t;
            // Only publish booleans when a real selection exists. If ptKey is empty
            // (no source value), do NOT publish — leaves SDT defaults intact and
            // keeps absent property blocks fully blank.
            if (ptKey) {
              fieldValues.set(`pr_p_propertyTyp_${idx}_${t}`, {
                rawValue: isMatch ? "true" : "false",
                dataType: "boolean",
              });
              // Glyph alias for templates using static check-mark fallbacks.
              fieldValues.set(`pr_p_propertyTyp_${idx}_${t}_glyph`, {
                rawValue: isMatch ? "☑" : "☐",
                dataType: "text",
              });
            }
          }
        }

        // ── RE851D: per-property Property Type × Occupancy → 7-checkbox mapping ──
        // Cross-reference rule (CSR Property Type + Occupancy → RE851D checkbox):
        //   SFR 1-4 + Owner Occupied      → property_type_sfr_owner
        //   SFR 1-4 + Vacant/NA (or unset)→ property_type_sfr_non_owner
        //   Land SFR Residential          → property_type_sfr_zoned
        //   Multi-family / Commercial /
        //   Commercial Income / Mixed-use /
        //   Condo / Townhouse             → property_type_commercial
        //   Land Residential /
        //   Land Commercial               → property_type_land_zoned
        //   Land Income Producing         → property_type_land_income
        //   Mobile Home / Farm /
        //   Restaurant / Bar / Group Housing /
        //   <anything else>               → property_type_other (+ text = raw value)
        // Publishes booleans, glyphs, and text for index N. Mirrors as bare
        // (non-_N) aliases for index 1 so single-property templates work.
        {
          const RE851D_TARGETS = [
            "property_type_sfr_owner",
            "property_type_sfr_non_owner",
            "property_type_sfr_zoned",
            "property_type_commercial",
            "property_type_land_zoned",
            "property_type_land_income",
            "property_type_other",
          ];
          // Property-type-only mapping (occupancy not required to disambiguate).
          const TYPE_ONLY_MAP: Record<string, string> = {
            "land sfr residential": "property_type_sfr_zoned",
            "multi-family": "property_type_commercial",
            "multi family": "property_type_commercial",
            "multifamily": "property_type_commercial",
            "commercial": "property_type_commercial",
            "commercial income": "property_type_commercial",
            "mixed-use": "property_type_commercial",
            "mixed use": "property_type_commercial",
            "condo / townhouse": "property_type_commercial",
            "condo/townhouse": "property_type_commercial",
            "condo": "property_type_commercial",
            "townhouse": "property_type_commercial",
            "condominium": "property_type_commercial",
            "land residential": "property_type_land_zoned",
            "land commercial": "property_type_land_zoned",
            "land income producing": "property_type_land_income",
          };
          // SFR aliases — these need cross-reference with occupancy.
          const SFR_ALIASES = new Set([
            "sfr 1-4", "sfr1-4", "sfr", "single family", "single-family",
            "singlefamily", "1-4 family",
          ]);
          const ptRawSpec = String(
            fieldValues.get(`pr_p_propertyTyp_${idx}`)?.rawValue ||
            fieldValues.get(`pr_p_propertyType_${idx}`)?.rawValue ||
            fieldValues.get(`${prefix}.propertyType`)?.rawValue ||
            fieldValues.get(`${prefix}.appraisal_property_type`)?.rawValue ||
            ""
          ).trim();
          if (ptRawSpec) {
            const ptLower = ptRawSpec.toLowerCase();
            // Resolve occupancy (used only for SFR disambiguation).
            const occRawSpec = String(
              fieldValues.get(`pr_p_occupancySt_${idx}`)?.rawValue ||
              fieldValues.get(`pr_p_occupanc_${idx}`)?.rawValue ||
              fieldValues.get(`${prefix}.occupancyStatus`)?.rawValue ||
              fieldValues.get(`${prefix}.appraisal_occupancy`)?.rawValue ||
              ""
            ).trim().toLowerCase();
            const isOwnerOccupied = [
              "yes", "y", "true", "owner occupied", "owner-occupied",
              "owneroccupied", "owner", "primary borrower",
            ].includes(occRawSpec);

            let matched = "";
            if (SFR_ALIASES.has(ptLower)) {
              matched = isOwnerOccupied
                ? "property_type_sfr_owner"
                : "property_type_sfr_non_owner";
            } else {
              matched = TYPE_ONLY_MAP[ptLower] || "";
            }
            const useOther = !matched;
            const otherText = useOther ? ptRawSpec : "";
            for (const t of RE851D_TARGETS) {
              const isMatch = useOther ? (t === "property_type_other") : (t === matched);
              fieldValues.set(`${t}_${idx}`, {
                rawValue: isMatch ? "true" : "false",
                dataType: "boolean",
              });
              fieldValues.set(`${t}_${idx}_glyph`, {
                rawValue: isMatch ? "☑" : "☐",
                dataType: "text",
              });
              if (idx === 1) {
                fieldValues.set(t, {
                  rawValue: isMatch ? "true" : "false",
                  dataType: "boolean",
                });
                fieldValues.set(`${t}_glyph`, {
                  rawValue: isMatch ? "☑" : "☐",
                  dataType: "text",
                });
              }
            }
            fieldValues.set(`property_type_other_text_${idx}`, {
              rawValue: otherText,
              dataType: "text",
            });
            if (idx === 1) {
              fieldValues.set("property_type_other_text", {
                rawValue: otherText,
                dataType: "text",
              });
            }
          }
        }

        // ── RE851D: per-property Owner-Occupied Yes/No checkbox booleans ──
        // New 4-value vocabulary: "Owner Occupied" | "Tenant / Other" | "Vacant" | "NA".
        // Only "Owner Occupied" => Yes; everything else (including empty) => No.
        // Aliases are always published so empty values render as ☐ Yes / ☑ No.
        {
          const occRaw = String(
            fieldValues.get(`pr_p_occupancySt_${idx}`)?.rawValue ||
            fieldValues.get(`pr_p_occupanc_${idx}`)?.rawValue ||
            fieldValues.get(`${prefix}.occupancyStatus`)?.rawValue ||
            fieldValues.get(`${prefix}.appraisal_occupancy`)?.rawValue ||
            ""
          ).trim().toLowerCase();
          const occRawNorm = occRaw === "n/a" ? "na" : occRaw;
          const isYes = occRawNorm === "owner occupied";
          const isNo = !isYes;
          fieldValues.set(`pr_p_occupancySt_${idx}_yes`, { rawValue: isYes ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_p_occupancySt_${idx}_no`, { rawValue: isNo ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_p_occupancySt_${idx}_yes_glyph`, { rawValue: isYes ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_p_occupancySt_${idx}_no_glyph`, { rawValue: isNo ? "☑" : "☐", dataType: "text" });
          // Per-property normalized occupancy string for RE851D template.
          // Preserve the actual CSR value so downstream safety passes and
          // template conditionals can distinguish all 4 cases:
          //   Owner Occupied | Tenant / Other | Vacant | NA | "" (unknown)
          // Only "Owner Occupied" maps to YES; every other value maps to NO.
          let normalizedOcc = "";
          if (occRawNorm === "owner occupied") normalizedOcc = "Owner Occupied";
          else if (occRawNorm === "tenant / other" || occRawNorm === "tenant/other" || occRawNorm === "tenant") normalizedOcc = "Tenant / Other";
          else if (occRawNorm === "vacant") normalizedOcc = "Vacant";
          else if (occRawNorm === "na") normalizedOcc = "NA";
          else if (occRaw) normalizedOcc = occRaw; // preserve raw label as-is for unknown values
          fieldValues.set(`pr_p_occupanc_${idx}`, {
            rawValue: normalizedOcc,
            dataType: "text",
          });
          if (idx === 1) {
            fieldValues.set("pr_p_occupanc", {
              rawValue: normalizedOcc,
              dataType: "text",
            });
          }
        }

        // ── RE851D: Expected/Remaining/Total Senior Encumbrance ──
        // Intentionally NOT published here. The authoritative late pass (search
        // for "RE851D Part 1 / Part 2 senior-encumbrance rollup") runs after
        // ALL lien bridging and is the single source of truth for:
        //   ln_p_remainingEncumbrance_N, ln_p_expectedEncumbrance_N,
        //   ln_p_totalEncumbrance_N, pr_p_remainingSenior_N,
        //   pr_p_expectedSenior_N, pr_p_totalEncumbrance_N,
        //   pr_p_totalSenior_N, pr_p_totalSeniorPlusLoan_N, ln_p_totalWithLoan_N.
        // Per-spec mapping (Condition dropdown):
        //   Anticipated      -> Expected  = SUM(original_balance)
        //   Will Remain      -> Remaining = SUM(current_balance)
        //   Remain - Paydown -> Remaining = SUM(current_balance)
        //   Existing - Payoff -> excluded entirely
        // Blanks -> 0.00. Strict per-property match. No cross-bleed.

        // ── RE851D: per-property tax publisher ──
        // PropertyTax UI saves under propertytax{idx}.<field>. We publish four
        // per-index aliases (both underscore and dotted forms so either
        // {{propertytax.X_N}} or {{propertytax_X_N}} merge tags resolve after
        // the _N rewrite). Strictly per-index — no cross-index fallback for
        // idx >= 2. For idx === 1, fall back to the singular canonical
        // propertytax.<field> so legacy single-tax-record deals continue to
        // populate Property #1.
        {
          const taxFields: Array<[string, string]> = [
            ["annual_payment", "currency"],
            ["delinquent", "boolean"],
            ["delinquent_amount", "currency"],
            ["source_of_information", "text"],
          ];
          const taxPrefix = `propertytax${idx}`;
          for (const [tf, dt] of taxFields) {
            // Per-index source first (strict, no cross-index fallback)
            let v = fieldValues.get(`${taxPrefix}.${tf}`);
            // For idx === 1 only, fall back to canonical singular
            if ((!v || v.rawValue === undefined || v.rawValue === null || v.rawValue === "") && idx === 1) {
              v = fieldValues.get(`propertytax.${tf}`);
            }
            // Backward-compat: annual_payment also accepts the property{idx} variant
            if ((!v || v.rawValue === undefined || v.rawValue === null || v.rawValue === "") && tf === "annual_payment") {
              v =
                fieldValues.get(`${prefix}.annual_property_taxes`) ||
                fieldValues.get(`${prefix}.annual_tax`) ||
                fieldValues.get(`${prefix}.propertytax_annual_payment`);
            }
            if (v && v.rawValue !== undefined && v.rawValue !== null && v.rawValue !== "") {
              const dataType = v.dataType || dt;
              // Underscore form
              const underscoreKey = `propertytax_${tf}_${idx}`;
              if (!fieldValues.has(underscoreKey)) {
                fieldValues.set(underscoreKey, { rawValue: v.rawValue, dataType });
              }
              // Dotted form (matches {{propertytax.X_N}} after _N rewrite)
              const dottedKey = `propertytax.${tf}_${idx}`;
              if (!fieldValues.has(dottedKey)) {
                fieldValues.set(dottedKey, { rawValue: v.rawValue, dataType });
              }
            }
          }
        }

        // ── RE851D: per-property TAX DELINQUENT Yes/No checkbox booleans ──
        // After the propertytax bridge + per-index publisher, emit boolean +
        // glyph aliases so any {{propertytax_delinquent_N_yes}}-style tag in
        // the template resolves correctly. true → YES ☑ / false → NO ☑.
        {
          const delRaw = String(
            fieldValues.get(`propertytax_delinquent_${idx}`)?.rawValue ||
            fieldValues.get(`propertytax.delinquent_${idx}`)?.rawValue ||
            (idx === 1 ? fieldValues.get(`propertytax.delinquent`)?.rawValue : "") ||
            ""
          ).trim().toLowerCase();
          const isYes = ["true", "yes", "y", "1"].includes(delRaw);
          const isNo = ["false", "no", "n", "0"].includes(delRaw);
          if (isYes || isNo) {
            for (const base of [`propertytax_delinquent_${idx}`, `propertytax.delinquent_${idx}`]) {
              if (!fieldValues.has(`${base}_yes`)) {
                fieldValues.set(`${base}_yes`, { rawValue: isYes ? "true" : "false", dataType: "boolean" });
              }
              if (!fieldValues.has(`${base}_no`)) {
                fieldValues.set(`${base}_no`, { rawValue: isNo ? "true" : "false", dataType: "boolean" });
              }
              if (!fieldValues.has(`${base}_yes_glyph`)) {
                fieldValues.set(`${base}_yes_glyph`, { rawValue: isYes ? "☑" : "☐", dataType: "text" });
              }
              if (!fieldValues.has(`${base}_no_glyph`)) {
                fieldValues.set(`${base}_no_glyph`, { rawValue: isNo ? "☑" : "☐", dataType: "text" });
              }
            }
          }
        }
      }
      // RE851D ARE TAXES DELINQUENT? — empty-slot defaults (anti-fallback shield).
      // Slots without a property render as ☐ YES / ☑ NO with empty amount.
      for (let i = 1; i <= 5; i++) {
        if (realPropertyIndices.includes(i)) continue;
        fieldValues.set(`pr_pt_delinquent_yes_glyph_${i}`, { rawValue: "☐", dataType: "text" });
        fieldValues.set(`pr_pt_delinquent_no_glyph_${i}`,  { rawValue: "☑", dataType: "text" });
        fieldValues.set(`pr_pt_delinquentAmount_${i}`,     { rawValue: "",  dataType: "currency" });
        fieldValues.set(`pr_pt_delinquent_${i}`,           { rawValue: "false", dataType: "boolean" });
      }
      // ── RE851D: per-property INCOME publisher ──
      // Source: property{idx}.net_monthly_income (already bridged above).
      // Derived per-index aliases (no cross-property fallback):
      //   pr_p_netMonthlyIncome_{N} → numeric monthly value
      //   pr_p_incomeGenerating_{N} → "Yes" if net>0 else "No" (plain text)
      //   pr_p_grossAnnualIncome_{N} → net * 12 (numeric, unformatted)
      for (const idx of realPropertyIndices) {
        const raw = fieldValues.get(`property${idx}.net_monthly_income`)?.rawValue;
        const cleaned = String(raw ?? "").replace(/[^0-9.-]/g, "");
        const net = cleaned === "" || isNaN(parseFloat(cleaned)) ? 0 : parseFloat(cleaned);
        const annual = net * 12;
        const incomeYesNo = net > 0 ? "Yes" : "No";
        fieldValues.set(`pr_p_netMonthlyIncome_${idx}`, { rawValue: String(net), dataType: "number" });
        fieldValues.set(`pr_p_incomeGenerating_${idx}`, { rawValue: incomeYesNo, dataType: "text" });
        fieldValues.set(`pr_p_grossAnnualIncome_${idx}`, { rawValue: String(annual), dataType: "number" });
        debugLog(`[RE851D] income prop#${idx}: netMonthly=${raw ?? ""} → incomeGenerating=${incomeYesNo} grossAnnual=${annual}`);
      }

      // Per-index pr_p_address_${idx} auto-compute from per-property components.
      // The bare pr_p_address is auto-computed below from pr_p_street/city/state/zip,
      // but RE851D PROPERTY blocks reference {{pr_p_address_N}} per-index. Without
      // this loop, the publisher above only sets pr_p_address_${idx} when a
      // dedicated `${prefix}.address` value exists in the dictionary, which it
      // does not. Compose from per-property street/city/state/zip/country instead.
      for (const idx of realPropertyIndices) {
        const prefix = `property${idx}`;
        if (fieldValues.has(`pr_p_address_${idx}`)) continue;
        const street  = fieldValues.get(`${prefix}.street`)?.rawValue;
        const city    = fieldValues.get(`${prefix}.city`)?.rawValue;
        const state   = fieldValues.get(`${prefix}.state`)?.rawValue;
        const zip     = fieldValues.get(`${prefix}.zip`)?.rawValue;
        const country = fieldValues.get(`${prefix}.country`)?.rawValue;
        const parts = [street, city, state, country, zip].filter(Boolean).map(String);
        if (parts.length > 0) {
          const fullAddress = parts.join(", ");
          fieldValues.set(`pr_p_address_${idx}`, { rawValue: fullAddress, dataType: "text" });
          debugLog(`[generate-document] RE851D auto-computed pr_p_address_${idx} = "${fullAddress}"`);
        }
      }
      // Diagnostic snapshot: which per-index aliases each PROPERTY block will
      // resolve. Helps pinpoint blank-block regressions before they hit the
      // rewrite/shield passes.
      try {
        const probeKeys = ["pr_p_address", "pr_p_ownerName", "pr_p_appraiseValue",
          "ln_p_remainingEncumbrance", "ln_p_expectedEncumbrance",
          "ln_p_totalEncumbrance", "ln_p_totalWithLoan", "ln_p_loanToValueRatio"];
        for (const idx of sortedPropIndices) {
          const snap = probeKeys.map((k) => `${k}_${idx}=${JSON.stringify(fieldValues.get(`${k}_${idx}`)?.rawValue ?? null)}`).join(", ");
          debugLog(`[RE851D] publish-snapshot prop#${idx}: ${snap}`);
        }
      } catch (_e) { /* diagnostic only */ }
      debugLog(`[generate-document] RE851D multi-property: published indexed aliases for properties [${sortedPropIndices.join(", ")}]`);

      // ── RE851D anti-fallback shield ──
      // For every _N-family tag that the rewrite block (line 2066) will produce
      // for indices 1..5, ensure a per-index entry exists in fieldValues. If
      // the publishers above did not set one (because no per-index source data
      // existed), write an empty string so the resolver's canonical_key
      // fallback cannot collapse pr_p_address_2 → pr_p_address (which would
      // print Property #1's data inside Property #2's block — the reported bug).
      {
        const SHIELD_BASES = [
          "pr_p_address", "pr_p_street", "pr_p_city", "pr_p_state",
          "pr_p_zip", "pr_p_county", "pr_p_country", "pr_p_apn",
          "pr_p_owner", "pr_p_marketValue", "pr_p_appraiseValue",
          "pr_p_appraiseDate", "pr_p_appraiserStreet", "pr_p_appraiserCity",
          "pr_p_appraiserState", "pr_p_appraiserZip", "pr_p_appraiserPhone",
          "pr_p_appraiserEmail", "pr_p_legalDescri", "pr_p_yearBuilt",
          "pr_p_squareFeet", "pr_p_lotSize", "pr_p_numberOfUni",
          "pr_p_propertyTyp", "pr_p_propertyType", "pr_p_occupancySt",
          "pr_p_occupanc", "pr_p_remainingSenior", "pr_p_expectedSenior",
          "ln_p_expectedEncumbrance", "ln_p_remainingEncumbrance",
          "pr_p_totalSenior", "pr_p_totalEncumbrance", "pr_p_totalSeniorPlusLoan",
          "ln_p_totalEncumbrance", "property_number",
          "pr_p_construcType", "pr_p_purchasePrice", "pr_p_downPayme",
          "pr_p_protectiveEquity", "pr_p_descript", "pr_p_ltv", "pr_p_cltv",
          "pr_p_zoning", "pr_p_floodZone", "pr_p_pledgedEquity",
          "pr_p_delinquHowMany",
          "pr_p_performedBy", "pr_p_performeBy",
          "pr_p_appraiserName", "pr_p_appraiserAddress",
          "pr_p_netMonthlyIncome", "pr_p_incomeGenerating", "pr_p_grossAnnualIncome",
          "ln_p_loanToValueRatio",
          "propertytax_annual_payment", "propertytax.annual_payment",
          "propertytax_delinquent", "propertytax.delinquent",
          "propertytax_delinquent_amount", "propertytax.delinquent_amount",
          "propertytax_source_of_information", "propertytax.source_of_information",
          "property_type_sfr_owner", "property_type_sfr_non_owner",
          "property_type_sfr_zoned", "property_type_commercial",
          "property_type_land_zoned", "property_type_land_income",
          "property_type_other", "property_type_other_text",
          // RE851D lien-derived per-property questionnaire (Q1, Q2, Q3, Q4, Q5, Q6).
          // Without these in the shield, an unpublished _N entry falls back through
          // the canonical-key resolver onto the bare boolean key (e.g.
          // pr_li_encumbranceOfRecord), which formats to "" for _yes_glyph slots
          // and erases the YES/NO checkbox glyph in the generated document.
          "pr_li_encumbranceOfRecord",
          "pr_li_encumbranceOfRecord_yes", "pr_li_encumbranceOfRecord_no",
          "pr_li_encumbranceOfRecord_yes_glyph", "pr_li_encumbranceOfRecord_no_glyph",
          "pr_li_delinqu60day",
          "pr_li_delinqu60day_yes", "pr_li_delinqu60day_no",
          "pr_li_delinqu60day_yes_glyph", "pr_li_delinqu60day_no_glyph",
          "pr_li_currentDelinqu",
          "pr_li_currentDelinqu_yes", "pr_li_currentDelinqu_no",
          "pr_li_currentDelinqu_yes_glyph", "pr_li_currentDelinqu_no_glyph",
          "pr_li_delinquencyPaidByLoan",
          "pr_li_delinquencyPaidByLoan_yes", "pr_li_delinquencyPaidByLoan_no",
          "pr_li_delinquencyPaidByLoan_yes_glyph", "pr_li_delinquencyPaidByLoan_no_glyph",
          "pr_li_delinquHowMany",
          "pr_li_sourceOfPayment",
          // Source of Information checkboxes (per-property): default to ☐ (blank) when no data
          "pr_li_sourceInfoBroker", "pr_li_sourceInfoBroker_glyph",
          "pr_li_sourceInfoBorrower", "pr_li_sourceInfoBorrower_glyph",
          "pr_li_sourceInfoOther", "pr_li_sourceInfoOther_glyph",
          "pr_li_sourceInfoOtherText",
          "pr_li_sourceOfInformation",
        ];
        // Default-fill: per RE851D spec mutual exclusivity, when no lien data exists
        // for a property the four YES/NO questions render NO checked. Apply this to
        // the glyph aliases ONLY (booleans stay false). Numeric/text aliases stay "".
        // Map base name -> default glyph value for the *_yes_glyph / *_no_glyph slot.
        const GLYPH_DEFAULTS_NO_CHECKED: Record<string, string> = {
          "pr_li_encumbranceOfRecord_yes_glyph": "☐",
          "pr_li_encumbranceOfRecord_no_glyph":  "☑",
          "pr_li_delinqu60day_yes_glyph":        "☐",
          "pr_li_delinqu60day_no_glyph":         "☑",
          "pr_li_currentDelinqu_yes_glyph":      "☐",
          "pr_li_currentDelinqu_no_glyph":       "☑",
          "pr_li_delinquencyPaidByLoan_yes_glyph":"☐",
          "pr_li_delinquencyPaidByLoan_no_glyph": "☑",
          "pr_li_sourceInfoBroker_glyph":   "☐",
          "pr_li_sourceInfoBorrower_glyph": "☐",
          "pr_li_sourceInfoOther_glyph":    "☐",
        };
        // Suffixes that take the property index in the MIDDLE
        // (e.g. pr_li_currentDelinqu_<N>_yes_glyph), not at the end.
        const MIDDLE_INDEX_SUFFIXES = ["_yes_glyph", "_no_glyph", "_glyph", "_yes", "_no"];
        const blanked: number[] = [];
        for (let idx = 1; idx <= MAX_PROPERTIES; idx++) {
          let blankedThisIdx = false;
          for (const base of SHIELD_BASES) {
            // Determine the canonical per-index key for this base.
            let key: string;
            const middleSuffix = MIDDLE_INDEX_SUFFIXES.find((s) => base.endsWith(s));
            if (middleSuffix) {
              const stem = base.slice(0, -middleSuffix.length);
              key = `${stem}_${idx}${middleSuffix}`;
            } else {
              key = `${base}_${idx}`;
            }
            if (!fieldValues.has(key)) {
              const glyphDefault = GLYPH_DEFAULTS_NO_CHECKED[base];
              if (glyphDefault !== undefined) {
                fieldValues.set(key, { rawValue: glyphDefault, dataType: "text" });
              } else {
                fieldValues.set(key, { rawValue: "", dataType: "text" });
              }
              blankedThisIdx = true;
            }
          }
          if (blankedThisIdx) blanked.push(idx);
        }
        if (blanked.length > 0) {
          debugLog(`[generate-document] RE851D anti-fallback shield: blanked unpublished _N tags for indices [${blanked.join(", ")}]`);
        }
        // ── RE851D bare performBy hard-blank ──
        // If a `pr_p_performeBy_N` literal survives ALL rewrites (worst case:
        // tag splits the safety pass cannot stitch), the resolver will fall
        // back via canonical_key to the bare unsuffixed `pr_p_performeBy` /
        // `pr_p_performedBy` field — which holds property #1's value and would
        // make every PROPERTY block render Property #1's "Broker" output. To
        // make the conditional render blank in that worst case (matching the
        // spec: non-Broker / unresolved -> blank), force the bare key to "".
        // This is RE851D-only and runs after per-index publishers, so the
        // legitimate `_1`..`_5` entries are already in place and unaffected.
        for (const bareKey of ["pr_p_performeBy", "pr_p_performedBy"]) {
          fieldValues.set(bareKey, { rawValue: "", dataType: "text" });
        }
      }

      // (RE851D final encumbrance state log moved to after the authoritative
      // late pass — search for "RE851D final encumbrance state".)
    }

    // Auto-compute pr_p_address from pr_p_* component fields (new naming convention)
    const existingPrPAddr = fieldValues.get("pr_p_address");
    if (!existingPrPAddr || !existingPrPAddr.rawValue) {
      const street = fieldValues.get("pr_p_street")?.rawValue;
      const city = fieldValues.get("pr_p_city")?.rawValue;
      const state = fieldValues.get("pr_p_state")?.rawValue;
      const zip = fieldValues.get("pr_p_zip")?.rawValue;
      const county = fieldValues.get("pr_p_county")?.rawValue;
      const country = fieldValues.get("pr_p_country")?.rawValue;
      const parts = [street, city, state, country, zip].filter(Boolean).map(String);
      if (parts.length > 0) {
        const fullAddress = parts.join(", ");
        fieldValues.set("pr_p_address", { rawValue: fullAddress, dataType: "text" });
        debugLog(`[generate-document] Auto-computed pr_p_address = "${fullAddress}"`);
      }
    }

    // Auto-compute ln_p_loanToValueRatio if not already set
    const existingLtv = fieldValues.get("ln_p_loanToValueRatio");
    if (!existingLtv || !existingLtv.rawValue) {
      const loanAmountVal = fieldValues.get("ln_p_loanAmount")?.rawValue || fieldValues.get("loan_terms.loan_amount")?.rawValue;
      const appraiseVal = fieldValues.get("pr_p_appraiseValue")?.rawValue || fieldValues.get("property1.appraise_value")?.rawValue;
      const loanNum = parseFloat(String(loanAmountVal || "").replace(/[^0-9.-]/g, ""));
      const appraiseNum = parseFloat(String(appraiseVal || "").replace(/[^0-9.-]/g, ""));
      if (!isNaN(loanNum) && !isNaN(appraiseNum) && appraiseNum > 0) {
        const ltv = (loanNum / appraiseNum) * 100;
        const ltvStr = ltv.toFixed(2);
        fieldValues.set("ln_p_loanToValueRatio", { rawValue: ltvStr, dataType: "percentage" });
        fieldValues.set("loan_terms.loan_to_value_ratio", { rawValue: ltvStr, dataType: "percentage" });
        debugLog(`[generate-document] Auto-computed ln_p_loanToValueRatio = ${ltvStr}%`);
      }
    }

    // Auto-compute ln_p_loanAmountDivByEstimateValue if not already set
    // Formula: (ln_p_originalAmount / pr_pd_estimateValue) * 100
    // Renders blank when Estimate is missing or 0 (no divide-by-zero).
    // Note: "Loan amount" field was removed from the UI and replaced by ln_p_originalAmount.
    // Denominator prefers pr_pd_estimateValue, falls back to pr_p_appraiseValue/property1.appraise_value.
    const existingLoanDivEstimate = fieldValues.get("ln_p_loanAmountDivByEstimateValue");
    if (!existingLoanDivEstimate || !existingLoanDivEstimate.rawValue) {
      const originalAmountVal =
        fieldValues.get("ln_p_originalAmount")?.rawValue ||
        fieldValues.get("loan_terms.original_amount")?.rawValue ||
        // Legacy fallbacks (kept so historical deals that still hold the old key continue to render)
        fieldValues.get("ln_p_loanAmount")?.rawValue ||
        fieldValues.get("loan_terms.loan_amount")?.rawValue;
      const estimateVal =
        fieldValues.get("pr_pd_estimateValue")?.rawValue ||
        fieldValues.get("pr_p_appraiseValue")?.rawValue ||
        fieldValues.get("property1.appraise_value")?.rawValue;
      const originalNum = parseFloat(String(originalAmountVal || "").replace(/[^0-9.-]/g, ""));
      const estimateNum = parseFloat(String(estimateVal || "").replace(/[^0-9.-]/g, ""));
      if (!isNaN(originalNum) && !isNaN(estimateNum) && estimateNum > 0) {
        const ratio = originalNum / estimateNum;
        const ratioStr = ratio.toFixed(4);
        const pctStr = (ratio * 100).toFixed(2);
        // Primary key now stores the percentage value so {{ln_p_loanAmountDivByEstimateValue}}
        // renders as a percentage per the updated requirement.
        fieldValues.set("ln_p_loanAmountDivByEstimateValue", { rawValue: pctStr, dataType: "percentage" });
        fieldValues.set("ln_p_loanAmountDivByEstimateValue_pct", { rawValue: pctStr, dataType: "percentage" });
        fieldValues.set("ln_p_loanAmountDivByEstimateValue_ratio", { rawValue: ratioStr, dataType: "number" });
        debugLog(`[generate-document] Auto-computed ln_p_loanAmountDivByEstimateValue = ${pctStr}% (ratio=${ratioStr}) from ln_p_originalAmount/pr_pd_estimateValue`);
      }
    }

    // Alias pr_pd_estimateValue from pr_p_appraiseValue if not already set
    // (RE851A "MARKET VALUE OF PROPERTY (SEE PART 9)" uses {{pr_pd_estimateValue}})
    const existingEstimate = fieldValues.get("pr_pd_estimateValue");
    if (!existingEstimate || existingEstimate.rawValue === undefined || existingEstimate.rawValue === null || existingEstimate.rawValue === "") {
      const sourceEstimate = fieldValues.get("pr_p_appraiseValue") || fieldValues.get("property1.appraise_value");
      if (sourceEstimate && sourceEstimate.rawValue !== undefined && sourceEstimate.rawValue !== null && sourceEstimate.rawValue !== "") {
        fieldValues.set("pr_pd_estimateValue", { rawValue: sourceEstimate.rawValue, dataType: sourceEstimate.dataType || "currency" });
        debugLog(`[generate-document] Aliased pr_pd_estimateValue from pr_p_appraiseValue = ${sourceEstimate.rawValue}`);
      }
    }

    // Auto-compute ln_p_months if not already set (bridge from number_of_payments)
    const existingMonths = fieldValues.get("ln_p_months");
    if (!existingMonths || !existingMonths.rawValue) {
      const numPayments = fieldValues.get("ln_p_numberOfPaymen")?.rawValue || fieldValues.get("loan_terms.number_of_payments")?.rawValue;
      if (numPayments) {
        fieldValues.set("ln_p_months", { rawValue: String(numPayments), dataType: "number" });
        fieldValues.set("loan_terms.months", { rawValue: String(numPayments), dataType: "number" });
        debugLog(`[generate-document] Auto-bridged ln_p_months from number_of_payments = ${numPayments}`);
      }
    }

    // ── Bridge "Number of Payments" between dictionary aliases ──
    // The Loan Terms UI persists this value under the field_dictionary entry
    // `ln_p_numberOfPaymen` (label "Number of Payments"). A second dictionary
    // entry `ln_p_noofPaymen` (label "No.of Payments") exists with no UI writer,
    // so RE851A template tags like {{ ln_p_noofPaymen }} resolve to blank.
    // Mirror the value across both keys (and the `n_p_*` short variants seen in
    // some template tags) so the field populates regardless of which alias the
    // template uses. Also seeded from the canonical loan_terms.number_of_payments.
    {
      const noPaymentsRaw =
        fieldValues.get("ln_p_numberOfPaymen")?.rawValue ||
        fieldValues.get("ln_p_noofPaymen")?.rawValue ||
        fieldValues.get("loan_terms.number_of_payments")?.rawValue ||
        "";
      if (noPaymentsRaw !== "" && noPaymentsRaw !== undefined && noPaymentsRaw !== null) {
        const entry = { rawValue: String(noPaymentsRaw), dataType: "text" as const };
        for (const k of [
          "ln_p_numberOfPaymen",
          "ln_p_noofPaymen",
          "n_p_numberOfPaymen",
          "n_p_noofPaymen",
          "loan_terms.number_of_payments",
        ]) {
          const cur = fieldValues.get(k)?.rawValue;
          if (cur === undefined || cur === null || cur === "") {
            fieldValues.set(k, entry);
          }
        }
        debugLog(`[generate-document] Bridged Number of Payments across aliases = ${noPaymentsRaw}`);
      }
    }

    // Bridge ld_fd_fundingAmount from lender funding data, funding_records sum, or loan amount if not set
    const existingFundingAmt = fieldValues.get("ld_fd_fundingAmount");
    if (!existingFundingAmt || !existingFundingAmt.rawValue) {
      const lenderFunding = fieldValues.get("lender.funding.amount")?.rawValue;

      // Sum originalAmount across loan_terms.funding_records (same source as ld_fd_baseFee bridge)
      let fundingRecordsSum: string | null = null;
      const fundingRecordsRaw =
        fieldValues.get("loan_terms.funding_records")?.rawValue ||
        fieldValues.get("ln_p_fundingRecord")?.rawValue;
      if (fundingRecordsRaw) {
        try {
          const arr = typeof fundingRecordsRaw === "string"
            ? JSON.parse(fundingRecordsRaw)
            : fundingRecordsRaw;
          if (Array.isArray(arr)) {
            let sum = 0;
            let found = false;
            for (const rec of arr) {
              const v = rec?.originalAmount;
              if (v === undefined || v === null || v === "") continue;
              const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
              if (!isNaN(n)) { sum += n; found = true; }
            }
            if (found) fundingRecordsSum = sum.toFixed(2);
          }
        } catch (e) {
          debugLog(`[generate-document] ld_fd_fundingAmount funding_records parse error: ${e}`);
        }
      }

      const originalAmount = fieldValues.get("ln_p_originalAmount")?.rawValue;
      const loanAmount = fieldValues.get("ln_p_loanAmount")?.rawValue || fieldValues.get("loan_terms.loan_amount")?.rawValue;
      const fundingVal = lenderFunding || fundingRecordsSum || originalAmount || loanAmount;
      if (fundingVal) {
        fieldValues.set("ld_fd_fundingAmount", { rawValue: String(fundingVal), dataType: "currency" });
        debugLog(`[generate-document] Auto-bridged ld_fd_fundingAmount = ${fundingVal}`);
      }
    }



    // Bridge ln_p_originalAmount (Loan Terms → Original Amount) so the
    // {{ln_p_originalAmount}} merge tag always resolves regardless of the
    // section-key path the UI used when persisting the value. Sourced from
    // the canonical dictionary field_key first; falls back to legacy
    // section-prefixed keys ('loan.original_amount', 'loan_terms.original_amount')
    // and to ln_p_originalBalance / loan_terms.original_balance as last resort.
    // No overwrite when ln_p_originalAmount is already populated.
    {
      const existingOrigAmt = fieldValues.get("ln_p_originalAmount");
      const hasVal = existingOrigAmt && existingOrigAmt.rawValue !== undefined
        && existingOrigAmt.rawValue !== null && String(existingOrigAmt.rawValue) !== "";
      if (!hasVal) {
        const candidate =
          fieldValues.get("loan_terms.original_amount")?.rawValue ??
          fieldValues.get("loan.original_amount")?.rawValue ??
          fieldValues.get("ln_p_originalBalance")?.rawValue ??
          fieldValues.get("loan_terms.original_balance")?.rawValue;
        if (candidate !== undefined && candidate !== null && String(candidate) !== "") {
          fieldValues.set("ln_p_originalAmount", { rawValue: String(candidate), dataType: "currency" });
          debugLog(`[generate-document] Auto-bridged ln_p_originalAmount = ${candidate}`);
        }
      }
      // Mirror back to the loan_terms.* canonical alias so any downstream
      // label/canonical lookup paths find a value as well.
      const finalOrig = fieldValues.get("ln_p_originalAmount")?.rawValue;
      if (finalOrig !== undefined && finalOrig !== null && String(finalOrig) !== ""
          && !fieldValues.get("loan_terms.original_amount")?.rawValue) {
        fieldValues.set("loan_terms.original_amount", { rawValue: String(finalOrig), dataType: "currency" });
      }
    }


    // Bridge ld_fd_baseFee from funding_records JSON (sum of baseFee across records)
    const existingBaseFee = fieldValues.get("ld_fd_baseFee");
    if (!existingBaseFee || !existingBaseFee.rawValue) {
      const fundingRecordsRaw =
        fieldValues.get("loan_terms.funding_records")?.rawValue ||
        fieldValues.get("ln_p_fundingRecord")?.rawValue;
      if (fundingRecordsRaw) {
        try {
          const arr = typeof fundingRecordsRaw === "string"
            ? JSON.parse(fundingRecordsRaw)
            : fundingRecordsRaw;
          if (Array.isArray(arr)) {
            let sum = 0;
            let found = false;
            for (const rec of arr) {
              const v = rec?.baseFee;
              if (v === undefined || v === null || v === "") continue;
              const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
              if (!isNaN(n)) { sum += n; found = true; }
            }
            if (found) {
              fieldValues.set("ld_fd_baseFee", { rawValue: sum.toFixed(2), dataType: "currency" });
              debugLog(`[generate-document] Auto-bridged ld_fd_baseFee = ${sum.toFixed(2)}`);
            }
          }
        } catch (e) {
          debugLog(`[generate-document] ld_fd_baseFee bridge parse error: ${e}`);
        }
      }
    }

    // Auto-compute ln_p_estimateBallooPaymen (Estimated Balloon Payment) if not already set.
    // Mirrors the read-only UI calculation in LoanTermsBalancesForm:
    //   estimatedBalloon = totalBalanceDue + (loanAmount * noteRate / 100) / 12
    // where totalBalanceDue = principal + unpaidInterest + accruedInterest
    //                       + chargesOwed + chargesInterest + unpaidOther
    const existingEstBalloon = fieldValues.get("ln_p_estimateBallooPaymen");
    if (!existingEstBalloon || !existingEstBalloon.rawValue) {
      const numFromKeys = (...keys: string[]): number => {
        for (const k of keys) {
          const raw = fieldValues.get(k)?.rawValue;
          if (raw === undefined || raw === null || raw === "") continue;
          const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
          if (!isNaN(n)) return n;
        }
        return 0;
      };
      const principal = numFromKeys("ln_p_principa", "loan_terms.principal");
      const unpaidInterest = numFromKeys("ln_bl_unpaidIntere", "loan_terms.unpaid_interest");
      const accruedInterest = numFromKeys("ln_p_accruedIntere", "loan_terms.accrued_interest");
      const chargesOwed = numFromKeys("ln_p_chargesOwed", "loan_terms.charges_owed");
      const chargesInterest = numFromKeys("ln_p_chargesIntere", "loan_terms.charges_interest");
      const unpaidOther = numFromKeys("ln_p_unpaidOther", "loan_terms.unpaid_other");
      const loanAmt = numFromKeys("ln_p_loanAmount", "loan_terms.loan_amount");
      const noteRate = numFromKeys("ln_p_noteRate", "loan_terms.note_rate");

      const totalBalanceDue =
        principal + unpaidInterest + accruedInterest +
        chargesOwed + chargesInterest + unpaidOther;
      const oneMonthInterest = (loanAmt * (noteRate / 100)) / 12;
      const estimatedBalloon = totalBalanceDue + oneMonthInterest;

      if (estimatedBalloon > 0 || loanAmt > 0 || principal > 0) {
        const estStr = estimatedBalloon.toFixed(2);
        fieldValues.set("ln_p_estimateBallooPaymen", { rawValue: estStr, dataType: "currency" });
        fieldValues.set("loan_terms.estimated_balloon_payment", { rawValue: estStr, dataType: "currency" });
        debugLog(`[generate-document] Auto-computed ln_p_estimateBallooPaymen = ${estStr} (totalBalanceDue=${totalBalanceDue}, oneMonthInterest=${oneMonthInterest})`);
      }
    }

    // Auto-compute ln_p_proRataPayment for RE851A when it has not been saved yet.
    // The app-side calculation engine computes calculated dictionary fields before save,
    // but document generation must also publish this runtime alias so templates render
    // {{ln_p_proRataPayment}} from the saved input fields alone.
    {
      const existingProRataPayment = fieldValues.get("ln_p_proRataPayment");
      if (!existingProRataPayment || existingProRataPayment.rawValue === undefined || existingProRataPayment.rawValue === null || existingProRataPayment.rawValue === "") {
        const numFromKeysPR = (...keys: string[]): number | null => {
          for (const k of keys) {
            const raw = fieldValues.get(k)?.rawValue;
            if (raw === undefined || raw === null || raw === "") continue;
            const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
            if (!isNaN(n)) return n;
          }
          return null;
        };
        const estimatedBalloon = numFromKeysPR("ln_p_estimateBallooPaymen", "loan_terms.estimated_balloon_payment");
        const regularPayment = numFromKeysPR("ln_p_regularPaymen", "loan_terms.regular_payment");
        const proRata = numFromKeysPR("loan_terms.pro_rata", "ln_p_proRata");

        if (estimatedBalloon !== null && regularPayment !== null && proRata !== null && proRata !== 0) {
          const proRataDivisor = proRata > 1 ? proRata / 100 : proRata;
          const proRataPayment = (estimatedBalloon + regularPayment) * proRataDivisor;
          const proRataStr = proRataPayment.toFixed(2);
          fieldValues.set("ln_p_proRataPayment", { rawValue: proRataStr, dataType: "currency" });
          fieldValues.set("loan_terms.pro_rata_payment", { rawValue: proRataStr, dataType: "currency" });
          debugLog(`[generate-document] Auto-computed ln_p_proRataPayment = ${proRataStr} (estimatedBalloon=${estimatedBalloon}, regularPayment=${regularPayment}, proRata=${proRata})`);
        }
      }
    }

    // ── Auto-compute Monthly Payment (P&I) — ln_monthlyPayment_PI ──
    // Standard US amortization: P * r / (1 - (1+r)^-n) where r = annualRate/12/100, n = term months.
    // Edge cases: zero rate → P/n; zero term → 0. Null inputs treated as 0.
    {
      const numFromKeysMP = (...keys: string[]): number => {
        for (const k of keys) {
          const raw = fieldValues.get(k)?.rawValue;
          if (raw === undefined || raw === null || raw === "") continue;
          const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
          if (!isNaN(n)) return n;
        }
        return 0;
      };
      const principalP = numFromKeysMP("ln_p_loanAmount", "loan_terms.loan_amount");
      const annualRate = numFromKeysMP("ln_p_noteRate", "loan_terms.note_rate");
      const termMonths = numFromKeysMP(
        "ln_p_numberOfPaymen", "loan_terms.number_of_payments",
        "ln_p_termMonths", "loan_terms.term_months",
        "ln_p_months", "loan_terms.months",
        "ln_p_loanTermMonths"
      );
      const monthlyRate = annualRate / 12 / 100;
      let monthlyPI = 0;
      if (termMonths > 0) {
        if (monthlyRate === 0) {
          monthlyPI = principalP / termMonths;
        } else {
          const denom = 1 - Math.pow(1 + monthlyRate, -termMonths);
          if (denom !== 0) monthlyPI = (principalP * monthlyRate) / denom;
        }
      }
      const monthlyPIStr = monthlyPI.toFixed(2);
      fieldValues.set("ln_monthlyPayment_PI", { rawValue: monthlyPIStr, dataType: "currency" });
      fieldValues.set("loan_terms.monthly_payment_pi", { rawValue: monthlyPIStr, dataType: "currency" });
      // Also publish under ln_monthlyPayment_P (no "I" suffix) so templates that
      // reference the abbreviated tag resolve to the same auto-computed value.
      fieldValues.set("ln_monthlyPayment_P", { rawValue: monthlyPIStr, dataType: "currency" });
      debugLog(`[generate-document] Auto-computed ln_monthlyPayment_PI = ${monthlyPIStr} (P=${principalP}, annualRate=${annualRate}%, n=${termMonths}, monthlyRate=${monthlyRate})`);
    }

    // ── Auto-compute Regular + Estimated Balloon Payment — ln_p_regularPlusBalloonPaymen ──
    // field_dictionary defines this as calculated (formula: regularPaymen + estimateBallooPaymen)
    // but no general calc engine runs in the edge function, so publish the sum here.
    {
      const numFromKeysRB = (...keys: string[]): number | null => {
        for (const k of keys) {
          const raw = fieldValues.get(k)?.rawValue;
          if (raw === undefined || raw === null || raw === "") continue;
          const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
          if (!isNaN(n)) return n;
        }
        return null;
      };
      const regularPaymentRB = numFromKeysRB("ln_p_regularPaymen", "loan_terms.regular_payment");
      const estimatedBalloonRB = numFromKeysRB("ln_p_estimateBallooPaymen", "loan_terms.estimated_balloon_payment");
      if (regularPaymentRB !== null || estimatedBalloonRB !== null) {
        const sumRB = (regularPaymentRB ?? 0) + (estimatedBalloonRB ?? 0);
        const sumRBStr = sumRB.toFixed(2);
        fieldValues.set("ln_p_regularPlusBalloonPaymen", { rawValue: sumRBStr, dataType: "currency" });
        fieldValues.set("loan_terms.regular_plus_balloon_payment", { rawValue: sumRBStr, dataType: "currency" });
        debugLog(`[generate-document] Auto-computed ln_p_regularPlusBalloonPaymen = ${sumRBStr} (regular=${regularPaymentRB}, estBalloon=${estimatedBalloonRB})`);
      }
    }

    // ── Dropdown-to-Checkbox derivation for Re851a ──
    // Amortization dropdown → boolean checkbox keys (CHECK ONE — mutually exclusive)
    const amortVal = (fieldValues.get("ln_p_amortiza")?.rawValue || fieldValues.get("loan_terms.amortization")?.rawValue || "").toString().trim().toLowerCase();
    const isFullyAmortized = ["fully_amortized", "fully amortized", "amortized"].includes(amortVal);
    const isPartiallyAmortized = ["partially_amortized", "partially amortized", "amortized partially"].includes(amortVal);
    const isInterestOnly = ["interest_only", "interest only", "interestonly"].includes(amortVal);
    const isConstantAmortization = ["constant_amortization", "constant amortization", "constantamortization"].includes(amortVal);
    const isAddOnInterest = ["add_on_interest", "add-on interest", "add on interest", "addoninterest", "addon interest"].includes(amortVal);
    const isAmortOther = amortVal === "other";
    fieldValues.set("ln_p_amortized", { rawValue: isFullyAmortized ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_amortizedPartially", { rawValue: isPartiallyAmortized ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_interestOnly", { rawValue: isInterestOnly ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_constantAmortization", { rawValue: isConstantAmortization ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_addOnInterest", { rawValue: isAddOnInterest ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_other", { rawValue: isAmortOther ? "true" : "false", dataType: "boolean" });
    // Glyph aliases for templates that render static ☐/☑ via merge tag instead of a boolean checkbox.
    fieldValues.set("ln_p_amortizedGlyph", { rawValue: isFullyAmortized ? "☑" : "☐", dataType: "text" });
    fieldValues.set("ln_p_amortizedPartiallyGlyph", { rawValue: isPartiallyAmortized ? "☑" : "☐", dataType: "text" });
    fieldValues.set("ln_p_interestOnlyGlyph", { rawValue: isInterestOnly ? "☑" : "☐", dataType: "text" });
    fieldValues.set("ln_p_constantAmortizationGlyph", { rawValue: isConstantAmortization ? "☑" : "☐", dataType: "text" });
    fieldValues.set("ln_p_addOnInterestGlyph", { rawValue: isAddOnInterest ? "☑" : "☐", dataType: "text" });
    fieldValues.set("ln_p_otherGlyph", { rawValue: isAmortOther ? "☑" : "☐", dataType: "text" });
    debugLog(`[generate-document] Derived amortization checkboxes from "${amortVal}": amortized=${isFullyAmortized}, amortizedPartially=${isPartiallyAmortized}, interestOnly=${isInterestOnly}, constantAmortization=${isConstantAmortization}, addOnInterest=${isAddOnInterest}, other=${isAmortOther}`);

    // Principal Paydown Type dropdown → boolean checkbox + glyph aliases
    // Template uses {{ln_pn_principalPaydownType_original}} / _unpaid (or _none / _partial / _full / _other).
    {
      const ppdRaw = (
        fieldValues.get("ln_pn_principalPaydownType")?.rawValue ??
        fieldValues.get("loan_terms.penalties.prepayment.principal_paydown_type")?.rawValue ??
        ""
      ).toString().trim();
      const ppdNorm = ppdRaw.toLowerCase().replace(/\s+/g, "_");
      const variants = ["original", "unpaid", "none", "partial", "full", "other"];
      for (const v of variants) {
        const isMatch = ppdNorm === v;
        fieldValues.set(`ln_pn_principalPaydownType_${v}`, { rawValue: isMatch ? "true" : "false", dataType: "boolean" });
        fieldValues.set(`ln_pn_principalPaydownType_${v}Glyph`, { rawValue: isMatch ? "☑" : "☐", dataType: "text" });
      }
      // Republish canonical normalized label (Title Case) for direct display
      const titleCase = ppdRaw ? ppdRaw.charAt(0).toUpperCase() + ppdRaw.slice(1).toLowerCase() : "";
      fieldValues.set("ln_pn_principalPaydownType", { rawValue: titleCase, dataType: "text" });
      debugLog(`[generate-document] Derived ln_pn_principalPaydownType checkboxes from "${ppdRaw}" (norm="${ppdNorm}")`);
    }

    // Payment Frequency dropdown → boolean checkbox keys
    const payFreqVal = (fieldValues.get("ln_p_paymentFreque")?.rawValue || fieldValues.get("loan_terms.payment_frequency")?.rawValue || "").toString().trim().toLowerCase();
    fieldValues.set("ln_p_paymentMonthly", { rawValue: payFreqVal === "monthly" ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_paymentWeekly", { rawValue: payFreqVal === "weekly" ? "true" : "false", dataType: "boolean" });
    debugLog(`[generate-document] Derived payment frequency checkboxes from "${payFreqVal}": monthly=${payFreqVal === "monthly"}, weekly=${payFreqVal === "weekly"}`);

    // Balloon Payment (RE851A Part 3) → boolean checkbox key
    // UI persists under loan_terms.balloon_payment (legacy alias ln_p_balloonPaymen, note truncated key).
    // Template uses {{ln_p_balloonPayment}} (full spelling) for YES/NO conditional checkboxes.
    const balloonRaw = (
      fieldValues.get("loan_terms.balloon_payment")?.rawValue ??
      fieldValues.get("ln_p_balloonPaymen")?.rawValue ??
      fieldValues.get("ln_p_balloonPayment")?.rawValue ?? ""
    ).toString().trim().toLowerCase();
    const balloonTrue = ["true", "1", "yes", "on", "checked"].includes(balloonRaw);
    fieldValues.set("ln_p_balloonPayment", { rawValue: balloonTrue ? "true" : "false", dataType: "boolean" });
    fieldValues.set("ln_p_balloonPaymen", { rawValue: balloonTrue ? "true" : "false", dataType: "boolean" });
    fieldValues.set("loan_terms.balloon_payment", { rawValue: balloonTrue ? "true" : "false", dataType: "boolean" });
    debugLog(`[generate-document] Derived ln_p_balloonPayment from "${balloonRaw}": ${balloonTrue}`);

    // Subordination Provision (RE851A Yes/No row) → boolean checkbox key.
    // CSR persists under loan_terms.subordination_provision; template references
    // {{ln_p_subordinationProvision}}. Republish normalized boolean under both
    // names so the conditional always evaluates against the saved value.
    const subordinationRaw = (
      fieldValues.get("ln_p_subordinationProvision")?.rawValue ??
      fieldValues.get("loan_terms.subordination_provision")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    const subordinationTrue = ["true", "yes", "y", "1", "checked", "on"].includes(subordinationRaw);
    fieldValues.set("ln_p_subordinationProvision", { rawValue: subordinationTrue ? "true" : "false", dataType: "boolean" });
    fieldValues.set("loan_terms.subordination_provision", { rawValue: subordinationTrue ? "true" : "false", dataType: "boolean" });
    debugLog(`[generate-document] Derived ln_p_subordinationProvision from "${subordinationRaw}" (rawType=${typeof subordinationRaw}): normalized=${subordinationTrue}`);

    // Broker Capacity in Transaction (RE851A Part 2) → boolean checkbox keys
    // Derived from "Is Broker Also a Borrower?" UI checkbox. The UI persists this
    // under origination_app.doc.is_broker_also_borrower_yes (legacy alias
    // or_p_isBrokerAlsoBorrower_yes); also accept legacy variants.
    // Resolution order (first non-empty wins):
    //   1. Borrower-side dropdown (Yes/No) — origination_app.borrower.is_borrower_also_broker
    //      (this is the field the UI actually surfaces in OriginationApplicationForm)
    //   2. Doc-section YES checkbox (legacy + canonical aliases)
    //   3. Doc-section NO checkbox (inverted)
    //   4. Other legacy aliases
    const dropdownRaw = (
      fieldValues.get("origination_app.borrower.is_borrower_also_broker")?.rawValue ??
      fieldValues.get("or_p_isBorrowerAlsoBroker")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    const yesRaw = (
      fieldValues.get("or_p_isBrokerAlsoBorrower_yes")?.rawValue ??
      fieldValues.get("origination_app.doc.is_broker_also_borrower_yes")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    const noRaw = (
      fieldValues.get("or_p_isBrokerAlsoBorrower_no")?.rawValue ??
      fieldValues.get("origination_app.doc.is_broker_also_borrower_no")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    let brkBorrowerRaw = "";
    if (dropdownRaw) {
      brkBorrowerRaw = dropdownRaw;
    } else if (yesRaw) {
      brkBorrowerRaw = yesRaw;
    } else if (noRaw) {
      // Invert NO checkbox into the YES truthiness used downstream
      const noTrue = ["true", "yes", "y", "1", "checked", "on"].includes(noRaw);
      brkBorrowerRaw = noTrue ? "false" : "true";
    } else {
      brkBorrowerRaw = (
        fieldValues.get("or_p_isBrkBorrower")?.rawValue ??
        fieldValues.get("origination.is_broker_also_a_borrower")?.rawValue ??
        ""
      ).toString().trim().toLowerCase();
    }
    const brkBorrowerTrue = ["true", "yes", "y", "1", "checked", "on"].includes(brkBorrowerRaw);
    fieldValues.set("or_p_brkCapacityPrincipal", { rawValue: brkBorrowerTrue ? "true" : "false", dataType: "boolean" });
    fieldValues.set("or_p_brkCapacityAgent", { rawValue: brkBorrowerTrue ? "false" : "true", dataType: "boolean" });
    // Also publish under or_p_isBrkBorrower so any {{#if or_p_isBrkBorrower}} blocks
    // in the RE851A template evaluate against the same source of truth.
    fieldValues.set("or_p_isBrkBorrower", { rawValue: brkBorrowerTrue ? "true" : "false", dataType: "boolean" });
    // Also publish glyph-form aliases so simple {{or_p_isBrkBorrower_glyph}} or
    // direct A/B glyph merge tags resolve correctly without altering layout.
    fieldValues.set("or_p_brkCapacityAgentGlyph", { rawValue: brkBorrowerTrue ? "☐" : "☑", dataType: "text" });
    fieldValues.set("or_p_brkCapacityPrincipalGlyph", { rawValue: brkBorrowerTrue ? "☑" : "☐", dataType: "text" });
    debugLog(`[generate-document] Derived broker capacity checkboxes from "${brkBorrowerRaw}": agent=${!brkBorrowerTrue}, principal=${brkBorrowerTrue}, isBrkBorrower=${brkBorrowerTrue}`);

    // Servicing Agent (RE851A Servicing section) → boolean checkbox keys.
    // CSR persists the dropdown under origination_svc.servicing_agent. The
    // RE851A template has three mutually-exclusive checkboxes that toggle
    // based on the selected value:
    //   - Lender                 → "THERE ARE NO SERVICING ARRANGEMENTS"
    //   - Broker                 → "BROKER IS THE SERVICING AGENT"
    //   - Company / Other Servicer → "ANOTHER QUALIFIED PARTY WILL SERVICE THE LOAN"
    // We publish boolean + glyph aliases under several plausible merge-tag
    // names so the template's existing {{#if ...}} blocks resolve correctly
    // without requiring template edits.
    const servicingAgentRaw = (
      fieldValues.get("origination_svc.servicing_agent")?.rawValue ??
      fieldValues.get("sv_p_servicingAgent")?.rawValue ??
      fieldValues.get("loan_terms.servicing_agent")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    const isLenderServicing = servicingAgentRaw === "lender";
    const isBrokerServicing = servicingAgentRaw === "broker";
    const isOtherServicing = servicingAgentRaw === "company" || servicingAgentRaw === "other servicer" || servicingAgentRaw === "other";
    const setBool = (k: string, v: boolean) => fieldValues.set(k, { rawValue: v ? "true" : "false", dataType: "boolean" });
    const setGlyph = (k: string, v: boolean) => fieldValues.set(k, { rawValue: v ? "☑" : "☐", dataType: "text" });
    // "No servicing arrangements" (Lender)
    setBool("sv_p_noServicingArrangements", isLenderServicing);
    setBool("sv_p_lenderServicing", isLenderServicing);
    setBool("sv_p_isLenderServicing", isLenderServicing);
    setGlyph("sv_p_noServicingArrangementsGlyph", isLenderServicing);
    setGlyph("sv_p_lenderServicingGlyph", isLenderServicing);
    // "Broker is the servicing agent"
    setBool("sv_p_brokerIsServicingAgent", isBrokerServicing);
    setBool("sv_p_brokerServicing", isBrokerServicing);
    setBool("sv_p_isBrokerServicing", isBrokerServicing);
    setGlyph("sv_p_brokerIsServicingAgentGlyph", isBrokerServicing);
    setGlyph("sv_p_brokerServicingGlyph", isBrokerServicing);
    // "Another qualified party will service the loan" (Company / Other Servicer)
    setBool("sv_p_anotherQualifiedParty", isOtherServicing);
    setBool("sv_p_otherServicing", isOtherServicing);
    setBool("sv_p_isOtherServicing", isOtherServicing);
    setBool("sv_p_qualifiedPartyServicing", isOtherServicing);
    setGlyph("sv_p_anotherQualifiedPartyGlyph", isOtherServicing);
    setGlyph("sv_p_otherServicingGlyph", isOtherServicing);
    // Publish the canonical merge key the RE851A template references directly
    // in {{#if (eq sv_p_servicingAgent "Lender" | "Broker" | "Company" | "Other Servicer")}}.
    // Title-case so even non-case-insensitive consumers resolve correctly; the
    // (eq ...) evaluator already lowercases both sides for the comparison.
    const canonicalServicingAgent =
      isLenderServicing ? "Lender" :
      isBrokerServicing ? "Broker" :
      servicingAgentRaw === "company" ? "Company" :
      (servicingAgentRaw === "other servicer" || servicingAgentRaw === "other") ? "Other Servicer" :
      "";
    fieldValues.set("sv_p_servicingAgent", { rawValue: canonicalServicingAgent, dataType: "text" });
    // Also publish under the oo_svc_* prefix (Other Origination → Servicing) used
    // by newer RE851A template revisions: {{#if (eq oo_svc_servicingAgent "Broker")}}.
    fieldValues.set("oo_svc_servicingAgent", { rawValue: canonicalServicingAgent, dataType: "text" });
    debugLog(`[generate-document] Derived servicing-agent checkboxes from "${servicingAgentRaw}": lender=${isLenderServicing}, broker=${isBrokerServicing}, other=${isOtherServicing}, sv_p_servicingAgent="${canonicalServicingAgent}", oo_svc_servicingAgent="${canonicalServicingAgent}"`);

    // Loan -> Servicing Details -> Payable (Monthly / Quarterly / Annually).
    // CSR persists the dropdown under loan_terms.servicing.payable (and the
    // legacy `origination_svc.payable`). The RE851A template references
    // `loan_terms.servicing.payable_annually` inside its
    // {{#if (eq loan_terms.servicing.payable_annually "Monthly")}} /
    // {{#if (eq loan_terms.servicing.payable_annually "Annually")}} blocks.
    // Publish a canonical (title-cased) alias under the template's expected
    // key so those blocks resolve correctly without altering the template,
    // the UI field key, or the database mapping. Also publish boolean +
    // glyph aliases for downstream consumers, mirroring the Servicing Agent
    // pattern above.
    const payableRaw = (
      fieldValues.get("loan_terms.servicing.payable")?.rawValue ??
      fieldValues.get("origination_svc.payable")?.rawValue ??
      fieldValues.get("loan_terms.servicing.payable_annually")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
    const isPayableMonthly = payableRaw === "monthly";
    const isPayableQuarterly = payableRaw === "quarterly";
    const isPayableAnnually = payableRaw === "annually" || payableRaw === "annual" || payableRaw === "yearly";
    const canonicalPayable =
      isPayableMonthly ? "Monthly" :
      isPayableQuarterly ? "Quarterly" :
      isPayableAnnually ? "Annually" :
      "";
    if (canonicalPayable) {
      fieldValues.set("loan_terms.servicing.payable_annually", { rawValue: canonicalPayable, dataType: "text" });
      fieldValues.set("loan_terms.servicing.payable", { rawValue: canonicalPayable, dataType: "text" });
      fieldValues.set("origination_svc.payable", { rawValue: canonicalPayable, dataType: "text" });
      setBool("sv_p_payableMonthly", isPayableMonthly);
      setBool("sv_p_payableAnnually", isPayableAnnually);
      setGlyph("sv_p_payableMonthlyGlyph", isPayableMonthly);
      setGlyph("sv_p_payableAnnuallyGlyph", isPayableAnnually);
    }
    debugLog(`[generate-document] Derived payable-frequency checkboxes from "${payableRaw}": monthly=${isPayableMonthly}, annually=${isPayableAnnually}, canonical="${canonicalPayable}"`);


    // Build all_properties_list and multi-property pr_p_address
    if (propertyIndices.size > 0) {
      const sortedIndices = [...propertyIndices].sort((a, b) => a - b);
      const propertyLines: string[] = [];
      const seenAddresses = new Set<string>();
      for (const idx of sortedIndices) {
        const addr = fieldValues.get(`property${idx}.address`)?.rawValue || fieldValues.get(`Property${idx}.Address`)?.rawValue;
        if (addr) {
          const addrStr = String(addr);
          if (!seenAddresses.has(addrStr)) {
            seenAddresses.add(addrStr);
            propertyLines.push(addrStr.trim());
          }
        }
      }
      if (propertyLines.length > 0) {
        const normalizedPropertyLines = propertyLines.map((line) =>
          String(line)
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((part) => part.trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\t+/g, " ")
            .replace(/ {2,}/g, " ")
            .trim()
        );
        const allPropertiesText = normalizedPropertyLines.join("\n");
        fieldValues.set("all_properties_list", { rawValue: allPropertiesText, dataType: "text" });
        debugLog(`[generate-document] Built all_properties_list with ${propertyLines.length} properties`);
      }
      // NOTE: Do NOT overwrite pr_p_address / property1.address / Property1.Address with the
      // joined multi-line string when multiple properties exist. RE851D and similar multi-block
      // templates rely on per-index aliases (pr_p_address_1, pr_p_address_2, ...) so each
      // property block populates with its own data. Concatenating all addresses into
      // pr_p_address caused every property block to display the same combined list.
      // Templates that need the combined list can use {{all_properties_list}}.
          }


    const existingBrPFullName = fieldValues.get("br_p_fullName");
    if (!existingBrPFullName || !existingBrPFullName.rawValue) {
      // Check indexed borrower keys first
      const b1FullName = fieldValues.get("borrower1.full_name") || fieldValues.get("borrower.full_name");
      if (b1FullName && b1FullName.rawValue) {
        fieldValues.set("br_p_fullName", { rawValue: b1FullName.rawValue, dataType: "text" });
        debugLog(`[generate-document] Auto-computed br_p_fullName = "${b1FullName.rawValue}"`);
      } else {
        // Try assembling from borrower name components
        const bFirstName = fieldValues.get("borrower1.first_name")?.rawValue || fieldValues.get("borrower.first_name")?.rawValue || fieldValues.get("br_p_firstName")?.rawValue;
        const bMiddleName = fieldValues.get("borrower1.middle_initial")?.rawValue || fieldValues.get("borrower.middle_initial")?.rawValue || fieldValues.get("br_p_middleInitia")?.rawValue;
        const bLastName = fieldValues.get("borrower1.last_name")?.rawValue || fieldValues.get("borrower.last_name")?.rawValue || fieldValues.get("br_p_lastName")?.rawValue;
        const bNameParts = [bFirstName, bMiddleName, bLastName].filter(Boolean).map(String);
        if (bNameParts.length > 0) {
          const fullName = bNameParts.join(" ");
          fieldValues.set("br_p_fullName", { rawValue: fullName, dataType: "text" });
          debugLog(`[generate-document] Auto-computed br_p_fullName from components = "${fullName}"`);
        } else {
          // Final fallback: check Loan Details borrower name field
          const loanDetailsBorrowerName = fieldValues.get("loan_terms.details_borrower_name");
          if (loanDetailsBorrowerName?.rawValue) {
            fieldValues.set("br_p_fullName", { rawValue: loanDetailsBorrowerName.rawValue, dataType: "text" });
            debugLog(`[generate-document] Auto-computed br_p_fullName from loan_terms.details_borrower_name = "${loanDetailsBorrowerName.rawValue}"`);
          }
        }
      }
    }
    // Bridge reverse: if br_p_fullName has data but dot-notation variants don't
    const resolvedBrPFullName = fieldValues.get("br_p_fullName");
    if (resolvedBrPFullName?.rawValue) {
      if (!fieldValues.has("borrower.full_name")) {
        fieldValues.set("borrower.full_name", resolvedBrPFullName);
      }
      if (!fieldValues.has("borrower1.full_name")) {
        fieldValues.set("borrower1.full_name", resolvedBrPFullName);
      }
    }

    // Auto-compute Broker.Name from broker1 name components if not already set
    const existingBrokerName = fieldValues.get("Broker.Name") || fieldValues.get("broker.name");
    if (!existingBrokerName || !existingBrokerName.rawValue) {
      const firstName = fieldValues.get("broker1.first_name")?.rawValue;
      const middleName = fieldValues.get("broker1.middle_name")?.rawValue;
      const lastName = fieldValues.get("broker1.last_name")?.rawValue;
      const company = fieldValues.get("broker1.company")?.rawValue;

      const nameParts = [firstName, middleName, lastName].filter(Boolean).map(String);
      const brokerName = nameParts.length > 0 ? nameParts.join(" ") : (company ? String(company) : null);

      if (brokerName) {
        fieldValues.set("Broker.Name", { rawValue: brokerName, dataType: "text" });
        fieldValues.set("broker.name", { rawValue: brokerName, dataType: "text" });
        debugLog(`[generate-document] Auto-computed Broker.Name = "${brokerName}"`);
      }
    }

    // Auto-compute bk_p_brokerLicens from broker section data.
    // Force-publish (overwrite null/empty stored entries) since field_dictionary
    // may carry data_type=number causing the dsv loader to set rawValue=null
    // when the value is actually stored as text.
    {
      const existingLicense = fieldValues.get("bk_p_brokerLicens");
      const license =
        fieldValues.get("broker1.License")?.rawValue
        || fieldValues.get("broker1.license_number")?.rawValue
        || fieldValues.get("broker.License")?.rawValue
        || fieldValues.get("broker.license_number")?.rawValue
        || fieldValues.get("bk_p_license")?.rawValue;
      const existingHasValue = existingLicense?.rawValue !== undefined
        && existingLicense?.rawValue !== null
        && String(existingLicense?.rawValue ?? "").trim() !== "";
      if (!existingHasValue && license !== undefined && license !== null && String(license).trim() !== "") {
        fieldValues.set("bk_p_brokerLicens", { rawValue: String(license), dataType: "text" });
        debugLog(`[generate-document] Auto-computed bk_p_brokerLicens = "${license}"`);
      }
    }

    // Auto-compute Borrower.Address from component fields if not already set
    const existingBorrowerAddr = fieldValues.get("Borrower.Address") || fieldValues.get("borrower.address");
    if (!existingBorrowerAddr || !existingBorrowerAddr.rawValue) {
      const street = fieldValues.get("borrower1.address.street")?.rawValue || fieldValues.get("borrower.address.street")?.rawValue;
      const city = fieldValues.get("borrower1.address.city")?.rawValue || fieldValues.get("borrower.address.city")?.rawValue;
      const state = fieldValues.get("borrower1.state")?.rawValue || fieldValues.get("borrower.state")?.rawValue;
      const zip = fieldValues.get("borrower1.address.zip")?.rawValue || fieldValues.get("borrower.address.zip")?.rawValue;

      const parts = [street, city, state, zip].filter(Boolean).map(String);
      if (parts.length > 0) {
        const fullAddress = parts.join(", ");
        fieldValues.set("Borrower.Address", { rawValue: fullAddress, dataType: "text" });
        fieldValues.set("borrower.address", { rawValue: fullAddress, dataType: "text" });
        debugLog(`[generate-document] Auto-computed Borrower.Address = "${fullAddress}"`);
      }
    }

    // Auto-publish br_p_address (RE851A short-form merge tag for borrower street)
    // Falls back across every place the street might have been loaded so the tag
    // never renders blank when a street value exists somewhere in the deal.
    {
      const existing = fieldValues.get("br_p_address")?.rawValue;
      if (existing === undefined || existing === null || String(existing).trim() === "") {
        const street =
          fieldValues.get("borrower.address.street")?.rawValue ||
          fieldValues.get("borrower1.address.street")?.rawValue ||
          fieldValues.get("borrower.street")?.rawValue ||
          fieldValues.get("br_p_street")?.rawValue;
        if (street && String(street).trim() !== "") {
          fieldValues.set("br_p_address", { rawValue: String(street), dataType: "text" });
          debugLog(`[generate-document] Auto-published br_p_address = "${street}"`);
        }
      }
    }

    // Auto-compute Lender.Address from component fields if not already set
    const existingLenderAddr = fieldValues.get("Lender.Address") || fieldValues.get("lender.address");
    if (!existingLenderAddr || !existingLenderAddr.rawValue) {
      const street = fieldValues.get("lender1.primary_address.street")?.rawValue || fieldValues.get("lender.primary_address.street")?.rawValue;
      const city = fieldValues.get("lender1.primary_address.city")?.rawValue || fieldValues.get("lender.primary_address.city")?.rawValue;
      const state = fieldValues.get("lender1.primary_address.state")?.rawValue || fieldValues.get("lender.primary_address.state")?.rawValue;
      const zip = fieldValues.get("lender1.primary_address.zip")?.rawValue || fieldValues.get("lender.primary_address.zip")?.rawValue;

      const parts = [street, city, state, zip].filter(Boolean).map(String);
      if (parts.length > 0) {
        const fullAddress = parts.join(", ");
        fieldValues.set("Lender.Address", { rawValue: fullAddress, dataType: "text" });
        fieldValues.set("lender.address", { rawValue: fullAddress, dataType: "text" });
        debugLog(`[generate-document] Auto-computed Lender.Address = "${fullAddress}"`);
      }
    }

    // Auto-compute has_co_borrower boolean flag from existing co-borrower field data
    // Co-borrower keys can appear as: co_borrower1.*, coborrower.*, or borrower1.coborrower.*
    let hasCoBorrowerData = false;
    for (const [key, val] of fieldValues.entries()) {
      const lk = key.toLowerCase();
      const isCoBorrowerKey = lk.startsWith("co_borrower") || lk.startsWith("coborrower") ||
        lk.includes(".coborrower.") || lk.includes(".co_borrower.");
      if (isCoBorrowerKey && val.rawValue != null && String(val.rawValue).trim() !== "") {
        hasCoBorrowerData = true;
        break;
      }
    }
    fieldValues.set("has_co_borrower", { rawValue: hasCoBorrowerData ? "true" : "false", dataType: "boolean" });
    debugLog(`[generate-document] Auto-computed has_co_borrower = ${hasCoBorrowerData}`);

    // Auto-compute co_borrower_section: conditionally rendered content block
    // Check for co-borrower name across common field key patterns
    let coBorrowerName = "";
    const coBorrowerNameKeys = [
      "borrower.co_borrower_name", "borrower1.co_borrower_name",
      "coborrower.name", "co_borrower.name",
      "co_borrower1.first_name", "coborrower.first_name",
      "borrower1.coborrower.full_name", "borrower1.co_borrower.full_name",
    ];
    for (const nameKey of coBorrowerNameKeys) {
      const match = fieldValues.get(nameKey);
      if (match && match.rawValue != null && String(match.rawValue).trim() !== "") {
        coBorrowerName = String(match.rawValue).trim();
        break;
      }
    }
    // Also try assembling from first + last name (check all common key patterns)
    if (!coBorrowerName) {
      const firstKeys = [
        "co_borrower1.first_name", "coborrower.first_name", "co_borrower.first_name",
        "borrower1.coborrower.first_name", "borrower1.co_borrower.first_name",
      ];
      const lastKeys = [
        "co_borrower1.last_name", "coborrower.last_name", "co_borrower.last_name",
        "borrower1.coborrower.last_name", "borrower1.co_borrower.last_name",
      ];
      let first = "", last = "";
      for (const k of firstKeys) { const m = fieldValues.get(k); if (m?.rawValue && String(m.rawValue).trim()) { first = String(m.rawValue).trim(); break; } }
      for (const k of lastKeys) { const m = fieldValues.get(k); if (m?.rawValue && String(m.rawValue).trim()) { last = String(m.rawValue).trim(); break; } }
      if (first || last) coBorrowerName = [first, last].filter(Boolean).join(" ");
    }
    // Fallback: scan all field values for any co-borrower name-like fields
    if (!coBorrowerName) {
      for (const [key, val] of fieldValues.entries()) {
        const lk = key.toLowerCase();
        if ((lk.includes("coborrower") || lk.includes("co_borrower")) && 
            (lk.endsWith(".first_name") || lk.endsWith(".full_name") || lk.endsWith(".name")) &&
            val.rawValue != null && String(val.rawValue).trim() !== "") {
          coBorrowerName = String(val.rawValue).trim();
          // If it's first_name, try to find matching last_name
          if (lk.endsWith(".first_name")) {
            const lastKey = key.replace(/\.first_name$/, ".last_name");
            const lastVal = fieldValues.get(lastKey);
            if (lastVal?.rawValue && String(lastVal.rawValue).trim()) {
              coBorrowerName += " " + String(lastVal.rawValue).trim();
            }
          }
          break;
        }
      }
    }

    let coBorrowerSection = "";
    let coBorrowerAddress = "";
    if (coBorrowerName) {
      // Resolve co-borrower address from common keys
      const addrKeys = [
        "borrower.co_borrower_address", "coborrower.address", "co_borrower.address",
        "co_borrower1.address", "coborrower.full_address",
        "borrower1.coborrower.address", "borrower1.co_borrower.address",
      ];
      for (const ak of addrKeys) {
        const m = fieldValues.get(ak);
        if (m?.rawValue && String(m.rawValue).trim()) { coBorrowerAddress = String(m.rawValue).trim(); break; }
      }
      // Fallback: assemble from component address fields (coborrower.primary_address.*)
      if (!coBorrowerAddress) {
        const coPrefixes = ["coborrower", "co_borrower", "co_borrower1", "borrower1.coborrower", "borrower1.co_borrower", "borrower2.coborrower", "borrower2.co_borrower"];
        for (const cp of coPrefixes) {
          const street = fieldValues.get(`${cp}.primary_address.street`)?.rawValue;
          const city = fieldValues.get(`${cp}.primary_address.city`)?.rawValue;
          const state = fieldValues.get(`${cp}.primary_address.state`)?.rawValue;
          const zip = fieldValues.get(`${cp}.primary_address.zip`)?.rawValue;
          const parts = [street, city, state, zip].filter(Boolean).map(String);
          if (parts.length > 0) {
            coBorrowerAddress = parts.join(", ");
            break;
          }
        }
      }
      // Fallback: scan for any co-borrower address/full_address field
      if (!coBorrowerAddress) {
        for (const [key, val] of fieldValues.entries()) {
          const lk = key.toLowerCase();
          if ((lk.includes("coborrower") || lk.includes("co_borrower")) && 
              (lk.endsWith(".address") || lk.endsWith(".full_address")) &&
              val.rawValue != null && String(val.rawValue).trim() !== "") {
            coBorrowerAddress = String(val.rawValue).trim();
            break;
          }
        }
      }

      coBorrowerSection = `☐ Co-Borrower Included\n\nCo-Borrower Name: ${coBorrowerName}`;
      if (coBorrowerAddress) {
        coBorrowerSection += `\nCo-Borrower Address: ${coBorrowerAddress}`;
      }
    }
    fieldValues.set("co_borrower_section", { rawValue: coBorrowerSection, dataType: "text" });
    fieldValues.set("CoBorrower.Section", { rawValue: coBorrowerSection, dataType: "text" });
    // Also set the co-borrower name and address as individual merge tag values for direct tag usage
    if (coBorrowerName) {
      fieldValues.set("borrower.co_borrower_name", { rawValue: coBorrowerName, dataType: "text" });
      fieldValues.set("coborrower.name", { rawValue: coBorrowerName, dataType: "text" });
      fieldValues.set("co_borrower.name", { rawValue: coBorrowerName, dataType: "text" });
    }
    if (coBorrowerAddress) {
      fieldValues.set("borrower.co_borrower_address", { rawValue: coBorrowerAddress, dataType: "text" });
      fieldValues.set("coborrower.address", { rawValue: coBorrowerAddress, dataType: "text" });
      fieldValues.set("co_borrower.address", { rawValue: coBorrowerAddress, dataType: "text" });
    }
    debugLog(`[generate-document] Auto-computed co_borrower_section = "${coBorrowerSection ? "populated" : "empty"}", name = "${coBorrowerName || "none"}", address = "${coBorrowerAddress || "none"}"`);

    // ── Lien field bridging: map lien1.* / lien.* dot-notation to pr_li_* keys ──
    {
      const lienFieldToPrLi: Record<string, string> = {
        "property": "pr_li_lienProper",
        "priority": "pr_li_lienPriori",
        "holder": "pr_li_lienHolder",
        "account": "pr_li_lienAccoun",
        "contact": "pr_li_lienContac",
        "phone": "pr_li_lienPhone",
        "original_balance": "pr_li_lienOriginBalanc",
        "current_balance": "pr_li_lienCurrenBalanc",
        "regular_payment": "pr_li_lienRegulaPaymen",
        "last_checked": "pr_li_lienLastChecke",
        "recording_number": "pr_li_lienAccoun2",
        "balance_after": "pr_li_lienCurrenBalanc2",
        "last_verified": "pr_li_lienLastChecke2",
        "senior_lien_tracking": "pr_li_seniorLienTracki",
        "note": "pr_li_lienHolder2",
        "status": "pr_li_lienHolder3",
      };

      // Also bridge to property1.lien_* canonical keys
      const lienFieldToCanonical: Record<string, string> = {
        "property": "property1.lien_property",
        "priority": "property1.lien_priority",
        "holder": "property1.lien_holder",
        "account": "property1.lien_account",
        "contact": "property1.lien_contact",
        "phone": "property1.lien_phone",
        "original_balance": "property1.lien_original_balance",
        "current_balance": "property1.lien_current_balance",
        "regular_payment": "property1.lien_regular_payment",
        "last_checked": "property1.lien_last_checked",
      };

      // Bridge to new Liens section li_gd_*, li_bp_*, li_rt_* keys
      const lienFieldToLiKeys: Record<string, string> = {
        "interest_rate": "li_gd_interestRate",
        // NOTE: Do NOT bridge per-lien "priority" to ln_p_lienPositi — that key
        // represents THIS loan's lien position (loan_terms.lien_position).
        // Per-lien priorities are still published to pr_li_lienPriori /
        // pr_li_lienPrioriNow / pr_li_lienPrioriAfter for the lien table.
        "lien_priority_now": "li_gd_lienPriorityNow",
        "lien_priority_after": "li_gd_lienPriorityAfter",
        "maturity_date": "li_gd_maturityDate",
        "email": "li_gd_email",
        "fax": "li_gd_fax",
        "loan_type": "li_gd_loanType",
        "this_loan": "li_gd_thisLoan",
        "recording_date": "li_rt_recordingDate",
        "existing_paydown_amount": "li_bp_existingPaydownAmount",
        "existing_payoff_amount": "li_bp_existingPayoffAmount",
        "existing_remain": "li_lt_existingRemain",
        "anticipated": "li_lt_anticipated",
        "anticipated_amount": "li_lt_anticipatedAmount",
        "existing_paydown": "li_lt_existingPaydown",
        "existing_payoff": "li_lt_existingPayoff",
        "existing_paydown_amount": "li_lt_existingPaydownAmount",
        "existing_payoff_amount": "li_lt_existingPayoffAmount",
        "new_remaining_balance": "li_gd_newRemainingBalance",
        "newRemainingBalance": "li_gd_newRemainingBalance",
      };

      // Additional lien bridging: pr_li_* and li_bp_* variants for template tags
      const lienFieldToAltKeys: Record<string, string> = {
        "lien_priority_now": "pr_li_lienPrioriNow",
        "lien_priority_after": "pr_li_lienPrioriAfter",
        "balance_after": "li_bp_balanceAfter",
      };

      // Reverse map: property1.lien_* canonical keys -> pr_li_* short keys
      const canonicalToPrLi: Record<string, string> = {};
      for (const [field, canonKey] of Object.entries(lienFieldToCanonical)) {
        const prLiKey = lienFieldToPrLi[field];
        if (prLiKey) {
          canonicalToPrLi[canonKey] = prLiKey;
        }
      }

      // ── Multi-lien aggregation: collect indexed lien values per field ──
      // Group values by (field, lienIndex) so we can aggregate multi-lien data
      // into newline-separated strings for template fields that sit inside table cells.
      const lienFieldCollector: Record<string, { index: number; value: string }[]> = {};

      for (const [key, val] of [...fieldValues.entries()]) {
        // Match lien1.holder, lien2.holder, lien.holder etc.
        const lienMatch = key.match(/^lien(\d*)\.(.+)$/);
        if (lienMatch && val.rawValue) {
          const lienIndex = lienMatch[1] ? parseInt(lienMatch[1], 10) : 0;
          const field = lienMatch[2];

          // Collect values for multi-lien aggregation
          if (!lienFieldCollector[field]) lienFieldCollector[field] = [];
          lienFieldCollector[field].push({ index: lienIndex, value: String(val.rawValue) });

          // Still bridge canonical and li_* keys for single-lien compatibility
          const canonKey = lienFieldToCanonical[field];
          if (canonKey && !fieldValues.has(canonKey)) {
            fieldValues.set(canonKey, val);
          }
          const liKey = lienFieldToLiKeys[field];
          if (liKey && !fieldValues.has(liKey)) {
            fieldValues.set(liKey, val);
          }
        }

        // Match property1.lien_holder, property.lien_holder etc.
        const propLienMatch = key.match(/^property\d*\.lien_(.+)$/);
        if (propLienMatch && val.rawValue) {
          const mapped = canonicalToPrLi[key];
          if (mapped && !fieldValues.has(mapped)) {
            fieldValues.set(mapped, val);
            debugLog(`[generate-document] Bridged ${key} -> ${mapped}`);
          }
        }
      }

      // Now set pr_li_*, li_*, and alt keys: if multiple liens exist, join values with newlines
      // so each lien's data appears on its own line within the table cell.
      for (const [field, entries] of Object.entries(lienFieldCollector)) {
        // Sort by lien index for consistent ordering
        entries.sort((a, b) => a.index - b.index);
        // Dedupe: legacy `lien.X` (index 0) is a mirror of the first indexed
        // lien (`lien1.X`) — emitting both would duplicate the value (e.g.
        // "2nd\n2nd" for pr_li_lienPrioriNow). Drop the index-0 entry whenever
        // any indexed lien (>=1) is present, regardless of value match.
        const hasIndexed = entries.some(e => e.index >= 1);
        const dedupedEntries = hasIndexed ? entries.filter(e => e.index >= 1) : entries;
        const isCurrencyField = (field === "current_balance" || field === "original_balance" ||
                          field === "regular_payment" || field === "balance_after" ||
                          field === "anticipated_amount" || field === "existing_paydown_amount" ||
                          field === "existing_payoff_amount");
        const dataType = isCurrencyField ? "currency" : "text";
        // For multi-lien currency fields, pre-format each entry so all values render
        // (downstream resolver only parseFloat's a single number, dropping the rest).
        const aggregated = isCurrencyField && dedupedEntries.length > 1
          ? dedupedEntries.map(e => formatCurrency(e.value)).join("\n")
          : dedupedEntries.map(e => e.value).join("\n");
        const setDataType = isCurrencyField && dedupedEntries.length > 1 ? "text" : dataType;

        // Set pr_li_* key with aggregated value
        const prLiKey = lienFieldToPrLi[field];
        if (prLiKey) {
          fieldValues.set(prLiKey, { rawValue: aggregated, dataType: setDataType });
          debugLog(`[generate-document] Multi-lien bridged ${field} -> ${prLiKey} (${entries.length} liens)`);
        }

        // Also publish pr_p_currentBalanc alias (template tag for Property -> Liens Current Balance)
        if (field === "current_balance") {
          fieldValues.set("pr_p_currentBalanc", { rawValue: aggregated, dataType: setDataType });
          debugLog(`[generate-document] Published pr_p_currentBalanc (${entries.length} liens)`);
        }

        // Set li_* key with aggregated value
        const liKey = lienFieldToLiKeys[field];
        if (liKey) {
          fieldValues.set(liKey, { rawValue: aggregated, dataType: setDataType });
          debugLog(`[generate-document] Multi-lien li bridged ${field} -> ${liKey} (${entries.length} liens)`);
        }

        // Set alt key (pr_li_lienPrioriNow, pr_li_lienPrioriAfter, li_bp_balanceAfter)
        const altKey = lienFieldToAltKeys[field];
        if (altKey) {
          fieldValues.set(altKey, { rawValue: aggregated, dataType: setDataType });
          debugLog(`[generate-document] Multi-lien alt bridged ${field} -> ${altKey} (${entries.length} liens)`);
        }
      }

      // RE851A override: the bare (non-indexed) Current Balance aliases must render
      // ONLY the 1st lien's current_balance value, never the aggregated newline-joined
      // multi-lien string. Per-lien table cells use _N indexed keys instead.
      {
        const cbEntries = lienFieldCollector["current_balance"];
        if (cbEntries && cbEntries.length > 0) {
          const sorted = [...cbEntries].sort((a, b) => a.index - b.index);
          const firstVal = sorted[0].value;
          const firstNum = parseFloat(String(firstVal).replace(/[^0-9.-]/g, ""));
          const rawCurrency = Number.isFinite(firstNum) ? firstNum.toFixed(2) : firstVal;
          const formatted = formatCurrency(rawCurrency);
          const aliases = [
            "pr_li_lienCurrenBalanc",
            "pr_p_currentBalanc",
            "li_p_currentBalance",
            "li_lt_currentBalance",
          ];
          for (const alias of aliases) {
            fieldValues.set(alias, { rawValue: rawCurrency, dataType: "currency" });
          }
          debugLog(`[generate-document] Forced 1st-lien-only current_balance for aliases [${aliases.join(", ")}]: ${formatted} (raw=${firstVal})`);
        }
      }

      debugLog(`[generate-document] Lien field bridging complete`);

      // ── Bridge: "Anticipated Balance (if new lien)" → li_lt_anticipatedAmount ──
      // {{li_lt_anticipatedAmount}} is the document's TOTAL "encumbrances anticipated
      // or expected to be junior to this loan". Source: Property → Liens →
      // "Anticipated Balance (if new lien)" (lienN.new_remaining_balance), restricted
      // to liens flagged as anticipated/new (lienN.anticipated == true). Falls back
      // to lienN.anticipated_amount when new_remaining_balance is missing for a lien.
      {
        // Per spec: {{li_lt_anticipatedAmount}} is bound directly to the UI's
        // "Anticipated Balance (if new lien)" field on lien1 (single source).
        // Order of precedence: lien1.new_remaining_balance → lien1.anticipated_amount
        // → lien.new_remaining_balance → lien.anticipated_amount.
        const rawAnt =
          fieldValues.get("lien1.new_remaining_balance")?.rawValue ??
          fieldValues.get("lien1.newRemainingBalance")?.rawValue ??
          fieldValues.get("lien1.anticipated_amount")?.rawValue ??
          fieldValues.get("lien1.anticipatedAmount")?.rawValue ??
          fieldValues.get("lien.new_remaining_balance")?.rawValue ??
          fieldValues.get("lien.anticipated_amount")?.rawValue;
        if (rawAnt !== undefined && rawAnt !== null && String(rawAnt).trim() !== "") {
          const cleaned = String(rawAnt).replace(/[$,\s]/g, "").trim();
          const n = parseFloat(cleaned);
          if (Number.isFinite(n)) {
            fieldValues.set("li_lt_anticipatedAmount", { rawValue: n.toFixed(2), dataType: "currency" });
            debugLog(`[generate-document] Published li_lt_anticipatedAmount = ${n.toFixed(2)} (direct from lien1 UI value)`);
          }
        }

        // ── RE885-only: row-aligned Amount Owing column publisher ──────────────
        // The RE885 template has two encumbrance tables whose rows expand from
        // the newline-joined `{{pr_li_lienHolder}}` cell. The "Amount Owing"
        // column tags ({{pr_p_currentBalanc}} for the existing/remaining table
        // and {{li_lt_anticipatedAmount}} for the anticipated table) currently
        // emit aggregated values that skip liens missing the source field, so
        // amounts shift up and misalign against the lien-holder rows.
        //
        // For RE885 ONLY, re-publish those two tags as one entry per lien
        // (in the same lien-index order used by `pr_li_lienHolder`), inserting
        // an empty line for liens that don't contribute, so each amount sits on
        // the row of its own lien holder.
        if (isTemplate885) {
          // Build a CANONICAL per-lien record covering every column the RE885
          // Section XVI lien table uses:
          //   pr_li_lienHolder       <- lien.holder
          //   pr_p_currentBalanc     <- lien.current_balance / new_remaining_balance
          //   pr_li_lienPrioriNow    <- lien.lien_priority_now
          //   li_lt_anticipatedAmount<- lien.anticipated_amount (only when anticipated=true)
          //   pr_li_lienPrioriAfter  <- lien.lien_priority_after
          //
          // The union of lien indices across ALL of these fields becomes the
          // canonical row ordering. Every column is then re-published as a
          // newline-joined string of the SAME length, inserting an empty
          // line on rows where that column has no value. This guarantees
          // each value lines up with its lienholder row and no column
          // shifts horizontally because of a missing entry.
          const perLienAll: Record<string, {
            holder?: unknown;
            cb?: unknown;
            nrb?: unknown;
            antAmt?: unknown;
            ant?: unknown;
            prioNow?: unknown;
            prioAfter?: unknown;
          }> = {};
          for (const [key, val] of fieldValues.entries()) {
            const m = key.match(/^lien(\d*)\.(.+)$/);
            if (!m) continue;
            const idx = m[1] || "0";
            const field = m[2];
            if (
              field === "holder" ||
              field === "current_balance" ||
              field === "new_remaining_balance" ||
              field === "anticipated_amount" ||
              field === "anticipated" ||
              field === "lien_priority_now" ||
              field === "lien_priority_after"
            ) {
              if (!perLienAll[idx]) perLienAll[idx] = {};
              if (field === "holder") perLienAll[idx].holder = val?.rawValue;
              else if (field === "current_balance") perLienAll[idx].cb = val?.rawValue;
              else if (field === "new_remaining_balance") perLienAll[idx].nrb = val?.rawValue;
              else if (field === "anticipated_amount") perLienAll[idx].antAmt = val?.rawValue;
              else if (field === "anticipated") perLienAll[idx].ant = val?.rawValue;
              else if (field === "lien_priority_now") perLienAll[idx].prioNow = val?.rawValue;
              else if (field === "lien_priority_after") perLienAll[idx].prioAfter = val?.rawValue;
            }
          }
          // Use the same dedupe semantics as the lien aggregator: drop index 0
          // when any indexed lien (>=1) is present.
          const allIdx = Object.keys(perLienAll);
          const hasIdx = allIdx.some((i) => i !== "0");
          const orderedIdx = (hasIdx ? allIdx.filter((i) => i !== "0") : allIdx)
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

          const fmtAmt = (v: unknown): string => {
            if (v === null || v === undefined) return "";
            const s = String(v).trim();
            if (s === "") return "";
            const n = parseFloat(s.replace(/[$,\s]/g, ""));
            if (!Number.isFinite(n) || n === 0) return "";
            return formatCurrency(s);
          };
          const fmtText = (v: unknown): string => {
            if (v === null || v === undefined) return "";
            const s = String(v).trim();
            return s;
          };
          const isTrueLocal = (v: unknown): boolean => {
            if (v === null || v === undefined) return false;
            const s = String(v).toLowerCase().trim();
            return s === "true" || s === "1" || s === "yes";
          };

          if (orderedIdx.length > 0) {
            const holderLines = orderedIdx.map((i) => fmtText(perLienAll[i]?.holder));
            const cbLines = orderedIdx.map((i) => fmtAmt(perLienAll[i]?.cb));
            const prioNowLines = orderedIdx.map((i) => fmtText(perLienAll[i]?.prioNow));
            const prioAfterLines = orderedIdx.map((i) => fmtText(perLienAll[i]?.prioAfter));
            const antLines = orderedIdx.map((i) => {
              const rec = perLienAll[i] || {};
              // Only output anticipated amount on rows whose lien is flagged
              // anticipated; otherwise blank to keep the row aligned.
              if (!isTrueLocal(rec.ant)) return "";
              return fmtAmt(rec.nrb) || fmtAmt(rec.antAmt);
            });

            fieldValues.set("pr_li_lienHolder", {
              rawValue: holderLines.join("\n"),
              dataType: "text",
            });
            fieldValues.set("pr_p_currentBalanc", {
              rawValue: cbLines.join("\n"),
              dataType: "text",
            });
            fieldValues.set("pr_li_lienPrioriNow", {
              rawValue: prioNowLines.join("\n"),
              dataType: "text",
            });
            fieldValues.set("pr_li_lienPrioriAfter", {
              rawValue: prioAfterLines.join("\n"),
              dataType: "text",
            });
            fieldValues.set("li_lt_anticipatedAmount", {
              rawValue: antLines.join("\n"),
              dataType: "text",
            });
            debugLog(
              `[generate-document] RE885 row-aligned Section XVI lien table: ${orderedIdx.length} rows; ` +
              `pr_li_lienHolder=[${holderLines.map((s) => s || "·").join("|")}] ` +
              `pr_p_currentBalanc=[${cbLines.map((s) => s || "·").join("|")}] ` +
              `pr_li_lienPrioriNow=[${prioNowLines.map((s) => s || "·").join("|")}] ` +
              `li_lt_anticipatedAmount=[${antLines.map((s) => s || "·").join("|")}] ` +
              `pr_li_lienPrioriAfter=[${prioAfterLines.map((s) => s || "·").join("|")}]`
            );
          }
        }

      }

      // ── Calculated field: pr_netPropertyValue ──
      // Net Property Value = Estimate Value − Loan Amount − Sum(Current Lien Balance) − Sum(Anticipated Lien Amount)
      // Backend-only field (not surfaced in UI), available for document mapping as {{pr_netPropertyValue}}.
      {
        const toNum = (v: unknown): number => {
          if (v === null || v === undefined || v === "") return 0;
          const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const readFirst = (...keys: string[]): unknown => {
          for (const k of keys) {
            const v = fieldValues.get(k)?.rawValue;
            if (v !== undefined && v !== null && String(v).trim() !== "") return v;
          }
          return undefined;
        };

        const estimateRaw = readFirst("pr_pd_estimateValue", "pr_p_appraiseValue", "property1.appraise_value");
        const loanAmtRaw = readFirst("ln_p_loanAmount", "loan_terms.loan_amount");

        // Group lien fields by index so we can compute current-balance and
        // anticipated-amount sums using the same sources the UI/bridge use.
        // Anticipated amount source order (per bridge at ~line 3172):
        //   new_remaining_balance → anticipated_amount
        // Anticipated amount only counts when lien is flagged anticipated=true,
        // so each lien contributes EITHER its current balance (existing) OR its
        // anticipated amount (new) — never both — preventing double-subtraction.
        const perLien: Record<string, { cb?: unknown; nrb?: unknown; antAmt?: unknown; ant?: unknown; thisLoan?: unknown }> = {};
        for (const [key, val] of fieldValues.entries()) {
          const m = key.match(/^lien(\d*)\.(.+)$/);
          if (!m) continue;
          const idx = m[1] || "0";
          const field = m[2];
          if (!perLien[idx]) perLien[idx] = {};
          if (field === "current_balance") perLien[idx].cb = val?.rawValue;
          else if (field === "new_remaining_balance" || field === "newRemainingBalance") perLien[idx].nrb = val?.rawValue;
          else if (field === "anticipated_amount" || field === "anticipatedAmount") perLien[idx].antAmt = val?.rawValue;
          else if (field === "anticipated") perLien[idx].ant = val?.rawValue;
          else if (field === "this_loan" || field === "thisLoan") perLien[idx].thisLoan = val?.rawValue;
        }
        const isTrueVal = (v: unknown): boolean => {
          if (v === null || v === undefined) return false;
          const s = String(v).toLowerCase().trim();
          return s === "true" || s === "1" || s === "yes";
        };
        // Dedupe semantics: drop synthetic index 0 when any indexed lien (>=1) exists.
        const allIdx = Object.keys(perLien);
        const hasIdx = allIdx.some((i) => i !== "0");
        const orderedIdx = hasIdx ? allIdx.filter((i) => i !== "0") : allIdx;

        let lienBalSum = 0;
        let antAmtSum = 0;
        let lienBalCount = 0;
        let antAmtCount = 0;
        for (const i of orderedIdx) {
          const rec = perLien[i] || {};
          const isThisLoan = isTrueVal(rec.thisLoan);
          // Skip "this loan" lien — its amount is already covered by ln_p_loanAmount.
          if (isThisLoan) continue;
          // Per spec: subtract BOTH current lien balance AND anticipated amount independently.
          // Formula: pr_pd_estimateValue − ln_p_loanAmount − pr_li_lienCurrenBalanc − li_lt_anticipatedAmount
          const cb = toNum(rec.cb);
          if (cb > 0) {
            lienBalSum += cb;
            lienBalCount++;
          }
          const ant = toNum(rec.nrb) || toNum(rec.antAmt);
          if (ant > 0) {
            antAmtSum += ant;
            antAmtCount++;
          }
        }

        const estimateNum = toNum(estimateRaw);
        const loanAmtNum = toNum(loanAmtRaw);
        // Net Property Value = estimate − loan − Σ(current balances) − Σ(anticipated amounts)
        const netVal = estimateNum - loanAmtNum - lienBalSum - antAmtSum;

        fieldValues.set("pr_netPropertyValue", { rawValue: netVal.toFixed(2), dataType: "currency" });

        debugLog(`[generate-document] pr_netPropertyValue calc:`);
        debugLog(`  pr_pd_estimateValue: ${estimateRaw ?? "(null)"} -> ${estimateNum}`);
        debugLog(`  ln_p_loanAmount: ${loanAmtRaw ?? "(null)"} -> ${loanAmtNum}`);
        debugLog(`  pr_li_lienCurrenBalanc (sum of ${lienBalCount} liens): ${lienBalSum}`);
        debugLog(`  li_lt_anticipatedAmount (sum of ${antAmtCount} liens): ${antAmtSum}`);
        debugLog(`  pr_netPropertyValue: ${netVal.toFixed(2)}`);
      }

      // ── Calculated field: pr_li_balanceAfterPaydown (per-lien) ──
      // Per-lien: lienN.current_balance − lienN.existing_paydown_amount.
      // Publishes:
      //   • pr_li_balanceAfterPaydown      (aggregated, newline-joined, formatted currency)
      //   • pr_li_balanceAfterPaydown_N    (per-lien indexed alias, formatted currency)
      {
        const toNum = (v: unknown): number => {
          if (v === null || v === undefined || v === "") return 0;
          const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const hasValue = (v: unknown): boolean =>
          v !== undefined && v !== null && String(v).trim() !== "";

        const perLien: Record<string, { cb?: unknown; pd?: unknown }> = {};
        for (const [key, val] of fieldValues.entries()) {
          const m = key.match(/^lien(\d*)\.(.+)$/);
          if (!m) continue;
          const idx = m[1] || "0";
          const field = m[2];
          if (field === "current_balance") {
            (perLien[idx] ||= {}).cb = val?.rawValue;
          } else if (field === "existing_paydown_amount" || field === "existingPaydownAmount") {
            (perLien[idx] ||= {}).pd = val?.rawValue;
          }
        }

        // Some RE851A deals persist the current lien balance only as the bare
        // dictionary key (for example property1::pr_li_lienCurrenBalanc), not as
        // lien1.current_balance. Seed lien #1 from that value so calculated
        // document-only fields still resolve without requiring a UI resave.
        if (Object.keys(perLien).length === 0) {
          const cbRaw = fieldValues.get("pr_li_lienCurrenBalanc")?.rawValue
            ?? fieldValues.get("pr_p_currentBalanc")?.rawValue
            ?? fieldValues.get("property1.lien_current_balance")?.rawValue;
          if (hasValue(cbRaw)) {
            const pdRaw = fieldValues.get("li_lt_existingPaydownAmount")?.rawValue
              ?? fieldValues.get("li_bp_existingPaydownAmount")?.rawValue
              ?? fieldValues.get("lien1.existing_paydown_amount")?.rawValue
              ?? fieldValues.get("lien.existing_paydown_amount")?.rawValue;
            perLien["1"] = { cb: cbRaw, pd: pdRaw };
          }
        }

        const allIdx = Object.keys(perLien);
        const hasIdx = allIdx.some((i) => i !== "0");
        const orderedIdx = (hasIdx ? allIdx.filter((i) => i !== "0") : allIdx)
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        const lines: string[] = [];
        for (const i of orderedIdx) {
          const cbRaw = perLien[i]?.cb;
          const pdRaw = perLien[i]?.pd;
          const hasCb = cbRaw !== undefined && cbRaw !== null && String(cbRaw).trim() !== "";
          if (!hasCb) {
            lines.push("");
            continue;
          }
          const result = toNum(cbRaw) - toNum(pdRaw);
          const formatted = formatCurrency(result.toFixed(2));
          lines.push(formatted);
          // Per-lien indexed alias (1-based)
          const nIdx = i === "0" ? "1" : i;
          fieldValues.set(`pr_li_balanceAfterPaydown_${nIdx}`, {
            rawValue: result.toFixed(2),
            dataType: "currency",
          });
        }

        if (orderedIdx.length > 0) {
          fieldValues.set("pr_li_balanceAfterPaydown", {
            rawValue: orderedIdx.length > 1 ? lines.join("\n") : (toNum(perLien[orderedIdx[0]]?.cb) - toNum(perLien[orderedIdx[0]]?.pd)).toFixed(2),
            dataType: orderedIdx.length > 1 ? "text" : "currency",
          });
          debugLog(`[generate-document] Published pr_li_balanceAfterPaydown for ${orderedIdx.length} lien(s)`);
        }
      }

      // ── Calculated field: pr_li_totalLienBalance (per-lien) ──
      // Per-lien: pr_li_balanceAfterPaydown_N + lienN.current_balance.
      // Publishes:
      //   • pr_li_totalLienBalance      (aggregated, newline-joined or single, formatted currency)
      //   • pr_li_totalLienBalance_N    (per-lien indexed alias, formatted currency)
      {
        const toNum = (v: unknown): number => {
          if (v === null || v === undefined || v === "") return 0;
          const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const hasValue = (v: unknown): boolean =>
          v !== undefined && v !== null && String(v).trim() !== "";

        const perLien: Record<string, { cb?: unknown; bap?: unknown }> = {};
        for (const [key, val] of fieldValues.entries()) {
          const m = key.match(/^lien(\d*)\.(.+)$/);
          if (m) {
            const idx = m[1] || "0";
            if (m[2] === "current_balance") {
              (perLien[idx] ||= {}).cb = val?.rawValue;
            }
          }
          const m2 = key.match(/^pr_li_balanceAfterPaydown_(\d+)$/);
          if (m2) {
            (perLien[m2[1]] ||= {}).bap = val?.rawValue;
          }
        }

        if (Object.keys(perLien).length === 0) {
          const cbRaw = fieldValues.get("pr_li_lienCurrenBalanc")?.rawValue
            ?? fieldValues.get("pr_p_currentBalanc")?.rawValue
            ?? fieldValues.get("property1.lien_current_balance")?.rawValue;
          const bapRaw = fieldValues.get("pr_li_balanceAfterPaydown_1")?.rawValue
            ?? fieldValues.get("pr_li_balanceAfterPaydown")?.rawValue;
          if (hasValue(cbRaw) || hasValue(bapRaw)) {
            perLien["1"] = { cb: cbRaw, bap: bapRaw };
          }
        }

        const allIdx = Object.keys(perLien);
        const hasIdx = allIdx.some((i) => i !== "0");
        const orderedIdx = (hasIdx ? allIdx.filter((i) => i !== "0") : allIdx)
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        const lines: string[] = [];
        const totals: number[] = [];
        for (const i of orderedIdx) {
          const cbRaw = perLien[i]?.cb;
          const bapRaw = perLien[i]?.bap;
          const hasAny =
            (cbRaw !== undefined && cbRaw !== null && String(cbRaw).trim() !== "") ||
            (bapRaw !== undefined && bapRaw !== null && String(bapRaw).trim() !== "");
          if (!hasAny) {
            lines.push("");
            totals.push(0);
            continue;
          }
          const result = toNum(bapRaw) + toNum(cbRaw);
          totals.push(result);
          const formatted = formatCurrency(result.toFixed(2));
          lines.push(formatted);
          const nIdx = i === "0" ? "1" : i;
          fieldValues.set(`pr_li_totalLienBalance_${nIdx}`, {
            rawValue: result.toFixed(2),
            dataType: "currency",
          });
        }

        if (orderedIdx.length > 0) {
          fieldValues.set("pr_li_totalLienBalance", {
            rawValue: orderedIdx.length > 1 ? lines.join("\n") : totals[0].toFixed(2),
            dataType: orderedIdx.length > 1 ? "text" : "currency",
          });
          debugLog(`[generate-document] Published pr_li_totalLienBalance for ${orderedIdx.length} lien(s)`);
        }
      }

      // ── Calculated field: pr_li_totalLienPlusLoan ──
      // pr_li_totalLienBalance + ln_p_loanAmount (single scalar).
      {
        const toNum = (v: unknown): number => {
          if (v === null || v === undefined || v === "") return 0;
          const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const sumCurrencyLines = (v: unknown): number => {
          if (typeof v === "string" && v.includes("\n")) {
            return v.split("\n").reduce((sum, part) => sum + toNum(part), 0);
          }
          return toNum(v);
        };
        const tlb = fieldValues.get("pr_li_totalLienBalance")?.rawValue;
        const loan = fieldValues.get("ln_p_loanAmount")?.rawValue
          ?? fieldValues.get("loan_terms.loan_amount")?.rawValue;
        const hasAny =
          (tlb !== undefined && tlb !== null && String(tlb).trim() !== "") ||
          (loan !== undefined && loan !== null && String(loan).trim() !== "");
        if (hasAny) {
          const result = sumCurrencyLines(tlb) + toNum(loan);
          fieldValues.set("pr_li_totalLienPlusLoan", {
            rawValue: result.toFixed(2),
            dataType: "currency",
          });
          debugLog(`[generate-document] Published pr_li_totalLienPlusLoan = ${result.toFixed(2)}`);

          // ── Calculated field: pr_li_totalLienLoanToValue ──
          // (pr_li_totalLienPlusLoan / pr_pd_estimateValue) expressed as a percentage.
          const estimate = toNum(
            fieldValues.get("pr_pd_estimateValue")?.rawValue
              ?? fieldValues.get("pr_p_appraiseValue")?.rawValue
              ?? fieldValues.get("property1.appraise_value")?.rawValue
          );
          if (estimate > 0) {
            const ltv = (result / estimate) * 100;
            fieldValues.set("pr_li_totalLienLoanToValue", {
              rawValue: `${ltv.toFixed(2)}%`,
              dataType: "percentage",
            });
            debugLog(`[generate-document] Published pr_li_totalLienLoanToValue = ${ltv.toFixed(2)}% (${result}/${estimate})`);
          } else {
            debugLog(`[generate-document] Skipped pr_li_totalLienLoanToValue: estimate=${estimate}`);
          }
        }
      }

      // ── RE851D Delinquency mapping: publish pr_li_*_N aliases per lien index
      // AND per-property index (aggregated when multiple liens belong to one property).
      // Source UI fields live on each lienK.* record; template uses _N expansion.
      {
        // Collect liens in insertion order (lien1, lien2, ...)
        const lienPrefixes = new Set<string>();
        for (const key of fieldValues.keys()) {
          const m = key.match(/^(lien\d+)\./);
          if (m) lienPrefixes.add(m[1]);
        }
        const orderedLiens = [...lienPrefixes].sort((a, b) =>
          parseInt(a.replace("lien", ""), 10) - parseInt(b.replace("lien", ""), 10)
        );

        // Per-property aggregation buckets (keyed by propertyN index)
        const perProp: Record<number, {
          paidByLoan: boolean;
          delinq60: boolean;
          howMany: number;
          currentDelinq: boolean;
          remainUnpaid: boolean;
          source: string[];
          hasLien: boolean;
          allPaidOff: boolean;
          anyPaidOff: boolean;
          sourceInfoFirst: string;
          sourceInfoFirstLienIdx: number | null;
          sourceOfInfoText: string;
          sourceOfInfoPriorityFound: boolean;
        }> = {};

        const truthy = (v: unknown) => {
          const s = String(v ?? "").trim().toLowerCase();
          return s === "true" || s === "yes" || s === "1" || s === "on";
        };

        // Helper: read a field accepting multiple key conventions stored by the UI
        // (snake_case, camelCase) so both LienDetailForm and LienModal saves resolve.
        const getLienVal = (prefix: string, ...suffixes: string[]): string => {
          for (const sfx of suffixes) {
            const v = fieldValues.get(`${prefix}.${sfx}`)?.rawValue;
            if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
          }
          return "";
        };

        const parseMoney = (s: string): number => {
          const n = parseFloat(String(s ?? "").replace(/[$,\s]/g, ""));
          return Number.isFinite(n) ? n : NaN;
        };

        orderedLiens.forEach((prefix, i) => {
          const lienIdx = i + 1;
          const paidByLoanRaw = getLienVal(prefix, "paid_by_loan", "paidByLoan");
          const paidByLoan = truthy(paidByLoanRaw);
          const howManyRaw = getLienVal(prefix, "delinquencies_how_many", "delinquenciesHowMany").trim();
          const howManyNum = parseInt(howManyRaw, 10);
          // Spec: Q2 strictly = (delinquencies_how_many > 0)
          const has60 = Number.isFinite(howManyNum) && howManyNum > 0;
          // Spec: Q4 = "Do any of these payments remain unpaid?" — TRUE when any
          // remaining-balance-style field on the lien is > 0. The visible UI label
          // "Remaining Balance" persists to existing_payoff_amount; "Anticipated
          // Balance (if new lien)" persists to new_remaining_balance; "If
          // Delinquent" amount persists to currently_delinquent_amount. Honor all
          // three so user-entered data wins regardless of which field they used.
          const remBalRaw = getLienVal(
            prefix,
            "existing_payoff_amount", "existingPayoffAmount",
            "new_remaining_balance", "newRemainingBalance",
            "remaining_balance",
            "currently_delinquent_amount", "currentlyDelinquentAmount",
          );
          const remBalNum = parseMoney(remBalRaw);
          // RE851A "Currently Delinquent" YES/NO is driven by the explicit UI
          // checkbox (lien.currently_delinquent) — NOT by remaining balance.
          // The balance-derived flag is preserved as `remainUnpaid` for the
          // RE851D "Do any of these payments remain unpaid?" safety pass.
          const remainUnpaid = Number.isFinite(remBalNum) && remBalNum > 0;
          const currentDelinq = truthy(
            getLienVal(prefix, "currently_delinquent", "currentlyDelinquent"),
          );
          // Spec: Q1 = paid_off (slt_paid_off checkbox)
          const paidOff = truthy(getLienVal(prefix, "slt_paid_off", "sltPaidOff"));
          const source = getLienVal(prefix, "source_of_payment", "sourceOfPayment").trim();
          debugLog(`[generate-document] RE851D lien delinquency src ${prefix}: paidByLoan="${paidByLoanRaw}" howMany="${howManyRaw}" remBal="${remBalRaw}" paidOff=${paidOff} has60=${has60} uiCurrentlyDelinquent=${currentDelinq} remainUnpaid=${remainUnpaid} source="${source}" (Q1 uses anyPaidOff per property)`);

          // Per-lien-index aliases
          const setBool = (k: string, v: boolean) =>
            fieldValues.set(k, { rawValue: v ? "true" : "", dataType: "boolean" });
          const setText = (k: string, v: string, dt = "text") =>
            fieldValues.set(k, { rawValue: v, dataType: dt });

          setBool(`pr_li_delinquencyPaidByLoan_${lienIdx}`, paidByLoan);
          setBool(`pr_li_delinquencyPaidByLoan_${lienIdx}_yes`, paidByLoan);
          setBool(`pr_li_delinquencyPaidByLoan_${lienIdx}_no`, !paidByLoan);
          setText(`pr_li_delinquencyPaidByLoan_${lienIdx}_yes_glyph`, paidByLoan ? "☑" : "☐");
          setText(`pr_li_delinquencyPaidByLoan_${lienIdx}_no_glyph`, paidByLoan ? "☐" : "☑");
          setBool(`pr_li_delinqu60day_${lienIdx}`, has60);
          setBool(`pr_li_delinqu60day_${lienIdx}_yes`, has60);
          setBool(`pr_li_delinqu60day_${lienIdx}_no`, !has60);
          setText(`pr_li_delinqu60day_${lienIdx}_yes_glyph`, has60 ? "☑" : "☐");
          setText(`pr_li_delinqu60day_${lienIdx}_no_glyph`, has60 ? "☐" : "☑");
          setBool(`pr_li_currentDelinqu_${lienIdx}`, currentDelinq);
          // Yes/No + glyph aliases (always published so unchecked → ☐ YES / ☑ NO)
          setBool(`pr_li_currentDelinqu_${lienIdx}_yes`, currentDelinq);
          setBool(`pr_li_currentDelinqu_${lienIdx}_no`, !currentDelinq);
          setText(`pr_li_currentDelinqu_${lienIdx}_yes_glyph`, currentDelinq ? "☑" : "☐");
          setText(`pr_li_currentDelinqu_${lienIdx}_no_glyph`, currentDelinq ? "☐" : "☑");
          // Balance-derived "remain unpaid" alias (used by RE851D safety pass
          // for "Do any of these payments remain unpaid?" — semantics preserved).
          setBool(`pr_li_remainUnpaid_${lienIdx}`, remainUnpaid);
          setBool(`pr_li_remainUnpaid_${lienIdx}_yes`, remainUnpaid);
          setBool(`pr_li_remainUnpaid_${lienIdx}_no`, !remainUnpaid);
          setText(`pr_li_remainUnpaid_${lienIdx}_yes_glyph`, remainUnpaid ? "☑" : "☐");
          setText(`pr_li_remainUnpaid_${lienIdx}_no_glyph`, remainUnpaid ? "☐" : "☑");
          setText(`pr_li_delinquHowMany_${lienIdx}`,
            Number.isFinite(howManyNum) && howManyNum > 0 ? String(howManyNum) : (howManyRaw || ""),
            "number");
          setText(`pr_li_sourceOfPayment_${lienIdx}`, source);

          // ── Source of Information checkboxes (Broker / Borrower / Other) ──
          const sourceInfoRaw = getLienVal(prefix, "source_of_information", "sourceOfInformation").trim();
          const siLower = sourceInfoRaw.toLowerCase();
          const isBroker = siLower === "broker";
          const isBorrower = siLower === "borrower";
          const isOther = sourceInfoRaw !== "" && !isBroker && !isBorrower;
          setBool(`pr_li_sourceInfoBroker_${lienIdx}`, isBroker);
          setText(`pr_li_sourceInfoBroker_${lienIdx}_glyph`, isBroker ? "☑" : "☐");
          setBool(`pr_li_sourceInfoBorrower_${lienIdx}`, isBorrower);
          setText(`pr_li_sourceInfoBorrower_${lienIdx}_glyph`, isBorrower ? "☑" : "☐");
          setBool(`pr_li_sourceInfoOther_${lienIdx}`, isOther);
          setText(`pr_li_sourceInfoOther_${lienIdx}_glyph`, isOther ? "☑" : "☐");
          setText(`pr_li_sourceInfoOtherText_${lienIdx}`, isOther ? sourceInfoRaw : "");

          // Aggregate into the property the lien belongs to
          const propRaw = String(fieldValues.get(`${prefix}.property`)?.rawValue ?? "").trim();
          const pm = propRaw.match(/^property(\d+)$/);
          if (pm) {
            const pIdx = parseInt(pm[1], 10);
            if (!perProp[pIdx]) {
              perProp[pIdx] = { paidByLoan: false, delinq60: false, howMany: 0, currentDelinq: false, remainUnpaid: false, source: [], hasLien: false, allPaidOff: true, anyPaidOff: false, sourceInfoFirst: "", sourceInfoFirstLienIdx: null, sourceOfInfoText: "", sourceOfInfoPriorityFound: false };
            }
            const b = perProp[pIdx];
            b.hasLien = true;
            if (!paidOff) b.allPaidOff = false;
            if (paidOff) b.anyPaidOff = true;
            if (paidByLoan) b.paidByLoan = true;
            if (has60) b.delinq60 = true;
            if (currentDelinq) b.currentDelinq = true;
            if (remainUnpaid) b.remainUnpaid = true;
            if (Number.isFinite(howManyNum) && howManyNum > 0) b.howMany += howManyNum;
            if (source) b.source.push(source);
            if (b.sourceInfoFirstLienIdx === null) {
              b.sourceInfoFirst = sourceInfoRaw;
              b.sourceInfoFirstLienIdx = lienIdx;
            }
            // Source of Information text alias selection: prefer lien with
            // lien_priority_after === "1st"; else first non-empty value.
            const priorityAfter = getLienVal(prefix, "lien_priority_after", "lienPriorityAfter").trim().toLowerCase();
            if (!b.sourceOfInfoPriorityFound) {
              if (priorityAfter === "1st") {
                b.sourceOfInfoText = sourceInfoRaw;
                b.sourceOfInfoPriorityFound = true;
              } else if (!b.sourceOfInfoText && sourceInfoRaw) {
                b.sourceOfInfoText = sourceInfoRaw;
              }
            }
          }
        });

        // Publish per-property aliases (matches RE851D _N = property index pattern)
        for (const [pIdxStr, b] of Object.entries(perProp)) {
          const pIdx = parseInt(pIdxStr, 10);
          const setBoolP = (k: string, v: boolean) => {
            if (!fieldValues.has(k)) fieldValues.set(k, { rawValue: v ? "true" : "", dataType: "boolean" });
            else fieldValues.set(k, { rawValue: v ? "true" : "", dataType: "boolean" });
          };
          const setTextP = (k: string, v: string, dt = "text") => {
            fieldValues.set(k, { rawValue: v, dataType: dt });
          };
          setBoolP(`pr_li_delinquencyPaidByLoan_${pIdx}`, b.paidByLoan);
          fieldValues.set(`pr_li_delinquencyPaidByLoan_${pIdx}_yes`, { rawValue: b.paidByLoan ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_li_delinquencyPaidByLoan_${pIdx}_no`, { rawValue: b.paidByLoan ? "false" : "true", dataType: "boolean" });
          fieldValues.set(`pr_li_delinquencyPaidByLoan_${pIdx}_yes_glyph`, { rawValue: b.paidByLoan ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_li_delinquencyPaidByLoan_${pIdx}_no_glyph`, { rawValue: b.paidByLoan ? "☐" : "☑", dataType: "text" });
          setBoolP(`pr_li_delinqu60day_${pIdx}`, b.delinq60);
          fieldValues.set(`pr_li_delinqu60day_${pIdx}_yes`, { rawValue: b.delinq60 ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_li_delinqu60day_${pIdx}_no`, { rawValue: b.delinq60 ? "false" : "true", dataType: "boolean" });
          fieldValues.set(`pr_li_delinqu60day_${pIdx}_yes_glyph`, { rawValue: b.delinq60 ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_li_delinqu60day_${pIdx}_no_glyph`, { rawValue: b.delinq60 ? "☐" : "☑", dataType: "text" });
          setBoolP(`pr_li_currentDelinqu_${pIdx}`, b.currentDelinq);
          // Yes/No + glyph aliases per-property index
          fieldValues.set(`pr_li_currentDelinqu_${pIdx}_yes`, { rawValue: b.currentDelinq ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_li_currentDelinqu_${pIdx}_no`, { rawValue: b.currentDelinq ? "false" : "true", dataType: "boolean" });
          fieldValues.set(`pr_li_currentDelinqu_${pIdx}_yes_glyph`, { rawValue: b.currentDelinq ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_li_currentDelinqu_${pIdx}_no_glyph`, { rawValue: b.currentDelinq ? "☐" : "☑", dataType: "text" });
          // Per-property balance-derived "remain unpaid" alias (RE851D safety pass).
          setBoolP(`pr_li_remainUnpaid_${pIdx}`, b.remainUnpaid);
          fieldValues.set(`pr_li_remainUnpaid_${pIdx}_yes`, { rawValue: b.remainUnpaid ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_li_remainUnpaid_${pIdx}_no`, { rawValue: b.remainUnpaid ? "false" : "true", dataType: "boolean" });
          fieldValues.set(`pr_li_remainUnpaid_${pIdx}_yes_glyph`, { rawValue: b.remainUnpaid ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_li_remainUnpaid_${pIdx}_no_glyph`, { rawValue: b.remainUnpaid ? "☐" : "☑", dataType: "text" });
          setTextP(`pr_li_delinquHowMany_${pIdx}`, b.howMany > 0 ? String(b.howMany) : "", "number");
          setTextP(`pr_li_sourceOfPayment_${pIdx}`, b.source.join("\n"));
          // Q1: Encumbrances of record? — YES iff the property has at least one
          // lien flagged Paid Off (slt_paid_off). Per spec: any paid-off lien → YES.
          const encOfRecord = b.hasLien && b.anyPaidOff;
          fieldValues.set(`pr_li_encumbranceOfRecord_${pIdx}`,           { rawValue: encOfRecord ? "true" : "", dataType: "boolean" });
          fieldValues.set(`pr_li_encumbranceOfRecord_${pIdx}_yes`,       { rawValue: encOfRecord ? "true" : "false", dataType: "boolean" });
          fieldValues.set(`pr_li_encumbranceOfRecord_${pIdx}_no`,        { rawValue: encOfRecord ? "false" : "true", dataType: "boolean" });
          fieldValues.set(`pr_li_encumbranceOfRecord_${pIdx}_yes_glyph`, { rawValue: encOfRecord ? "☑" : "☐", dataType: "text" });
          fieldValues.set(`pr_li_encumbranceOfRecord_${pIdx}_no_glyph`,  { rawValue: encOfRecord ? "☐" : "☑", dataType: "text" });
          // Also fill pr_p_delinquHowMany_N if the property-tax block didn't set it
          const pPropKey = `pr_p_delinquHowMany_${pIdx}`;
          const existing = fieldValues.get(pPropKey)?.rawValue;
          if ((existing === undefined || String(existing).trim() === "") && b.howMany > 0) {
            fieldValues.set(pPropKey, { rawValue: String(b.howMany), dataType: "number" });
          }

          // ── pr_p_* per-property compatibility aliases ──
          // Some RE851D template variants use the older property-questionnaire
          // tag family (pr_p_*) instead of the newer pr_li_* family. Mirror the
          // same per-property values to those tags so existing templates render
          // without any template edits. Strict: only sets aliases, never reads.
          const mirrorPP = (base: string, val: boolean) => {
            fieldValues.set(`pr_p_${base}_${pIdx}`,           { rawValue: val ? "true" : "", dataType: "boolean" });
            fieldValues.set(`pr_p_${base}_${pIdx}_yes`,       { rawValue: val ? "true" : "false", dataType: "boolean" });
            fieldValues.set(`pr_p_${base}_${pIdx}_no`,        { rawValue: val ? "false" : "true", dataType: "boolean" });
            fieldValues.set(`pr_p_${base}_${pIdx}_yes_glyph`, { rawValue: val ? "☑" : "☐", dataType: "text" });
            fieldValues.set(`pr_p_${base}_${pIdx}_no_glyph`,  { rawValue: val ? "☐" : "☑", dataType: "text" });
          };
          mirrorPP("encumbranceOfRecord", encOfRecord);
          mirrorPP("delinqu60day", b.delinq60);
          mirrorPP("currentDelinqu", b.currentDelinq);
          mirrorPP("paidByLoan", b.paidByLoan);
          fieldValues.set(`pr_p_sourceOfPaymen_${pIdx}`, { rawValue: b.source.join("\n"), dataType: "text" });
          fieldValues.set(`pr_p_sourceOfPayment_${pIdx}`, { rawValue: b.source.join("\n"), dataType: "text" });

          // ── Per-property Source of Information checkboxes (Broker / Borrower / Other) ──
          {
            const siRaw = (b.sourceInfoFirst || "").trim();
            const siLower = siRaw.toLowerCase();
            const isBroker = siLower === "broker";
            const isBorrower = siLower === "borrower";
            const isOther = siRaw !== "" && !isBroker && !isBorrower;
            fieldValues.set(`pr_li_sourceInfoBroker_${pIdx}`, { rawValue: isBroker ? "true" : "", dataType: "boolean" });
            fieldValues.set(`pr_li_sourceInfoBroker_${pIdx}_glyph`, { rawValue: isBroker ? "☑" : "☐", dataType: "text" });
            fieldValues.set(`pr_li_sourceInfoBorrower_${pIdx}`, { rawValue: isBorrower ? "true" : "", dataType: "boolean" });
            fieldValues.set(`pr_li_sourceInfoBorrower_${pIdx}_glyph`, { rawValue: isBorrower ? "☑" : "☐", dataType: "text" });
            fieldValues.set(`pr_li_sourceInfoOther_${pIdx}`, { rawValue: isOther ? "true" : "", dataType: "boolean" });
            fieldValues.set(`pr_li_sourceInfoOther_${pIdx}_glyph`, { rawValue: isOther ? "☑" : "☐", dataType: "text" });
            fieldValues.set(`pr_li_sourceInfoOtherText_${pIdx}`, { rawValue: isOther ? siRaw : "", dataType: "text" });
            // Plain text alias for "SOURCE OF INFORMATION" label (per spec):
            // Prefer lien priority_after === "1st"; else first non-empty value.
            fieldValues.set(`pr_li_sourceOfInformation_${pIdx}`, { rawValue: b.sourceOfInfoText || "", dataType: "text" });
          }

          if (pIdx === 1) {
            // Bare aliases for templates referencing keys without _N
            fieldValues.set("pr_li_delinquencyPaidByLoan", { rawValue: b.paidByLoan ? "true" : "", dataType: "boolean" });
            fieldValues.set("pr_li_delinquencyPaidByLoan_yes", { rawValue: b.paidByLoan ? "true" : "false", dataType: "boolean" });
            fieldValues.set("pr_li_delinquencyPaidByLoan_no", { rawValue: b.paidByLoan ? "false" : "true", dataType: "boolean" });
            fieldValues.set("pr_li_delinquencyPaidByLoan_yes_glyph", { rawValue: b.paidByLoan ? "☑" : "☐", dataType: "text" });
            fieldValues.set("pr_li_delinquencyPaidByLoan_no_glyph", { rawValue: b.paidByLoan ? "☐" : "☑", dataType: "text" });
            fieldValues.set("pr_li_delinqu60day", { rawValue: b.delinq60 ? "true" : "", dataType: "boolean" });
            fieldValues.set("pr_li_delinqu60day_yes", { rawValue: b.delinq60 ? "true" : "false", dataType: "boolean" });
            fieldValues.set("pr_li_delinqu60day_no", { rawValue: b.delinq60 ? "false" : "true", dataType: "boolean" });
            fieldValues.set("pr_li_delinqu60day_yes_glyph", { rawValue: b.delinq60 ? "☑" : "☐", dataType: "text" });
            fieldValues.set("pr_li_delinqu60day_no_glyph", { rawValue: b.delinq60 ? "☐" : "☑", dataType: "text" });
            fieldValues.set("pr_li_currentDelinqu", { rawValue: b.currentDelinq ? "true" : "", dataType: "boolean" });
            fieldValues.set("pr_li_currentDelinqu_yes", { rawValue: b.currentDelinq ? "true" : "false", dataType: "boolean" });
            fieldValues.set("pr_li_currentDelinqu_no", { rawValue: b.currentDelinq ? "false" : "true", dataType: "boolean" });
            fieldValues.set("pr_li_currentDelinqu_yes_glyph", { rawValue: b.currentDelinq ? "☑" : "☐", dataType: "text" });
            fieldValues.set("pr_li_currentDelinqu_no_glyph", { rawValue: b.currentDelinq ? "☐" : "☑", dataType: "text" });
            fieldValues.set("pr_li_delinquHowMany", { rawValue: b.howMany > 0 ? String(b.howMany) : "", dataType: "number" });
            fieldValues.set("pr_li_sourceOfPayment", { rawValue: b.source.join("\n"), dataType: "text" });
          }
        }
        debugLog(`[generate-document] RE851D lien delinquency mapping published for ${orderedLiens.length} liens / ${Object.keys(perProp).length} properties`);

        // Bare alias fallback: ensure pr_li_sourceOfPayment is always published when
        // any lien has source_of_payment set, regardless of property assignment.
        // (The per-property publisher above only sets the bare key when pIdx===1,
        // which requires lien.property === "property1". Liens with no property
        // assignment, or first-lien tied to property2+, would otherwise leave the
        // bare tag blank.)
        {
          const cur = String(fieldValues.get("pr_li_sourceOfPayment")?.rawValue ?? "").trim();
          if (!cur) {
            const allSources: string[] = [];
            orderedLiens.forEach((prefix) => {
              const s = getLienVal(prefix, "source_of_payment", "sourceOfPayment").trim();
              if (s) allSources.push(s);
            });
            if (allSources.length > 0) {
              const joined = allSources.join("\n");
              fieldValues.set("pr_li_sourceOfPayment", { rawValue: joined, dataType: "text" });
              if (!fieldValues.get("pr_p_sourceOfPaymen")?.rawValue) {
                fieldValues.set("pr_p_sourceOfPaymen", { rawValue: joined, dataType: "text" });
              }
              if (!fieldValues.get("pr_p_sourceOfPayment")?.rawValue) {
                fieldValues.set("pr_p_sourceOfPayment", { rawValue: joined, dataType: "text" });
              }
              debugLog(`[generate-document] Bare pr_li_sourceOfPayment fallback published: "${joined}"`);
            }
          }
        }

        // ── RE851D Encumbrance Remaining / Anticipated per-property + per-slot mapping ──
        // Each property has two sections: REMAINING (anticipated !== 'true') and
        // ANTICIPATED (anticipated === 'true'). Within each section, lien rows are
        // emitted per-slot (_S = 1..n in lien insertion order within that property).
        // Tag conventions: pr_li_rem_<field>_<N>_<S>  and  pr_li_ant_<field>_<N>_<S>
        // For backward compat we also emit unsuffixed _N (slot 1) and bare key for N=1,S=1.
        {
          const truthy2 = (v: unknown) => {
            const s = String(v ?? "").trim().toLowerCase();
            return s === "true" || s === "yes" || s === "y" || s === "1" || s === "on";
          };
          const normLblLocal = (v: unknown) =>
            String(v ?? "").toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
          // RE851D detail-row classification:
          //   anticipated -> ANT bucket (Expected column, original_balance)
          //   all other populated lien rows -> REM bucket (Remaining column)
          // Priority: explicit `condition` dropdown wins; then explicit
          // existing_* booleans win over a (potentially stale) anticipated=true
          // flag, since the UI saves all four condition flags whenever the user
          // changes the dropdown and a stale `anticipated=true` can otherwise
          // mis-route an existing-remain/paydown lien into the Expected column.
          const hasAmt = (raw: unknown) => {
            const n = parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
            return Number.isFinite(n) && n !== 0;
          };
          const hasDisplayRowData = (lp: string) => {
            const get = (sfx: string) => fieldValues.get(`${lp}.${sfx}`)?.rawValue;
            return [
              "lien_priority_now", "priority", "remaining_new_lien_priority", "lien_priority_after",
              "holder", "lienHolder", "beneficiary", "original_balance", "originalBalance",
              "current_balance", "currentBalance", "regular_payment", "regularPayment",
              "maturity_date", "matDate", "balloon", "balloon_amount", "balloonAmount",
            ].some((sfx) => String(get(sfx) ?? "").trim() !== "");
          };
          const classifyLocal = (lp: string): "anticipated" | "remain" | "paydown" | "payoff" | "none" => {
            const get = (sfx: string) => fieldValues.get(`${lp}.${sfx}`)?.rawValue;
            const lbl = normLblLocal(get("condition"));
            if (lbl === "existing - payoff" || lbl === "payoff") return "remain";
            if (lbl === "anticipated") return "anticipated";
            if (lbl === "will remain" || lbl === "existing - remain" || lbl === "remain") return "remain";
            if (lbl === "remain - paydown" || lbl === "existing - paydown" || lbl === "paydown") return "paydown";
            // Boolean aliases (UI persistence path). Existing-* flags win over
            // anticipated boolean to defeat stale data.
            if (truthy2(get("existing_payoff")) || truthy2(get("existingPayoff"))) return "remain";
            if (truthy2(get("existing_paydown")) || truthy2(get("existingPaydown"))) return "paydown";
            if (truthy2(get("existing_remain")) || truthy2(get("existingRemain"))) return "remain";
            if (truthy2(get("anticipated"))) {
              // Trust anticipated only when it is the dominant signal: original_balance
              // (or anticipated_amount) populated, OR no remain/paydown amounts present.
              const hasOrig = hasAmt(get("original_balance")) || hasAmt(get("originalBalance")) || hasAmt(get("anticipated_amount")) || hasAmt(get("anticipatedAmount"));
              const hasRemain = hasAmt(get("current_balance")) || hasAmt(get("currentBalance")) || hasAmt(get("existing_paydown_amount")) || hasAmt(get("existingPaydownAmount"));
              if (hasOrig) return "anticipated";
              if (hasRemain) return "remain"; // stale anticipated; recover via remain bucket
              return "anticipated";
            }
            const antLbl = normLblLocal(get("anticipated"));
            if (antLbl === "anticipated" || antLbl === "this loan" || antLbl === "other") return "anticipated";
            if ((antLbl === "false" || antLbl === "no" || antLbl === "0" || antLbl === "") && hasDisplayRowData(lp)) return "remain";
            return "none";
          };

          // Group liens by property index, preserving insertion order, split by Condition.
          type LienRow = { prefix: string };
          const perPropRem: Record<number, LienRow[]> = {};
          const perPropAnt: Record<number, LienRow[]> = {};

          orderedLiens.forEach((prefix) => {
            const propRaw = String(fieldValues.get(`${prefix}.property`)?.rawValue ?? "").trim();
            const pm = propRaw.match(/^property(\d+)$/);
            if (!pm) return;
            const pIdx = parseInt(pm[1], 10);
            const cond = classifyLocal(prefix);
            // Rows with no usable data are excluded; payoff rows render in REM.
            if (cond === "payoff" || cond === "none") {
              debugLog(`[generate-document] RE851D Part1 slot-bucket: ${prefix} prop=${pIdx} cond=${cond} → EXCLUDED`);
              return;
            }
            const bucket = cond === "anticipated" ? perPropAnt : perPropRem;
            if (!bucket[pIdx]) bucket[pIdx] = [];
            bucket[pIdx].push({ prefix });
            debugLog(`[generate-document] RE851D Part1 slot-bucket: ${prefix} prop=${pIdx} cond=${cond} → ${cond === "anticipated" ? "ANT" : "REM"}`);
          });

          const setVal = (k: string, v: string, dt: string) =>
            fieldValues.set(k, { rawValue: v, dataType: dt });
          const setBoolV = (k: string, v: boolean) =>
            fieldValues.set(k, { rawValue: v ? "true" : "", dataType: "boolean" });

          const publishSection = (
            tagPrefix: "pr_li_rem" | "pr_li_ant",
            buckets: Record<number, LienRow[]>,
          ) => {
            for (const [pIdxStr, rows] of Object.entries(buckets)) {
              const pIdx = parseInt(pIdxStr, 10);
              rows.forEach((row, sIdx0) => {
                const s = sIdx0 + 1;
                const lp = row.prefix;
                const get = (f: string) => String(fieldValues.get(`${lp}.${f}`)?.rawValue ?? "").trim();
                const firstNonEmpty = (...sfx: string[]) => {
                  for (const s of sfx) {
                    const v = get(s);
                    if (v) return v;
                  }
                  return "";
                };
                const balloon = get("balloon").toLowerCase();
                const isYes = balloon === "true" || balloon === "yes";
                const isNo = balloon === "false" || balloon === "no";
                const isUnknown = !isYes && !isNo;

                // Amount Owing source rule (RE851D questionnaire XVI table):
                //   Other Liens (REM) → current_balance (fall back to
                //     existing_payoff_amount/existing_paydown_amount/original).
                //   Liens that will remain or are anticipated (ANT) →
                //     new_remaining_balance, then anticipated_amount, then
                //     original_balance.
                const amountOwingVal = tagPrefix === "pr_li_ant"
                  ? firstNonEmpty(
                      "new_remaining_balance", "newRemainingBalance",
                      "anticipated_amount", "anticipatedAmount",
                      "original_balance", "originalBalance",
                      "current_balance", "currentBalance",
                    )
                  : firstNonEmpty(
                      "current_balance", "currentBalance",
                      "existing_payoff_amount", "existingPayoffAmount",
                      "existing_paydown_amount", "existingPaydownAmount",
                      "original_balance", "originalBalance",
                    );

                const fields: Array<[string, string, string]> = [
                  ["priority", firstNonEmpty("lien_priority_now", "priority", "remaining_new_lien_priority", "lien_priority_after", "n"), "text"],
                  ["interestRate", firstNonEmpty("interest_rate", "intRate"), "percent"],
                  ["beneficiary", firstNonEmpty("holder", "lienHolder", "beneficiary"), "text"],
                  // Both REMAINING and EXPECTED sections of the RE851D template
                  // include columns for ORIGINAL AMOUNT and APPROXIMATE PRINCIPAL
                  // BALANCE, so publish both regardless of bucket. Empty values
                  // simply leave the cell blank.
                  ["originalAmount", firstNonEmpty("original_balance", "originalBalance"), "currency"],
                  ["principalBalance", firstNonEmpty("current_balance", "currentBalance"), "currency"],
                  ["monthlyPayment", firstNonEmpty("regular_payment", "regularPayment"), "currency"],
                  ["maturityDate", firstNonEmpty("maturity_date", "matDate"), "date"],
                  // Balloon Amount only renders when Balloon Payment = YES.
                  // When NO/Unknown, suppress the value so the template cell
                  // stays blank instead of leaking the raw tag/placeholder.
                  ["balloonAmount", isYes ? firstNonEmpty("balloon_amount", "balloonAmount") : "", "currency"],
                  // RE851D questionnaire XVI "Amount Owing" column (per-row).
                  ["amountOwing", amountOwingVal, "currency"],
                ];

                const fieldAliases: Record<string, string[]> = {
                  interestRate: ["interest_rate", "intRate"],
                  beneficiary: ["lienHolder", "holder"],
                  maturityDate: ["maturity_date", "matDate"],
                  // Template author-friendly variants for Amount Owing.
                  amountOwing: ["amount_owing", "amount", "owing"],
                };
                for (const [f, v, dt] of fields) {
                  const names = [f, ...(fieldAliases[f] ?? [])];
                  for (const name of names) {
                    setVal(`${tagPrefix}_${name}_${pIdx}_${s}`, v, dt);
                    if (s === 1) setVal(`${tagPrefix}_${name}_${pIdx}`, v, dt);
                    if (pIdx === 1 && s === 1) setVal(`${tagPrefix}_${name}`, v, dt);
                  }
                }

                debugLog(`[generate-document] RE851D enc row ${tagPrefix} P${pIdx} S${s}: priority="${fields[0][1]}" beneficiary="${fields[2][1]}" interestRate="${fields[1][1]}" maturityDate="${fields[6][1]}"`);

                setBoolV(`${tagPrefix}_balloonYes_${pIdx}_${s}`, isYes);
                setBoolV(`${tagPrefix}_balloonNo_${pIdx}_${s}`, isNo);
                setBoolV(`${tagPrefix}_balloonUnknown_${pIdx}_${s}`, isUnknown);
                if (s === 1) {
                  setBoolV(`${tagPrefix}_balloonYes_${pIdx}`, isYes);
                  setBoolV(`${tagPrefix}_balloonNo_${pIdx}`, isNo);
                  setBoolV(`${tagPrefix}_balloonUnknown_${pIdx}`, isUnknown);
                }
                if (pIdx === 1 && s === 1) {
                  setBoolV(`${tagPrefix}_balloonYes`, isYes);
                  setBoolV(`${tagPrefix}_balloonNo`, isNo);
                  setBoolV(`${tagPrefix}_balloonUnknown`, isUnknown);
                }
              });
            }
          };

          publishSection("pr_li_rem", perPropRem);
          publishSection("pr_li_ant", perPropAnt);

          const remCollectionLog = Object.entries(perPropRem)
            .map(([pIdx, rows]) => `P${pIdx}=${rows.length}`)
            .join(", ") || "none";
          const remResolvedSamples: string[] = [];
          for (const [pIdx, rows] of Object.entries(perPropRem)) {
            rows.slice(0, 2).forEach((_row, sIdx0) => {
              const s = sIdx0 + 1;
              const sampleKeys = ["priority", "interestRate", "beneficiary", "balloonYes", "balloonNo", "balloonUnknown"];
              remResolvedSamples.push(
                `P${pIdx}S${s}{${sampleKeys.map((name) => `${name}=${String(fieldValues.get(`pr_li_rem_${name}_${pIdx}_${s}`)?.rawValue ?? "").slice(0, 40)}`).join(",")}}`
              );
            });
          }
          console.log(`[generate-document] RE851D Remaining Encumbrance data before render: collections=${remCollectionLog}; resolved=[${remResolvedSamples.slice(0, 8).join(" | ")}]`);
          debugLog(`[generate-document] RE851D encumbrance mapping: rem props=${Object.keys(perPropRem).length}, ant props=${Object.keys(perPropAnt).length}`);

          // ── RE851D Additional Encumbrances Attachment YES/NO ──
          // Per-property: if (remaining liens > 2) OR (anticipated liens > 2),
          // force the "Additional remaining, expected, or anticipated encumbrances
          // are set forth in an attachment to this statement." YES checkbox and
          // signal the addendum builder to append overflow liens (3rd+) at the
          // end of the document. Otherwise force NO. Single source of truth via
          // pr_li_additionalEncumbrance_<N> aliases (mirrors existing _yes/_no/
          // _glyph pattern used by other RE851D questionnaire booleans).
          {
            const allPropIdx = new Set<number>([
              ...Object.keys(perPropRem).map(s => parseInt(s, 10)),
              ...Object.keys(perPropAnt).map(s => parseInt(s, 10)),
            ]);
            // Also include every property index already discovered elsewhere so
            // properties with 0 liens still publish a NO answer.
            for (const k of fieldValues.keys()) {
              const m = k.match(/^property(\d+)\./i);
              if (m) allPropIdx.add(parseInt(m[1], 10));
            }
            for (const pIdx of allPropIdx) {
              const remN = perPropRem[pIdx]?.length ?? 0;
              const antN = perPropAnt[pIdx]?.length ?? 0;
              const isYes = remN > 2 || antN > 2;
              const set = (k: string, v: string, dt: string) =>
                fieldValues.set(k, { rawValue: v, dataType: dt });
              set(`pr_li_additionalEncumbrance_${pIdx}`,           isYes ? "true" : "", "boolean");
              set(`pr_li_additionalEncumbrance_${pIdx}_yes`,       isYes ? "true" : "false", "boolean");
              set(`pr_li_additionalEncumbrance_${pIdx}_no`,        isYes ? "false" : "true", "boolean");
              set(`pr_li_additionalEncumbrance_${pIdx}_yes_glyph`, isYes ? "☑" : "☐", "text");
              set(`pr_li_additionalEncumbrance_${pIdx}_no_glyph`,  isYes ? "☐" : "☑", "text");
              // pr_p_* mirror for older template variants
              set(`pr_p_additionalEncumbrance_${pIdx}`,           isYes ? "true" : "", "boolean");
              set(`pr_p_additionalEncumbrance_${pIdx}_yes`,       isYes ? "true" : "false", "boolean");
              set(`pr_p_additionalEncumbrance_${pIdx}_no`,        isYes ? "false" : "true", "boolean");
              set(`pr_p_additionalEncumbrance_${pIdx}_yes_glyph`, isYes ? "☑" : "☐", "text");
              set(`pr_p_additionalEncumbrance_${pIdx}_no_glyph`,  isYes ? "☐" : "☑", "text");
              debugLog(`[generate-document] RE851D additional-encumbrance PROP#${pIdx}: rem=${remN} ant=${antN} → ${isYes ? "YES" : "NO"}`);
            }

            // ── Global (non-indexed) Additional Encumbrances aliases ──
            // Aggregate across all properties: if ANY property exceeds 2 remaining
            // OR 2 anticipated liens, OR the totals across all properties exceed
            // 2 in either bucket, force the global YES checkbox. Otherwise NO.
            // Tags: {{pr_li_additionalEncumbranceYes}} / {{pr_li_additionalEncumbranceNo}}
            // (plus _glyph variants and pr_p_* mirrors for legacy templates).
            let totalRem = 0;
            let totalAnt = 0;
            let anyPropOver = false;
            for (const pIdx of allPropIdx) {
              const remN = perPropRem[pIdx]?.length ?? 0;
              const antN = perPropAnt[pIdx]?.length ?? 0;
              totalRem += remN;
              totalAnt += antN;
              if (remN > 2 || antN > 2) anyPropOver = true;
            }
            const globalYes = anyPropOver || totalRem > 2 || totalAnt > 2;
            const setG = (k: string, v: string, dt: string) =>
              fieldValues.set(k, { rawValue: v, dataType: dt });
            setG("pr_li_additionalEncumbranceYes",        globalYes ? "true"  : "false", "boolean");
            setG("pr_li_additionalEncumbranceNo",         globalYes ? "false" : "true",  "boolean");
            setG("pr_li_additionalEncumbranceYes_glyph",  globalYes ? "☑"     : "☐",     "text");
            setG("pr_li_additionalEncumbranceNo_glyph",   globalYes ? "☐"     : "☑",     "text");
            setG("pr_li_additionalEncumbrance_yes",       globalYes ? "true"  : "false", "boolean");
            setG("pr_li_additionalEncumbrance_no",        globalYes ? "false" : "true",  "boolean");
            setG("pr_li_additionalEncumbrance_yes_glyph", globalYes ? "☑"     : "☐",     "text");
            setG("pr_li_additionalEncumbrance_no_glyph",  globalYes ? "☐"     : "☑",     "text");
            // pr_p_* mirrors (legacy template variants)
            setG("pr_p_additionalEncumbranceYes",         globalYes ? "true"  : "false", "boolean");
            setG("pr_p_additionalEncumbranceNo",          globalYes ? "false" : "true",  "boolean");
            setG("pr_p_additionalEncumbranceYes_glyph",   globalYes ? "☑"     : "☐",     "text");
            setG("pr_p_additionalEncumbranceNo_glyph",    globalYes ? "☐"     : "☑",     "text");
            debugLog(`[generate-document] RE851D additional-encumbrance GLOBAL: totalRem=${totalRem} totalAnt=${totalAnt} anyPropOver=${anyPropOver} → ${globalYes ? "YES" : "NO"}`);
          }
        }

        // ── RE851D Part 1 / Part 2 senior-encumbrance rollup (authoritative late pass) ──
        // Runs after every lien bridge so all lienN.* keys are present in fieldValues.
        // Per spec (RE851D Condition mapping):
        //   • Anticipated                      → Expected  = SUM(original_balance)
        //   • Will Remain / Existing - Remain  → Remaining = SUM(current_balance)
        //   • Remain - Paydown                 → Remaining = SUM(current_balance)
        //   • Existing - Payoff                → excluded entirely
        // Strict per-property match (lienK.property === propertyN). No cross-bleed.
        // Every property index that appears in CSR gets 0.00 published when no
        // qualifying lien exists, so the template never renders blank.
        if (/851d/i.test(template.name || "")) {
          const truthy3 = (v: unknown) => {
            const s = String(v ?? "").trim().toLowerCase();
            return s === "true" || s === "yes" || s === "y" || s === "1" || s === "on";
          };
          const normLbl = (v: unknown) =>
            String(v ?? "").toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
          const parseAmt2 = (v: unknown) => {
            const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
            return Number.isFinite(n) ? n : 0;
          };
          // Resolve canonical Condition bucket for one lien prefix.
          // Priority: condition dropdown label > explicit existing_* booleans
          // > anticipated boolean > anticipated label. Existing-* booleans win
          // over a stale anticipated=true so the per-property rollup matches
          // the per-slot publisher above. Payoff hard-wins to enforce exclude.
          const hasAmt2 = (raw: unknown) => {
            const n = parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
            return Number.isFinite(n) && n !== 0;
          };
          const classify = (lp: string): "anticipated" | "remain" | "paydown" | "payoff" | "none" => {
            const get = (sfx: string) => fieldValues.get(`${lp}.${sfx}`)?.rawValue;
            const lbl = normLbl(get("condition"));
            if (lbl === "existing - payoff" || lbl === "payoff") return "payoff";
            if (lbl === "anticipated") return "anticipated";
            if (lbl === "will remain" || lbl === "existing - remain" || lbl === "remain") return "remain";
            if (lbl === "remain - paydown" || lbl === "existing - paydown" || lbl === "paydown") return "paydown";
            if (truthy3(get("existing_payoff")) || truthy3(get("existingPayoff"))) return "payoff";
            if (truthy3(get("existing_paydown")) || truthy3(get("existingPaydown"))) return "paydown";
            if (truthy3(get("existing_remain")) || truthy3(get("existingRemain"))) return "remain";
            if (truthy3(get("anticipated"))) {
              const hasOrig = hasAmt2(get("original_balance")) || hasAmt2(get("originalBalance")) || hasAmt2(get("anticipated_amount")) || hasAmt2(get("anticipatedAmount"));
              const hasRemain = hasAmt2(get("current_balance")) || hasAmt2(get("currentBalance")) || hasAmt2(get("existing_paydown_amount")) || hasAmt2(get("existingPaydownAmount"));
              if (hasOrig) return "anticipated";
              if (hasRemain) return "remain";
              return "anticipated";
            }
            const antLbl = normLbl(get("anticipated"));
            if (antLbl === "anticipated" || antLbl === "this loan" || antLbl === "other") return "anticipated";
            return "none";
          };

          // Discover all lien indices and all property indices.
          const lienIdxSet = new Set<number>();
          for (const [k] of fieldValues.entries()) {
            const m = k.match(/^lien(\d+)\./);
            if (m) lienIdxSet.add(parseInt(m[1], 10));
          }
          const propIdxSet = new Set<number>();
          for (const [k] of fieldValues.entries()) {
            const m = k.match(/^property(\d+)\./i);
            if (m) propIdxSet.add(parseInt(m[1], 10));
          }
          if (propIdxSet.size === 0) propIdxSet.add(1);

          // Build address → property index map for address-keyed lien.property values.
          const normAddrA = (s: unknown) =>
            String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
          const addrToProp = new Map<string, number>();
          for (const pi of propIdxSet) {
            const a = normAddrA(fieldValues.get(`property${pi}.address`)?.rawValue);
            if (a) addrToProp.set(a, pi);
          }

          // Initialize per-property accumulators for every CSR-known property.
          const remByProp = new Map<number, number>();
          const expByProp = new Map<number, number>();
          const matchedLog: Record<number, string[]> = {};
          for (const pi of propIdxSet) {
            remByProp.set(pi, 0);
            expByProp.set(pi, 0);
            matchedLog[pi] = [];
          }

          // Walk each lien strictly once, route to its property by exact match.
          for (const li of [...lienIdxSet].sort((a, b) => a - b)) {
            const lp = `lien${li}`;
            const propRaw = String(fieldValues.get(`${lp}.property`)?.rawValue ?? "").trim();
            if (!propRaw) continue;
            // Resolve target property index. Accept "property1"/"Property 1" or address.
            let pIdx: number | null = null;
            const pm = propRaw.toLowerCase().replace(/\s+/g, "").match(/^property(\d+)$/);
            if (pm) {
              const cand = parseInt(pm[1], 10);
              if (propIdxSet.has(cand)) pIdx = cand;
            }
            if (pIdx === null) {
              const cand = addrToProp.get(normAddrA(propRaw));
              if (cand !== undefined) pIdx = cand;
            }
            if (pIdx === null) continue; // no cross-bleed

            // Per spec: always exclude liens flagged as "This Loan" before any
            // condition-based aggregation, regardless of condition value.
            const thisLoanRaw =
              fieldValues.get(`${lp}.this_loan`)?.rawValue ??
              fieldValues.get(`${lp}.thisLoan`)?.rawValue;
            if (truthy3(thisLoanRaw)) {
              matchedLog[pIdx].push(`${li}:thisLoan-skip`);
              continue;
            }

            const cond = classify(lp);
            const dbgOrig = fieldValues.get(`${lp}.original_balance`)?.rawValue ?? "";
            const dbgCur = fieldValues.get(`${lp}.current_balance`)?.rawValue ?? "";
            const dbgAnt = fieldValues.get(`${lp}.anticipated`)?.rawValue ?? "";
            const dbgER = fieldValues.get(`${lp}.existing_remain`)?.rawValue ?? "";
            const dbgEPd = fieldValues.get(`${lp}.existing_paydown`)?.rawValue ?? "";
            const dbgEPo = fieldValues.get(`${lp}.existing_payoff`)?.rawValue ?? "";
            debugLog(`[generate-document] RE851D rollup-classify ${lp} → prop=${pIdx} cond=${cond} | anticipated=${dbgAnt} remain=${dbgER} paydown=${dbgEPd} payoff=${dbgEPo} orig=${dbgOrig} cur=${dbgCur}`);
            if (cond === "payoff" || cond === "none") {
              matchedLog[pIdx].push(`${li}:${cond}`);
              continue;
            }
            if (cond === "anticipated") {
              // Per spec: Anticipated uses "Anticipated Balance (if new lien)"
              // which the UI persists as new_remaining_balance, falling back to
              // anticipated_amount when missing.
              const antRaw =
                fieldValues.get(`${lp}.new_remaining_balance`)?.rawValue ??
                fieldValues.get(`${lp}.newRemainingBalance`)?.rawValue ??
                fieldValues.get(`${lp}.anticipated_amount`)?.rawValue ??
                fieldValues.get(`${lp}.anticipatedAmount`)?.rawValue;
              const amt = parseAmt2(antRaw);
              expByProp.set(pIdx, (expByProp.get(pIdx) || 0) + amt);
              matchedLog[pIdx].push(`${li}:ant=${amt}`);
            } else {
              // remain or paydown → current_balance
              const amt = parseAmt2(fieldValues.get(`${lp}.current_balance`)?.rawValue);
              remByProp.set(pIdx, (remByProp.get(pIdx) || 0) + amt);
              matchedLog[pIdx].push(`${li}:${cond}=${amt}`);
            }
          }

          // Loan amount for the +loan derivation (per-property "Total + Loan").
          const loanAmtRollup = parseAmt2(
            fieldValues.get("ln_p_loanAmount")?.rawValue ??
            fieldValues.get("loan_terms.loan_amount")?.rawValue ?? ""
          );

          // Publish authoritative values; always emit 0.00 for known property rows.
          for (const pi of propIdxSet) {
            const rem = remByProp.get(pi) || 0;
            const exp = expByProp.get(pi) || 0;
            const tot = rem + exp;
            const remVal = { rawValue: rem.toFixed(2), dataType: "currency" as const };
            const expVal = { rawValue: exp.toFixed(2), dataType: "currency" as const };
            const totVal = { rawValue: tot.toFixed(2), dataType: "currency" as const };
            // Primary RE851D Part 1 / Part 2 keys.
            fieldValues.set(`ln_p_remainingEncumbrance_${pi}`, remVal);
            fieldValues.set(`ln_p_expectedEncumbrance_${pi}`, expVal);
            fieldValues.set(`ln_p_totalEncumbrance_${pi}`, totVal);
            // Compatibility aliases used by older RE851D template variants.
            fieldValues.set(`pr_p_remainingSenior_${pi}`, remVal);
            fieldValues.set(`pr_p_expectedSenior_${pi}`, expVal);
            fieldValues.set(`pr_p_totalEncumbrance_${pi}`, totVal);
            fieldValues.set(`pr_p_totalSenior_${pi}`, totVal);
            if (Number.isFinite(loanAmtRollup)) {
              const totPlusLoan = (tot + loanAmtRollup).toFixed(2);
              fieldValues.set(`pr_p_totalSeniorPlusLoan_${pi}`, { rawValue: totPlusLoan, dataType: "currency" });
              fieldValues.set(`ln_p_totalWithLoan_${pi}`, { rawValue: totPlusLoan, dataType: "currency" });
            }
            // Per-property zero-fill for slot-1 aliases so blank cells render
            // "0.00" when no qualifying lien exists for the column. Only set
            // when the per-slot publisher above did NOT already write a value.
            const remSlot1 = `pr_li_rem_principalBalance_${pi}_1`;
            if (!fieldValues.has(remSlot1)) {
              fieldValues.set(remSlot1, { rawValue: "0.00", dataType: "currency" });
              fieldValues.set(`pr_li_rem_principalBalance_${pi}`, { rawValue: "0.00", dataType: "currency" });
            }
            const antSlot1 = `pr_li_ant_originalAmount_${pi}_1`;
            if (!fieldValues.has(antSlot1)) {
              fieldValues.set(antSlot1, { rawValue: "0.00", dataType: "currency" });
              fieldValues.set(`pr_li_ant_originalAmount_${pi}`, { rawValue: "0.00", dataType: "currency" });
            }
            // Additional Part-1 column aliases some template variants use.
            fieldValues.set(`pr_p_remainingEncumbrance_${pi}`, remVal);
            fieldValues.set(`pr_p_expectedEncumbrance_${pi}`, expVal);
            // Amount of Equity Securing the Loan: sourced strictly from the
            // property's pledgedEquity field. Always emit so {{ln_p_amountOfEquity_N}}
            // renders "0.00" instead of leaving the cell blank.
            // Market Value lookup (used for both Amount of Equity calc and LTV).
            const mvRaw =
              fieldValues.get(`pr_p_appraiseValue_${pi}`)?.rawValue ??
              fieldValues.get(`property${pi}.appraise_value`)?.rawValue ??
              fieldValues.get(`property${pi}.appraised_value`)?.rawValue;
            const hasMv = mvRaw !== null && mvRaw !== undefined && String(mvRaw).trim() !== "";
            const mv = hasMv ? parseAmt2(mvRaw) : 0;

            // {{ln_p_amountOfEquity_N}} — CALCULATED: Market Value − Total Senior
            // Encumbrances, clamped to 0 when negative. Always emit so the cell
            // never renders blank.
            let amountOfEquityStr = "0.00";
            if (hasMv) {
              amountOfEquityStr = Math.max(0, mv - tot).toFixed(2);
            }
            fieldValues.set(`ln_p_amountOfEquity_${pi}`, { rawValue: amountOfEquityStr, dataType: "currency" });

            // {{ln_p_equitySecuringLoan_N}} — DIRECT pledged equity from
            // Property → Valuation. No calculation.
            const pledgedRaw =
              fieldValues.get(`pr_p_pledgedEquity_${pi}`)?.rawValue ??
              fieldValues.get(`property${pi}.pledged_equity`)?.rawValue ??
              fieldValues.get(`property${pi}.pledgedEquity`)?.rawValue;
            let pledgedEquityStr = "0.00";
            if (pledgedRaw !== null && pledgedRaw !== undefined && String(pledgedRaw).trim() !== "") {
              pledgedEquityStr = parseAmt2(pledgedRaw).toFixed(2);
            }
            fieldValues.set(`ln_p_equitySecuringLoan_${pi}`, { rawValue: pledgedEquityStr, dataType: "currency" });

            // Per spec PART 1: LTV = (Total Senior Encumbrances / Market Value) × 100.
            // Overrides the loanAmount/MV LTV written by the per-property bridge.
            let ltvStr = "";
            if (hasMv) {
              ltvStr = mv > 0 ? ((tot / mv) * 100).toFixed(2) : "0.00";
              fieldValues.set(`ln_p_loanToValueRatio_${pi}`, { rawValue: ltvStr, dataType: "percentage" });
            }
            debugLog(
              `[generate-document] RE851D Part1 rollup property${pi}: liens=[${matchedLog[pi].join(",")}], ` +
              `remaining=${rem.toFixed(2)}, expected=${exp.toFixed(2)}, total=${tot.toFixed(2)}, ` +
              `mv=${mvRaw ?? "∅"}, amountOfEquity=${amountOfEquityStr}, pledgedEquity=${pledgedEquityStr}, ltv=${ltvStr || "∅"}`
            );
          }

          // ── RE851D Part 1 totals (dynamic across all properties) ──
          // {{ln_totalEquitySecuringLoan}} = SUM of per-property pledgedEquity.
          // {{ln_totalLoanAmountSecured}} = the loan amount.
          {
            let totalEquity = 0;
            for (const pi of propIdxSet) {
              const v = fieldValues.get(`ln_p_equitySecuringLoan_${pi}`)?.rawValue
                     ?? fieldValues.get(`ln_p_amountOfEquity_${pi}`)?.rawValue;
              if (v !== undefined && v !== null && String(v).trim() !== "") {
                totalEquity += parseAmt2(v);
              }
            }
            fieldValues.set("ln_totalEquitySecuringLoan", {
              rawValue: totalEquity.toFixed(2),
              dataType: "currency",
            });
            const loanAmtTotal = Number.isFinite(loanAmtRollup) ? loanAmtRollup : 0;
            fieldValues.set("ln_totalLoanAmountSecured", {
              rawValue: loanAmtTotal.toFixed(2),
              dataType: "currency",
            });
            debugLog(
              `[generate-document] RE851D Part1 totals: properties=${propIdxSet.size}, ` +
              `totalEquity=${totalEquity.toFixed(2)}, totalLoanSecured=${loanAmtTotal.toFixed(2)}`
            );
          }

          // ── RE851D final encumbrance state log (post late-pass) ──
          // Proves to logs exactly what processDocx will see for the
          // lien-derived encumbrance keys after the authoritative rollup ran.
          {
            const fmt = (k: string) => {
              const v = fieldValues.get(k);
              if (!v) return "∅";
              const raw = v.rawValue;
              if (raw === "" || raw === null || raw === undefined) return "''";
              return String(raw);
            };
            const expL = [1, 2, 3, 4, 5].map(i => `${i}:${fmt(`ln_p_expectedEncumbrance_${i}`)}`).join(", ");
            const remL = [1, 2, 3, 4, 5].map(i => `${i}:${fmt(`ln_p_remainingEncumbrance_${i}`)}`).join(", ");
            const totL = [1, 2, 3, 4, 5].map(i => `${i}:${fmt(`ln_p_totalEncumbrance_${i}`)}`).join(", ");
            debugLog(`[generate-document] RE851D final encumbrance state: expected=[${expL}], remaining=[${remL}], total=[${totL}]`);
          }
        }
      }

      // Bridge ln_p_lienPosit (template tag) -> ln_p_lienPositi (actual field key)
      const lienPosVal = fieldValues.get("ln_p_lienPositi");
      if (lienPosVal && !fieldValues.has("ln_p_lienPosit")) {
        fieldValues.set("ln_p_lienPosit", lienPosVal);
        debugLog(`[generate-document] Bridged ln_p_lienPositi -> ln_p_lienPosit`);
      }

      // ── Auto-compute li_bp_balanceAfter as SUM of balance_after for all liens
      // with lien_priority_now < current loan's lien position ──
      {
        // Get current loan's lien position from loan_terms.lien_position or ln_p_lienPositi
        const lienPosRaw = fieldValues.get("ln_p_lienPositi")?.rawValue
          || fieldValues.get("loan_terms.lien_position")?.rawValue
          || "";
        // Parse priority: extract leading digits from values like "1st", "2nd", "3"
        const parsePriority = (val: string): number => {
          if (!val) return NaN;
          const cleaned = String(val).trim().toLowerCase();
          const numMatch = cleaned.match(/^(\d+)/);
          return numMatch ? parseInt(numMatch[1], 10) : NaN;
        };
        const currentPriority = parsePriority(String(lienPosRaw));
        debugLog(`[generate-document] Senior lien calc: currentLoanPriority = ${currentPriority} (raw: "${lienPosRaw}")`);

        if (!isNaN(currentPriority)) {
          // Collect all lien entries with their priority and balance_after
          const lienPriorityCollector = lienFieldCollector["lien_priority_now"] || [];
          const lienBalanceCollector = lienFieldCollector["balance_after"] || [];

          // Build a map of lienIndex -> priority
          const lienPriorityMap = new Map<number, number>();
          for (const entry of lienPriorityCollector) {
            const p = parsePriority(entry.value);
            if (!isNaN(p)) lienPriorityMap.set(entry.index, p);
          }

          // Build a map of lienIndex -> balance_after (numeric)
          const lienBalanceMap = new Map<number, number>();
          for (const entry of lienBalanceCollector) {
            const num = parseFloat(String(entry.value).replace(/[,$]/g, ""));
            if (!isNaN(num)) lienBalanceMap.set(entry.index, num);
          }

          // Sum balance_after for all liens where priority < currentPriority
          let seniorLienTotal = 0;
          for (const [lienIdx, priority] of lienPriorityMap.entries()) {
            if (priority < currentPriority) {
              seniorLienTotal += lienBalanceMap.get(lienIdx) || 0;
            }
          }

          // If current loan is 1st position, total = 0
          if (currentPriority === 1) seniorLienTotal = 0;

          const formattedTotal = seniorLienTotal.toFixed(2);
          fieldValues.set("li_bp_balanceAfter", { rawValue: formattedTotal, dataType: "currency" });
          debugLog(`[generate-document] Auto-computed li_bp_balanceAfter (senior lien balance) = ${formattedTotal} from ${lienPriorityMap.size} liens`);
          debugLog(`[generate-document] li_bp_balanceAfter = ${formattedTotal} (currentPriority=${currentPriority}, liens with priority data: ${lienPriorityMap.size})`);
        } else {
          debugLog(`[generate-document] Could not determine current loan priority for li_bp_balanceAfter calculation`);
        }
      }
    }

    // ── Derive or_p_isBrokerAlsoBorrower checkbox glyphs for document generation ──
    {
      const yesVal = fieldValues.get("or_p_isBrokerAlsoBorrower_yes")
        || fieldValues.get("origination_app.doc.is_broker_also_borrower_yes");
      const rawYes = yesVal?.rawValue;
      const isYes = typeof rawYes === "string"
        ? ["true", "yes", "y", "1", "checked", "on"].includes(rawYes.trim().toLowerCase())
        : typeof rawYes === "number"
          ? rawYes !== 0
          : Boolean(rawYes);
      fieldValues.set("or_p_isBrokerAlsoBorrower_yes", { rawValue: isYes ? "true" : "false", dataType: "boolean" });
      fieldValues.set("or_p_isBrokerAlsoBorrower_no", { rawValue: isYes ? "false" : "true", dataType: "boolean" });
      debugLog(`[generate-document] or_p_isBrokerAlsoBorrower: YES=${isYes}`);
    }

    // ── Auto-compute HUD-1 column totals: Paid to Others, Paid to Broker, Grand Total ──
    // Uses dynamic scanning of ALL origination fee currency fields plus explicit key lists
    // to ensure no fee values are missed.
    {
      // Explicit currency keys for "Paid to Others" column
      const othersKeys = [
        // 800 series
        'of_801_lenderLoanOriginationFee_others', 'of_802_lenderLoanDiscountFee_others',
        'of_803_appraisalFee_others', 'of_804_creditReportFee_others',
        'of_805_lenderInspectionFee_others', 'of_808_mortgageBrokerCommissionFee_others',
        'of_809_taxServiceFee_others', 'of_810_processingFee_others',
        'of_811_underwritingFee_others', 'of_812_wireTransferFee_others',
        // 900 series
        'of_900_desc_o', 'of_901_int_o', 'of_902_mi_o', 'of_903_hi_o', 'of_904_tax_o', 'of_905_va_o',
        // 1000 series
        'of_1000_desc_o', 'of_1001_hi_o', 'of_1002_mi_o', 'of_1004_tax_o',
        // 1100 series
        'of_1101_set_o', 'of_1105_doc_o', 'of_1106_not_o', 'of_1108_ti_o',
        // 1200 series
        'of_1200_desc_o', 'of_1201_rec_o', 'of_1202_ts_o',
        // 1300 series
        'of_1302_pest_o',
      ];
      // Explicit currency keys for "Paid to Broker" column
      const brokerKeys = [
        // 800 series
        'of_801_lenderLoanOriginationFee_broker', 'of_802_lenderLoanDiscountFee_broker',
        'of_803_appraisalFee_broker', 'of_804_creditReportFee_broker',
        'of_805_lenderInspectionFee_broker', 'of_808_mortgageBrokerCommissionFee_broker',
        'of_809_taxServiceFee_broker', 'of_810_processingFee_broker',
        'of_811_underwritingFee_broker', 'of_812_wireTransferFee_broker',
        // 900 series
        'of_900_desc_b', 'of_901_int_b', 'of_902_mi_b', 'of_903_hi_b', 'of_904_tax_b', 'of_905_va_b',
        // 1000 series
        'of_1000_desc_b', 'of_1001_hi_b', 'of_1002_mi_b', 'of_1004_tax_b',
        // 1100 series
        'of_1101_set_b', 'of_1105_doc_b', 'of_1106_not_b', 'of_1108_ti_b',
        // 1200 series
        'of_1200_desc_b', 'of_1201_rec_b', 'of_1202_ts_b',
        // 1300 series
        'of_1302_pest_b',
      ];

      const parseNum = (key: string): number => {
        const val = fieldValues.get(key);
        if (!val || val.rawValue == null) return 0;
        // Skip boolean-typed fields (checkboxes) — they are not currency amounts
        if (val.dataType === 'boolean') return 0;
        const cleaned = String(val.rawValue).replace(/[,$\s]/g, '');
        const n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
      };

      // Also dynamically scan fieldValues for any origination fee currency fields
      // matching broker/others patterns that might not be in the explicit lists
      const dynamicOthersKeys = new Set<string>(othersKeys);
      const dynamicBrokerKeys = new Set<string>(brokerKeys);
      for (const [key, data] of fieldValues.entries()) {
        if (!key.startsWith('of_') || data.dataType !== 'currency') continue;
        // Skip the total fields themselves
        if (key === 'of_tot_oth' || key === 'of_tot_brk' || key === 'of_tot_all') continue;
        // Skip subtotal display fields
        if (key === 'of_fe_subtotalOthers' || key === 'of_fe_subtotalJ' || key === 'of_fe_totalJ') continue;
        // Match "others" pattern: ends with _others, _o, or Others
        if (key.endsWith('_others') || (key.endsWith('_o') && /^of_\d+_/.test(key)) || key.endsWith('Others')) {
          dynamicOthersKeys.add(key);
        }
        // Match "broker" pattern: ends with _broker, _b, or Broker
        if (key.endsWith('_broker') || (key.endsWith('_b') && /^of_\d+_/.test(key)) || key.endsWith('Broker')) {
          dynamicBrokerKeys.add(key);
        }
      }

      let totalOthers = 0;
      for (const k of dynamicOthersKeys) totalOthers += parseNum(k);
      let totalBroker = 0;
      for (const k of dynamicBrokerKeys) totalBroker += parseNum(k);
      const grandTotal = totalOthers + totalBroker;
      fieldValues.set('of_tot_oth', { rawValue: totalOthers.toFixed(2), dataType: 'currency' });
      fieldValues.set('of_tot_brk', { rawValue: totalBroker.toFixed(2), dataType: 'currency' });
      fieldValues.set('of_tot_all', { rawValue: grandTotal.toFixed(2), dataType: 'currency' });
      // Also set the display-field aliases so templates using either tag name resolve correctly
      fieldValues.set('of_fe_subtotalOthers', { rawValue: totalOthers.toFixed(2), dataType: 'currency' });
      fieldValues.set('of_fe_subtotalJ', { rawValue: totalBroker.toFixed(2), dataType: 'currency' });
      fieldValues.set('of_fe_totalJ', { rawValue: grandTotal.toFixed(2), dataType: 'currency' });
      debugLog(`[generate-document] Auto-computed HUD totals: Others=${totalOthers.toFixed(2)} (${dynamicOthersKeys.size} keys), Broker=${totalBroker.toFixed(2)} (${dynamicBrokerKeys.size} keys), Grand=${grandTotal.toFixed(2)}`);
    }

    // ── Investor Questionnaire field aliases ──
    // ld_p_firstIfEntityUse, ld_p_middle, ld_p_last are separate field_dictionary
    // entries that the Investor Questionnaire template references.
    // Populate them from the primary lender name fields if not already set.
    {
      const lenderTypeRaw = (fieldValues.get('ld_p_lenderType')?.rawValue ?? '').toString().trim();
      const isIndividual = lenderTypeRaw.toLowerCase() === 'individual';

      // Always alias the lender's name parts to first/middle/last so the name
      // prints exactly once. Add a trailing space after each non-empty part so
      // the template tags `{{first}}{{middle}}{{last}}` render as "F M L".
      const firstRaw = (fieldValues.get('ld_p_firstName')?.rawValue ?? '').toString();
      const middleRaw = (fieldValues.get('ld_p_middleName')?.rawValue ?? '').toString();
      const lastRaw = (fieldValues.get('ld_p_lastName')?.rawValue ?? '').toString();
      const withTrailingSpace = (v: string) => {
        const t = v.trim();
        return t ? `${t} ` : '';
      };
      fieldValues.set('ld_p_firstIfEntityUse', { rawValue: withTrailingSpace(firstRaw), dataType: 'text' });
      fieldValues.set('ld_p_middle', { rawValue: withTrailingSpace(middleRaw), dataType: 'text' });
      // Last name has no trailing space (end of name block).
      fieldValues.set('ld_p_last', { rawValue: lastRaw.trim(), dataType: 'text' });

      if (isIndividual) {
        // Individual → vesting must NOT appear in the document.
        fieldValues.set('ld_p_vesting', { rawValue: '', dataType: 'text' });
      } else {
        // Joint / Family Trust / LLC / Corp / IRA / ERISA / Investment Fund /
        // 401k / Foreign Holder W-8 / Non-profit → vesting prints first,
        // followed by the name parts. Append a trailing space when present so
        // it visually separates from the following first name.
        const vestingRaw = (fieldValues.get('ld_p_vesting')?.rawValue ?? '').toString().trim();
        fieldValues.set('ld_p_vesting', {
          rawValue: vestingRaw ? `${vestingRaw} ` : '',
          dataType: 'text',
        });
      }

      // Mirror the normalized vesting value into the truncated legacy alias
      // `ld_p_vestin` so templates referencing either spelling render the
      // same value (RE851D template uses `{{ld_p_vestin}}`).
      const finalVesting = (fieldValues.get('ld_p_vesting')?.rawValue ?? '').toString();
      fieldValues.set('ld_p_vestin', { rawValue: finalVesting, dataType: 'text' });
    }

    // Build set of all valid field keys once and reuse it across invocations.
    const validFieldKeys = await getValidFieldKeys(supabase);
    if (isTemplate885) {
      debugLog(`[RE885] Data Processing: ${Math.round(performance.now() - tDataProcessingStart)} ms (fieldValues=${fieldValues.size})`);
    }

    // 4. Download template DOCX from storage
    const tTemplateLoadStart = performance.now();
    let fileData: Blob | null = null;
    
    const { data: storageData, error: fileError } = await supabase.storage
      .from("templates")
      .download(template.file_path);

    if (!fileError && storageData) {
      fileData = storageData;
      debugLog(`[generate-document] Downloaded template from storage: ${template.file_path}`);
    } else {
      // Fallback: Try public URL
      debugLog(`[generate-document] Storage download failed, trying public URL fallback...`);
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
      
      const publicUrls = [
        `https://${projectRef}.supabase.co/storage/v1/object/public/templates/${template.file_path}`,
      ];
      
      for (const url of publicUrls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            fileData = await response.blob();
            debugLog(`[generate-document] Downloaded template from public URL: ${url}`);
            break;
          }
        } catch (e) {
          debugLog(`[generate-document] Failed to fetch from ${url}: ${e}`);
        }
      }
    }

    if (!fileData) {
      console.error(`[generate-document] Failed to download template: ${template.file_path}`);
      result.error = "Failed to download template file. Please upload the template to storage.";
      return result;
    }
    if (isTemplate885) {
      debugLog(`[RE885] Template Compile: ${Math.round(performance.now() - tTemplateLoadStart)} ms`);
    }

    // 5. Fetch merge tag mappings AND field key migration maps, then process the DOCX
    // fetchFieldKeyMappings populates the in-memory cache used by resolveFieldKeyWithMap
    const [{ mergeTagMap, labelMap }, _fieldKeyMappings] = await Promise.all([
      fetchMergeTagMappings(supabase),
      fetchFieldKeyMappings(supabase),
    ]);

    // RE851A Part 2 broker-capacity checkboxes are often authored as native Word
    // checkboxes or static glyphs beside the literal A./B. labels rather than as
    // explicit merge tags. Inject these label bindings at generation time so the
    // existing layout remains untouched while the checkbox state still resolves
    // from the already-derived boolean keys.
    //
    // Template-gated: only RE851A needs these label bindings. Adding ~30
    // labels for unrelated templates (e.g. RE885 HUD-1) forces the
    // label-based replacement candidate filter to scan every paragraph
    // for needles that can never match, contributing to CPU pressure on
    // large templates. Behavior for RE851A is unchanged.
    // isTemplate851A already declared above (line ~131) for the encumbrance pipeline gate.
    const re851aLabelAdditions: Record<string, { fieldKey: string }> = isTemplate851A
      ? {
          "A. Agent in arranging a loan on behalf of another": {
            fieldKey: "or_p_brkCapacityAgent",
          },
          "A. Agent in arranging a loan": {
            fieldKey: "or_p_brkCapacityAgent",
          },
          "A. Agent": {
            fieldKey: "or_p_brkCapacityAgent",
          },
          "B. Principal as a borrower on funds from which broker will directly or indirectly benefit": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          // Shorter variant used in the live RE851A wording — matches both static
          // glyph templates and tagless SDT checkboxes during label fallback.
          "B. Principal as a borrower on funds from which broker will benefit": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          "B. Principal as a borrower on funds": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          "B. Principal as a borrower": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          // RE851A live wording prefixes "Principal" with a literal asterisk
          // ("B. *Principal as a borrower..."). Without these label variants
          // the broker-capacity B checkbox falls back to its static unchecked
          // glyph even when the CSR "IS BROKER ALSO A BORROWER?" box is true.
          "B. *Principal as a borrower on funds from which broker will directly or indirectly benefit": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          "B. *Principal as a borrower on funds from which broker will benefit": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          "B. *Principal as a borrower on funds": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          "B. *Principal as a borrower": {
            fieldKey: "or_p_brkCapacityPrincipal",
          },
          // RE851A Servicing section labels → derived boolean keys.
          // Mirrors the broker A/B pattern above so the static ☐ glyph that
          // sits immediately before each label flips to ☑ when the matching
          // boolean is true. No template edits required.
          "THERE ARE NO SERVICING ARRANGEMENTS": {
            fieldKey: "sv_p_noServicingArrangements",
          },
          "THERE ARE NO SERVICING ARRANGEMENTS (Does not apply to multi-lender transactions.)": {
            fieldKey: "sv_p_noServicingArrangements",
          },
          "THERE ARE NO SERVICING ARRANGEMENTS  (Does not apply to multi-lender transactions.)": {
            fieldKey: "sv_p_noServicingArrangements",
          },
          "BROKER IS THE SERVICING AGENT": {
            fieldKey: "sv_p_brokerIsServicingAgent",
          },
          "BROKER IS THE SERVICING AGENT -See attached \"Notes\"": {
            fieldKey: "sv_p_brokerIsServicingAgent",
          },
          "BROKER IS THE SERVICING AGENT  -See attached \"Notes\"": {
            fieldKey: "sv_p_brokerIsServicingAgent",
          },
          "ANOTHER QUALIFIED PARTY WILL SERVICE THE LOAN": {
            fieldKey: "sv_p_anotherQualifiedParty",
          },
          "ANOTHER QUALIFIED PARTY WILL SERVICE THE LOAN CHECK BOX IF ANY PARTY OTHER THAN LENDER IS SELECTED AS SERVICER": {
            fieldKey: "sv_p_anotherQualifiedParty",
          },
          // RE851A Part 3 Amortization labels (CHECK ONE) — derived booleans are
          // already populated by the dropdown→checkbox derivation step. These
          // label bindings let the existing static glyph-before-label fallback
          // toggle the correct checkbox without any template edits.
          "FULLY AMORTIZED": { fieldKey: "ln_p_amortized" },
          "AMORTIZED": { fieldKey: "ln_p_amortized" },
          "AMORTIZED PARTIALLY": { fieldKey: "ln_p_amortizedPartially" },
          "PARTIALLY AMORTIZED": { fieldKey: "ln_p_amortizedPartially" },
          "INTEREST ONLY": { fieldKey: "ln_p_interestOnly" },
          "CONSTANT AMORTIZATION": { fieldKey: "ln_p_constantAmortization" },
          "ADD-ON INTEREST": { fieldKey: "ln_p_addOnInterest" },
          "ADD ON INTEREST": { fieldKey: "ln_p_addOnInterest" },
        }
      : {};
    // RE851D output is driven entirely by explicit merge tags and the
    // template-scoped post-render safety passes below. The generic label
    // map (sourced from merge_tag_mappings) adds no RE851D-specific
    // bindings but forces a full ~3.9MB document scan for every label
    // candidate during processDocx — a major CPU sink that contributed to
    // "Generation timed out (CPU limit exceeded)". Disable label-based
    // replacement for RE851D only; all other templates keep current behavior.
    const effectiveLabelMap = isTemplate851D
      ? {}
      : { ...labelMap, ...re851aLabelAdditions };

    let templateBuffer = new Uint8Array(await fileData.arrayBuffer());

    // ── Upfront authoring-noise strip for RE851D ──
    // The RE851D pre-processing block below unzips templateBuffer and runs
    // ~180 regex scans on word/document.xml. On uploaded RE851D templates
    // (~4.4MB document.xml — 63% of which is mc:Fallback / rsid / proofErr
    // authoring noise) those scans alone consume the entire 2s edge-function
    // CPU budget BEFORE processDocx() even runs. Stripping the same noise
    // here once produces an equivalent ~1.5MB document.xml that every
    // downstream pass operates on, cutting CPU work proportionally.
    //
    // Lossless: removes only mc:Fallback (legacy VML duplicate of mc:Choice),
    // rsid* attributes, <w:proofErr/>, <w:lastRenderedPageBreak/>, and
    // _GoBack bookmarks. Paragraphs, runs, tables, sections, styles, SDTs,
    // drawings, hyperlinks, and merge tags are preserved unchanged.
    if (isEncumbrancePipeline) {
      try {
        const tStrip = performance.now();
        const decompressed = fflate.unzipSync(templateBuffer);
        const decoder = new TextDecoder("utf-8");
        const encoder = new TextEncoder();
        const STRIP_PARTS = [
          "word/document.xml",
          "word/header1.xml", "word/header2.xml", "word/header3.xml",
          "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
        ];
        let touched = false;
        let beforeBytes = 0;
        let afterBytes = 0;
        for (const part of STRIP_PARTS) {
          const data = decompressed[part];
          if (!data) continue;
          const original = decoder.decode(data);
          // Cheap exit: skip parts with no detectable noise.
          if (
            !original.includes("<mc:Fallback") &&
            !/\sw:rsid[A-Za-z]*="/.test(original) &&
            !original.includes("<w:proofErr") &&
            !original.includes("<w:lastRenderedPageBreak") &&
            !original.includes('w:name="_GoBack"')
          ) {
            continue;
          }
          let cleaned = original.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");
          // Single AlternateContent unwrap pass — Word emits at most one
          // Fallback per Choice so iterating to fixpoint costs >300ms on
          // large templates and yields no further reduction.
          cleaned = cleaned.replace(
            /<mc:AlternateContent[^>]*>\s*<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>\s*<\/mc:AlternateContent>/g,
            "$1",
          );
          cleaned = cleaned.replace(/\s+w:rsid[A-Za-z]*="[0-9A-Fa-f]+"/g, "");
          cleaned = cleaned.replace(/<w:proofErr\b[^/>]*\/>/g, "");
          cleaned = cleaned.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
          cleaned = cleaned.replace(
            /<w:bookmarkStart\b[^/>]*w:name="_GoBack"[^/>]*\/>/g,
            "",
          );
          if (cleaned.length !== original.length) {
            decompressed[part] = encoder.encode(cleaned);
            touched = true;
            beforeBytes += original.length;
            afterBytes += cleaned.length;
          }
        }
        if (touched) {
          templateBuffer = new Uint8Array(
            fflate.zipSync(decompressed as fflate.Zippable, { level: 0 }),
          );
          console.log(
            `[generate-document] RE851D upfront authoring-noise strip: ${beforeBytes}B -> ${afterBytes}B in ${Math.round(performance.now() - tStrip)}ms`,
          );
        }
      } catch (stripErr) {
        // Never fail generation on opportunistic cleanup.
        console.warn(
          "[generate-document] RE851D upfront cleanup skipped:",
          stripErr instanceof Error ? stripErr.message : String(stripErr),
        );
      }
    }

    // ── Lien Mappings template: convert literal "{P}/{S}" placeholders into
    // resolved handlebar tags ────────────────────────────────────────────────
    // The "Lien Mapping Only" template is authored as bare text (e.g.
    //   pr_li_rem_priority_{P}_{S}
    // ) without {{ … }} delimiters, so the merge-tag parser would never see
    // them and the literal field keys print verbatim in the rendered DOCX.
    // This pass scans every <w:t> body and rewrites occurrences of the
    // pr_li_(rem|ant)_<field>_{P}_{S} family to a concrete handlebar tag
    // (e.g. {{pr_li_rem_priority_1_1}}) so the existing encumbrance publisher
    // (gated by isEncumbrancePipeline) can populate values per slot.
    //
    // P defaults to 1 (this template is single-property). S increments per
    // (P, family, fieldBase) by document order — first slot=1, second=2, etc.
    // Slots > 2 are still emitted; the existing addendum/overflow appender
    // handles them. Strictly additive; gated by isLienMappingTemplate so no
    // other template is affected.
    // Extended to RE851A: its authored template uses the same literal
    // `{{pr_li_(rem|ant)_<field>_{N}_{S}}}` placeholder convention for the
    // ENCUMBRANCE(S) REMAINING and Encumbrances expected/anticipated sections.
    // The encumbrance publisher already runs for RE851A (isEncumbrancePipeline),
    // but without this rewrite the literal `{N}`/`{S}` tokens remain in the
    // resolved tag and never bind to a value. Gate is strictly additive.
    if (isLienMappingTemplate || isTemplate851A) {
      try {
        const tLien = performance.now();
        const decompressed = fflate.unzipSync(templateBuffer);
        const decoder = new TextDecoder("utf-8");
        const encoder = new TextEncoder();
        const PARTS = [
          "word/document.xml",
          "word/header1.xml", "word/header2.xml", "word/header3.xml",
          "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
        ];
        const FIELD_BASES = [
          "priority",
          "interestRate", "interest_rate", "intRate",
          "beneficiary", "lienHolder", "holder",
          "originalAmount", "principalBalance", "monthlyPayment",
          "maturityDate", "maturity_date", "matDate",
          "balloonAmount", "balloonYes", "balloonNo", "balloonUnknown",
          "amountOwing", "amount_owing", "amount", "owing",
        ];
        // Longest-first so e.g. "balloonAmount" wins over "balloon".
        FIELD_BASES.sort((a, b) => b.length - a.length);
        const fieldAlt = FIELD_BASES.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        // Property-index placeholder accepts both {P} (legacy) and {N} (new
        // standard for Remaining lien mappings). Slot index always {S}.
        const reFull = new RegExp(`pr_li_(rem|ant)_(${fieldAlt})_\\{[PN]\\}_\\{S\\}`, "g");
        const reSlotOnly = new RegExp(`pr_li_(rem|ant)_(${fieldAlt})_\\{S\\}`, "g");
        const rePropOnly = new RegExp(`pr_li_(rem|ant)_(${fieldAlt})_\\{[PN]\\}(?!_\\{S\\})`, "g");

        let totalRewrites = 0;
        const rewrittenKeys = new Set<string>();
        let touched = false;
        for (const part of PARTS) {
          const data = decompressed[part];
          if (!data) continue;
          const originalRaw = decoder.decode(data);
          // Normalize first so placeholders authored as {{ pr_li_... }} and
          // split across Word runs are consolidated before this template-only
          // resolver runs. This is scoped to the Lien Mapping template only.
          let original = originalRaw;
          try {
            original = normalizeWordXml(originalRaw, template.name || "");
          } catch (_normErr) {
            original = originalRaw;
          }
          if (!original.includes("{P}") && !original.includes("{N}") && !original.includes("{S}")) continue;
          const slotCounter = new Map<string, number>();
          const nextSlot = (p: number, fam: string, base: string): number => {
            const k = `${p}|${fam}|${base}`;
            const n = (slotCounter.get(k) || 0) + 1;
            slotCounter.set(k, n);
            return n;
          };
          let partRewrites = 0;
          const cleaned = original.replace(
            /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
            (_m, open: string, body: string, close: string) => {
              if (!body.includes("{P}") && !body.includes("{N}") && !body.includes("{S}")) return _m;
              let out = body;
              const P = 1;
              // Consume optional existing {{ }} delimiters as part of the same
              // replacement. The prior pass replaced only the inner field name,
              // turning {{pr_li_rem_priority_{P}_{S}}} into nested
              // {{{{pr_li_rem_priority_1_1}}}}, which the parser could not
              // resolve and therefore printed as raw text.
              out = out.replace(new RegExp(`\\{\\{\\s*${reFull.source}\\s*\\}\\}|${reFull.source}`, "g"), (_full, fam1: string, base1: string, fam2: string, base2: string) => {
                partRewrites++;
                const fam = fam1 || fam2;
                const base = base1 || base2;
                const s = nextSlot(P, fam, base);
                const key = `pr_li_${fam}_${base}_${P}_${s}`;
                rewrittenKeys.add(key);
                return `{{${key}}}`;
              });
              out = out.replace(new RegExp(`\\{\\{\\s*${reSlotOnly.source}\\s*\\}\\}|${reSlotOnly.source}`, "g"), (_full, fam1: string, base1: string, fam2: string, base2: string) => {
                partRewrites++;
                const fam = fam1 || fam2;
                const base = base1 || base2;
                const s = nextSlot(P, fam, base);
                const key = `pr_li_${fam}_${base}_${P}_${s}`;
                rewrittenKeys.add(key);
                return `{{${key}}}`;
              });
              out = out.replace(new RegExp(`\\{\\{\\s*${rePropOnly.source}\\s*\\}\\}|${rePropOnly.source}`, "g"), (_full, fam1: string, base1: string, fam2: string, base2: string) => {
                partRewrites++;
                const fam = fam1 || fam2;
                const base = base1 || base2;
                const key = `pr_li_${fam}_${base}_${P}`;
                rewrittenKeys.add(key);
                return `{{${key}}}`;
              });
              return open + out + close;
            },
          );
          if (cleaned !== original) {
            decompressed[part] = encoder.encode(cleaned);
            touched = true;
            totalRewrites += partRewrites;
          }
        }
        if (touched) {
          templateBuffer = new Uint8Array(
            fflate.zipSync(decompressed as fflate.Zippable, { level: 0 }),
          );
          console.log(
            `[generate-document] Lien Mappings: rewrote ${totalRewrites} {P}/{S} placeholder(s), registered keys=[${[...rewrittenKeys].slice(0, 40).join(", ")}] in ${Math.round(performance.now() - tLien)}ms`,
          );
        }
      } catch (lienErr) {
        console.warn(
          "[generate-document] Lien Mappings preprocessing skipped:",
          lienErr instanceof Error ? lienErr.message : String(lienErr),
        );
      }
    }

    // ── RE851D: expand literal "_N" placeholders into per-occurrence "_1", "_2", ... ──
    // Some authored RE851D templates leave generic placeholders (e.g.
    // {{pr_p_address_N}}) inside each PROPERTY block instead of the resolved
    // indexed form. Without this preprocessing, the merge-tag resolver treats
    // "_N" as a literal field key and prints nothing, so all PROPERTY blocks
    // remain blank. We rewrite each occurrence by document order, capped at 5
    // (the spec's maximum properties per RE851D). Strictly scoped to known
    // RE851D placeholder families — no other tags are touched.
    if (isEncumbrancePipeline) {
      try {
        // Full set of _N families that appear inside PROPERTY #K blocks.
        const RE851D_INDEXED_TAGS = [
          "pr_p_address_N", "pr_p_street_N", "pr_p_city_N", "pr_p_state_N",
          "pr_p_zip_N", "pr_p_county_N", "pr_p_country_N", "pr_p_apn_N",
          "pr_p_owner_N", "pr_p_ownerName_N", "pr_p_marketValue_N", "pr_p_appraiseValue_N",
          "pr_p_appraiseDate_N", "pr_p_appraiserStreet_N", "pr_p_appraiserCity_N",
          "pr_p_appraiserState_N", "pr_p_appraiserZip_N", "pr_p_appraiserPhone_N",
          "pr_p_appraiserEmail_N", "pr_p_legalDescri_N", "pr_p_yearBuilt_N",
          "pr_p_squareFeet_N", "pr_p_lotSize_N", "pr_p_numberOfUni_N",
          "pr_p_propertyTyp_N", "pr_p_propertyType_N", "pr_p_occupancySt_N",
          "pr_p_occupanc_N", "pr_p_remainingSenior_N", "pr_p_expectedSenior_N",
          "ln_p_expectedEncumbrance_N", "ln_p_remainingEncumbrance_N",
          "pr_p_totalSenior_N", "pr_p_totalEncumbrance_N", "pr_p_totalSeniorPlusLoan_N",
          "ln_p_totalEncumbrance_N", "ln_p_totalWithLoan_N", "ln_p_amountOfEquity_N", "ln_p_equitySecuringLoan_N", "property_number_N",
          "pr_p_construcType_N", "pr_p_purchasePrice_N", "pr_p_downPayme_N",
          "pr_p_protectiveEquity_N", "pr_p_descript_N", "pr_p_ltv_N", "pr_p_cltv_N",
          "pr_p_zoning_N", "pr_p_floodZone_N", "pr_p_pledgedEquity_N",
          "pr_p_delinquHowMany_N",
          // Lien-delinquency block (CSR Property → Liens, RE851D delinquency questions)
          "pr_li_delinquencyPaidByLoan_N_yes_glyph", "pr_li_delinquencyPaidByLoan_N_no_glyph",
          "pr_li_delinquencyPaidByLoan_N_yes", "pr_li_delinquencyPaidByLoan_N_no",
          "pr_li_delinquencyPaidByLoan_N",
          "pr_li_delinqu60day_N_yes_glyph", "pr_li_delinqu60day_N_no_glyph",
          "pr_li_delinqu60day_N_yes", "pr_li_delinqu60day_N_no",
          "pr_li_delinqu60day_N",
          "pr_li_currentDelinqu_N_yes_glyph", "pr_li_currentDelinqu_N_no_glyph",
          "pr_li_currentDelinqu_N_yes", "pr_li_currentDelinqu_N_no",
          "pr_li_currentDelinqu_N",
          "pr_li_sourceOfPayment_N",
          "pr_li_delinquHowMany_N",
          // Source of Information checkboxes (per-property). _glyph listed first
          // so longest-match wins over the bare boolean key.
          "pr_li_sourceInfoBroker_N_glyph", "pr_li_sourceInfoBroker_N",
          "pr_li_sourceInfoBorrower_N_glyph", "pr_li_sourceInfoBorrower_N",
          "pr_li_sourceInfoOther_N_glyph", "pr_li_sourceInfoOther_N",
          "pr_li_sourceInfoOtherText_N",
          "pr_li_sourceOfInformation_N",
          "pr_li_encumbranceOfRecord_N",
          "pr_li_encumbranceOfRecord_N_yes", "pr_li_encumbranceOfRecord_N_no",
          "pr_li_encumbranceOfRecord_N_yes_glyph", "pr_li_encumbranceOfRecord_N_no_glyph",
          // pr_p_* compatibility aliases for older RE851D template variants
          "pr_p_encumbranceOfRecord_N_yes_glyph", "pr_p_encumbranceOfRecord_N_no_glyph",
          "pr_p_encumbranceOfRecord_N_yes", "pr_p_encumbranceOfRecord_N_no",
          "pr_p_encumbranceOfRecord_N",
          "pr_p_delinqu60day_N_yes_glyph", "pr_p_delinqu60day_N_no_glyph",
          "pr_p_delinqu60day_N_yes", "pr_p_delinqu60day_N_no",
          "pr_p_delinqu60day_N",
          "pr_p_currentDelinqu_N_yes_glyph", "pr_p_currentDelinqu_N_no_glyph",
          "pr_p_currentDelinqu_N_yes", "pr_p_currentDelinqu_N_no",
          "pr_p_currentDelinqu_N",
          "pr_p_paidByLoan_N_yes_glyph", "pr_p_paidByLoan_N_no_glyph",
          "pr_p_paidByLoan_N_yes", "pr_p_paidByLoan_N_no",
          "pr_p_paidByLoan_N",
          "pr_p_sourceOfPaymen_N", "pr_p_sourceOfPayment_N",
          "ln_p_loanToValueRatio_N", "propertytax_annual_payment_N",
          // RE851D ANNUAL PROPERTY TAXES per-property aliases.
          // _glyph variants listed first so longest-match wins over bare booleans.
          "pr_pt_annualTaxes_N",
          "pr_pt_actual_N_glyph", "pr_pt_actual_N",
          "pr_pt_estimated_N_glyph", "pr_pt_estimated_N",
          // RE851D ARE TAXES DELINQUENT? per-property aliases. Longest first.
          "pr_pt_delinquent_yes_glyph_N", "pr_pt_delinquent_no_glyph_N",
          "pr_pt_delinquentAmount_N", "pr_pt_delinquent_N",
          // RE851D propertytax dotted-form _N tags. Order is critical: longer
          // matches FIRST so "delinquent_amount_N" wins before "delinquent_N".
          "propertytax.delinquent_amount_N",
          "propertytax.source_of_information_N",
          "propertytax.annual_payment_N",
          "propertytax.delinquent_N",
          // Property Type checkboxes (per-property, mutually exclusive).
          // Both bare boolean form and _glyph form are listed so the region
          // rewriter handles either template variant. _glyph variants are
          // longer and naturally sorted first by the longest-first scanner.
          "property_type_sfr_owner_N_glyph", "property_type_sfr_owner_N",
          "property_type_sfr_non_owner_N_glyph", "property_type_sfr_non_owner_N",
          "property_type_sfr_zoned_N_glyph", "property_type_sfr_zoned_N",
          "property_type_commercial_N_glyph", "property_type_commercial_N",
          "property_type_land_zoned_N_glyph", "property_type_land_zoned_N",
          "property_type_land_income_N_glyph", "property_type_land_income_N",
          "property_type_other_N_glyph", "property_type_other_N",
          "property_type_other_text_N",
          // Encumbrance Remaining / Anticipated (per-property, per-slot).
          // Both _N_S and _N forms listed; longest-first ordering ensures
          // _N_S is consumed first so the slot index survives the rewrite.
          "pr_li_rem_priority_N_S", "pr_li_rem_priority_N",
          "pr_li_rem_interestRate_N_S", "pr_li_rem_interestRate_N",
          "pr_li_rem_interest_rate_N_S", "pr_li_rem_interest_rate_N",
          "pr_li_rem_intRate_N_S", "pr_li_rem_intRate_N",
          "pr_li_rem_beneficiary_N_S", "pr_li_rem_beneficiary_N",
          "pr_li_rem_lienHolder_N_S", "pr_li_rem_lienHolder_N",
          "pr_li_rem_holder_N_S", "pr_li_rem_holder_N",
          "pr_li_rem_originalAmount_N_S", "pr_li_rem_originalAmount_N",
          "pr_li_rem_principalBalance_N_S", "pr_li_rem_principalBalance_N",
          "pr_li_rem_monthlyPayment_N_S", "pr_li_rem_monthlyPayment_N",
          "pr_li_rem_maturityDate_N_S", "pr_li_rem_maturityDate_N",
          "pr_li_rem_maturity_date_N_S", "pr_li_rem_maturity_date_N",
          "pr_li_rem_matDate_N_S", "pr_li_rem_matDate_N",
          "pr_li_rem_balloonAmount_N_S", "pr_li_rem_balloonAmount_N",
          "pr_li_rem_balloonYes_N_S", "pr_li_rem_balloonYes_N",
          "pr_li_rem_balloonNo_N_S", "pr_li_rem_balloonNo_N",
          "pr_li_rem_balloonUnknown_N_S", "pr_li_rem_balloonUnknown_N",
          "pr_li_rem_amountOwing_N_S", "pr_li_rem_amountOwing_N",
          "pr_li_rem_amount_owing_N_S", "pr_li_rem_amount_owing_N",
          "pr_li_ant_priority_N_S", "pr_li_ant_priority_N",
          "pr_li_ant_interestRate_N_S", "pr_li_ant_interestRate_N",
          "pr_li_ant_interest_rate_N_S", "pr_li_ant_interest_rate_N",
          "pr_li_ant_intRate_N_S", "pr_li_ant_intRate_N",
          "pr_li_ant_beneficiary_N_S", "pr_li_ant_beneficiary_N",
          "pr_li_ant_lienHolder_N_S", "pr_li_ant_lienHolder_N",
          "pr_li_ant_holder_N_S", "pr_li_ant_holder_N",
          "pr_li_ant_originalAmount_N_S", "pr_li_ant_originalAmount_N",
          "pr_li_ant_principalBalance_N_S", "pr_li_ant_principalBalance_N",
          "pr_li_ant_monthlyPayment_N_S", "pr_li_ant_monthlyPayment_N",
          "pr_li_ant_maturityDate_N_S", "pr_li_ant_maturityDate_N",
          "pr_li_ant_maturity_date_N_S", "pr_li_ant_maturity_date_N",
          "pr_li_ant_matDate_N_S", "pr_li_ant_matDate_N",
          "pr_li_ant_balloonAmount_N_S", "pr_li_ant_balloonAmount_N",
          "pr_li_ant_balloonYes_N_S", "pr_li_ant_balloonYes_N",
          "pr_li_ant_balloonNo_N_S", "pr_li_ant_balloonNo_N",
          "pr_li_ant_balloonUnknown_N_S", "pr_li_ant_balloonUnknown_N",
          "pr_li_ant_amountOwing_N_S", "pr_li_ant_amountOwing_N",
          "pr_li_ant_amount_owing_N_S", "pr_li_ant_amount_owing_N",
          // Appraiser output is pre-resolved via pr_p_appraiserName_N /
          // pr_p_appraiserAddress_N below. Do not generic-rewrite the raw
          // performedBy token here; doing so consumes the inner token before the
          // full conditional-block rewrite can replace the entire malformed
          // `#if ... Broker` expression.
          "pr_p_appraiserName_N", "pr_p_appraiserAddress_N",
          // RE851D per-property income (Yes/No text + annual numeric).
          "pr_p_netMonthlyIncome_N", "pr_p_incomeGenerating_N", "pr_p_grossAnnualIncome_N",
          // RE851D "Is there Additional Securing Property?" per-property
          // checkbox tags. Some templates author these as `_N` literals inside
          // each PROPERTY #K block; without these in the allowlist the literal
          // tags survive into the rendered document for properties whose
          // post-render glyph-flip safety pass cannot anchor a glyph run
          // (typically PROP#1 and PROP#5). _glyph variants listed first so the
          // longest-first matcher consumes them before the bare booleans.
          "pr_p_multipleProperties_yes_glyph_N", "pr_p_multipleProperties_no_glyph_N",
          "pr_p_multipleProperties_yes_N", "pr_p_multipleProperties_no_N",
        ];
        // Tags that appear in the repeating PART 1 / PART 2 row blocks.
        // PART 1 (LOAN TO VALUE RATIO table) and PART 2 (SECURING PROPERTIES
        // pre-property block) both contain {{ln_p_remainingEncumbrance_N}} and
        // {{ln_p_expectedEncumbrance_N}} repeated once per property row. Without
        // these in the allowlist they were skipped by the region-restricted
        // rewrite and stayed as the literal "_N" form, resolving to blank in
        // the generated document (the reported bug).
        const PART1_TAGS = [
          "property_number_N",
          "pr_p_appraiseValue_N",
          "ln_p_loanToValueRatio_N",
          "ln_p_remainingEncumbrance_N",
          "ln_p_expectedEncumbrance_N",
          "ln_p_totalEncumbrance_N",
          "ln_p_totalWithLoan_N",
          "ln_p_amountOfEquity_N",
          "ln_p_equitySecuringLoan_N",
          "property_type_sfr_owner_N_glyph", "property_type_sfr_owner_N",
          "property_type_sfr_non_owner_N_glyph", "property_type_sfr_non_owner_N",
          "property_type_sfr_zoned_N_glyph", "property_type_sfr_zoned_N",
          "property_type_commercial_N_glyph", "property_type_commercial_N",
          "property_type_land_zoned_N_glyph", "property_type_land_zoned_N",
          "property_type_land_income_N_glyph", "property_type_land_income_N",
          "property_type_other_N_glyph", "property_type_other_N",
          "property_type_other_text_N",
          // "Is there Additional Securing Property?" — appears in PART 1 region
          // before the first PROPERTY INFORMATION anchor for some templates.
          "pr_p_multipleProperties_yes_glyph_N", "pr_p_multipleProperties_no_glyph_N",
          "pr_p_multipleProperties_yes_N", "pr_p_multipleProperties_no_N",
        ];
        const PART2_TAGS = [
          "property_number_N",
          "pr_p_address_N",
          "pr_p_ownerName_N",
          "pr_p_appraiseValue_N",
          "ln_p_loanToValueRatio_N",
          "ln_p_remainingEncumbrance_N",
          "ln_p_expectedEncumbrance_N",
          "ln_p_totalEncumbrance_N",
          "ln_p_totalWithLoan_N",
          "ln_p_amountOfEquity_N",
          "ln_p_equitySecuringLoan_N",
          "property_type_sfr_owner_N_glyph", "property_type_sfr_owner_N",
          "property_type_sfr_non_owner_N_glyph", "property_type_sfr_non_owner_N",
          "property_type_sfr_zoned_N_glyph", "property_type_sfr_zoned_N",
          "property_type_commercial_N_glyph", "property_type_commercial_N",
          "property_type_land_zoned_N_glyph", "property_type_land_zoned_N",
          "property_type_land_income_N_glyph", "property_type_land_income_N",
          "property_type_other_N_glyph", "property_type_other_N",
          "property_type_other_text_N",
          // "Is there Additional Securing Property?" — appears in PART 2 region
          // (between the SECURING PROPERTIES heading and the first PROPERTY
          // INFORMATION anchor) for templates that show it once per property.
          "pr_p_multipleProperties_yes_glyph_N", "pr_p_multipleProperties_no_glyph_N",
          "pr_p_multipleProperties_yes_N", "pr_p_multipleProperties_no_N",
        ];

        const REMAINING_DYNAMIC_FIELDS = [
          "priority", "interestRate", "interest_rate", "intRate",
          "beneficiary", "lienHolder", "holder",
          "originalAmount", "principalBalance", "monthlyPayment",
          "maturityDate", "maturity_date", "matDate",
          "balloonAmount", "balloonYes", "balloonNo", "balloonUnknown",
          "amountOwing", "amount_owing", "amount", "owing",
        ];
        const remainingFieldAlt = REMAINING_DYNAMIC_FIELDS
          .sort((a, b) => b.length - a.length)
          .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|");
        const REMAINING_DYNAMIC_TOKEN_RE = new RegExp(`pr_li_rem_(${remainingFieldAlt})_\\{N\\}_\\{S\\}`, "g");

        const decoder = new TextDecoder("utf-8");
        const encoder = new TextEncoder();
        const decompressed = fflate.unzipSync(templateBuffer);
        const out: fflate.Zippable = {};
        let totalRewrites = 0;
        const regionRewriteCounts: Record<string, number> = {};

        // Strip XML tags to find anchor text (PART 1 / PART 2 / PROPERTY #K)
        // even when the heading is split across multiple <w:r> runs. We build
        // a parallel offset map: stripped-index -> original-index, so anchor
        // matches in the stripped text translate back to character offsets
        // in the original XML for region boundary computation.
        const findAnchorOffsets = (xml: string): {
          partA: [number, number] | null;
          partB: [number, number] | null;
          props: Array<{ k: number; range: [number, number] }>;
        } => {
          // Build stripped+collapsed text via BULK segment slicing instead of
          // a per-character walk. The previous implementation allocated two
          // ~4M-entry arrays (strippedChars + map) and a third ~4M-entry
          // collapsedToStripped array on a 4 MB document.xml — the dominant
          // CPU+heap sink that pushed RE851D over the edge function CPU
          // limit. The new path uses an Int32Array segment table and emits
          // one entry per text run (~thousands, not millions).
          //
          // CRITICAL: a synthetic single space replaces every tag boundary
          // so "PROPERTY</w:t>...<w:t>INFORMATION" still anchors via the
          // anchor regexes below. The synthetic space is mapped back to the
          // '<' offset so collapsedToOriginal lands at a real XML boundary.
          //
          // Each segment carries: collapsedStart (its starting collapsed-text
          // index), xmlStart (its starting xml offset), and segLen (length in
          // collapsed text). Synthetic-space segments use segLen=1 with a
          // sentinel value of 0 in xmlLen (segments are pure text otherwise).
          const segCap = 4096;
          let segN = 0;
          let collapsedCap = 4096;
          let collapsedParts: string[] = [];
          let cStart = new Int32Array(segCap);
          let xStart = new Int32Array(segCap);
          let sLen = new Int32Array(segCap);
          const growSeg = () => {
            const newCap = cStart.length * 2;
            const a = new Int32Array(newCap); a.set(cStart); cStart = a;
            const b = new Int32Array(newCap); b.set(xStart); xStart = b;
            const c = new Int32Array(newCap); c.set(sLen); sLen = c;
          };
          let collapsedPos = 0;
          let lastEmittedWasSpace = true; // suppress leading spaces in collapsed
          const emitText = (xmlOff: number, text: string) => {
            // Collapse internal whitespace runs to a single space and split
            // around them so each emitted segment is either pure non-ws text
            // or a single synthetic space. This keeps offset math exact.
            let i2 = 0;
            const len = text.length;
            while (i2 < len) {
              const ch = text.charCodeAt(i2);
              const isWs = ch === 32 || ch === 9 || ch === 10 || ch === 13;
              if (isWs) {
                let j = i2 + 1;
                while (j < len) {
                  const c2 = text.charCodeAt(j);
                  if (!(c2 === 32 || c2 === 9 || c2 === 10 || c2 === 13)) break;
                  j++;
                }
                if (!lastEmittedWasSpace) {
                  if (segN >= cStart.length) growSeg();
                  cStart[segN] = collapsedPos;
                  xStart[segN] = xmlOff + i2;
                  sLen[segN] = 1;
                  segN++;
                  collapsedParts.push(" ");
                  collapsedPos += 1;
                  lastEmittedWasSpace = true;
                }
                i2 = j;
                continue;
              }
              // run of non-ws
              let j = i2 + 1;
              while (j < len) {
                const c2 = text.charCodeAt(j);
                if (c2 === 32 || c2 === 9 || c2 === 10 || c2 === 13) break;
                j++;
              }
              const part = text.substring(i2, j);
              if (segN >= cStart.length) growSeg();
              cStart[segN] = collapsedPos;
              xStart[segN] = xmlOff + i2;
              sLen[segN] = part.length;
              segN++;
              collapsedParts.push(part);
              collapsedPos += part.length;
              lastEmittedWasSpace = false;
              i2 = j;
            }
          };
          // Walk xml splitting on tags via indexOf (no per-char loop).
          {
            let p = 0;
            const xlen = xml.length;
            while (p < xlen) {
              const lt = xml.indexOf("<", p);
              if (lt === -1) {
                if (p < xlen) emitText(p, xml.substring(p, xlen));
                break;
              }
              if (lt > p) emitText(p, xml.substring(p, lt));
              // Synthetic space for tag boundary.
              if (!lastEmittedWasSpace) {
                if (segN >= cStart.length) growSeg();
                cStart[segN] = collapsedPos;
                xStart[segN] = lt;
                sLen[segN] = 1;
                segN++;
                collapsedParts.push(" ");
                collapsedPos += 1;
                lastEmittedWasSpace = true;
              }
              const gt = xml.indexOf(">", lt);
              if (gt === -1) break;
              p = gt + 1;
            }
          }
          collapsedCap; // suppress unused warning
          const collapsed = collapsedParts.join("");
          collapsedParts = []; // free memory
          // Binary search collapsed-index → xml-offset.
          const collapsedToOriginal = (cIdx: number): number => {
            if (cIdx < 0) return 0;
            if (cIdx >= collapsed.length) return xml.length;
            let lo = 0, hi = segN - 1, best = 0;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              if (cStart[mid] <= cIdx) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            const off = cIdx - cStart[best];
            // Synthetic-space segments (sLen===1 spanning a tag) map to xmlStart.
            return xStart[best] + Math.min(off, Math.max(0, sLen[best] - 1));
          };
          const findOne = (re: RegExp): number => {
            const m = re.exec(collapsed);
            return m ? collapsedToOriginal(m.index) : -1;
          };
          const findAll = (re: RegExp): Array<{ k: number; orig: number }> => {
            const res: Array<{ k: number; orig: number }> = [];
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(collapsed)) !== null) {
              const k = parseInt(m[1], 10);
              if (k >= 1 && k <= 5) res.push({ k, orig: collapsedToOriginal(m.index) });
              if (m.index === re.lastIndex) re.lastIndex++;
            }
            return res;
          };

          const part1Start = findOne(/PART\s*1\b|LOAN\s+TO\s+VALUE\s+RATIO/i);
          const part2Start = findOne(/PART\s*2\b|SECURING\s+PROPERTIES/i);
          // Loosened heading match: detect "PROPERTY #K" headings on their own.
          // Some templates put "PROPERTY INFORMATION" on a separate line/cell or
          // omit it entirely, so the strict variant returned zero anchors. We
          // accept any "PROPERTY #K" occurrence (case-insensitive) but exclude
          // inline mentions like "secured by Property #1" by:
          //   1) requiring the match to be at/after PART 2 start (property
          //      detail blocks always come after PART 2), and
          //   2) skipping anchors followed within ~80 chars by phrases that
          //      indicate prose ("secured", "deed of trust", "trust deed").
          // Primary property-section detector: each Property #K block in the
          // RE851D template begins with a "PROPERTY INFORMATION" heading bar.
          // Use those headings as the section anchors and number them 1..5 by
          // document order. This is robust against Word splitting "PROPERTY",
          // "#", and the digit across runs/cells (which made the strict
          // "PROPERTY #K" regex return zero matches in some templates).
          const findAllNoCapture = (re: RegExp): Array<{ orig: number }> => {
            const res: Array<{ orig: number }> = [];
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(collapsed)) !== null) {
              res.push({ orig: collapsedToOriginal(m.index) });
              if (m.index === re.lastIndex) re.lastIndex++;
            }
            return res;
          };
          const part2Floor = part2Start >= 0 ? part2Start : -1;
          // "PROPERTY INFORMATION" gray-bar headings — one per property block.
          const propInfoRaw = findAllNoCapture(/\bPROPERTY\s+INFORMATION\b/gi);
          const propInfoOrdered = propInfoRaw
            .filter(p => part2Floor < 0 || p.orig >= part2Floor)
            .sort((a, b) => a.orig - b.orig)
            .slice(0, 5)
            .map((p, i) => ({ k: i + 1, orig: p.orig }));

          // Fallback: if no "PROPERTY INFORMATION" anchors were found, fall
          // back to the previous "PROPERTY #K" detector (with inline-prose
          // filter) so legacy templates without the gray-bar heading still
          // resolve. Strictly capped to 1..5.
          let propsOrdered: Array<{ k: number; orig: number }>;
          if (propInfoOrdered.length > 0) {
            propsOrdered = propInfoOrdered;
          } else {
            const rawPropMatches = findAll(/\bPROPERTY\s*#?\s*([1-5])\b/gi);
            const propMatches = rawPropMatches.filter(p => {
              if (part2Floor >= 0 && p.orig < part2Floor) return false;
              const tail = xml.slice(p.orig, p.orig + 400).replace(/<[^>]+>/g, " ");
              if (/\b(secured|deed of trust|trust deed)\b/i.test(tail.slice(0, 80))) {
                return false;
              }
              return true;
            });
            const seen = new Set<number>();
            propsOrdered = propMatches
              .filter(p => (seen.has(p.k) ? false : (seen.add(p.k), true)))
              .sort((a, b) => a.orig - b.orig);
          }
          const xmlEnd = xml.length;
          const firstPropOffset = propsOrdered.length > 0 ? propsOrdered[0].orig : xmlEnd;
          const partA: [number, number] | null = part1Start >= 0
            ? [part1Start, part2Start >= 0 ? part2Start : (firstPropOffset >= 0 ? firstPropOffset : xmlEnd)]
            : null;
          const partB: [number, number] | null = part2Start >= 0
            ? [part2Start, firstPropOffset >= 0 ? firstPropOffset : xmlEnd]
            : null;
          const props: Array<{ k: number; range: [number, number] }> = [];
          for (let pi = 0; pi < propsOrdered.length; pi++) {
            const start = propsOrdered[pi].orig;
            const end = pi + 1 < propsOrdered.length ? propsOrdered[pi + 1].orig : xmlEnd;
            props.push({ k: propsOrdered[pi].k, range: [start, end] });
          }
          return { partA, partB, props };
        };

        // Process content parts in a deterministic order so per-tag occurrence
        // numbering follows document reading order (header, document, footer).
        const orderedNames = Object.keys(decompressed).sort((a, b) => {
          const rank = (n: string) =>
            n === "word/document.xml" ? 1 :
            n.startsWith("word/header") ? 0 :
            n.startsWith("word/footer") ? 2 :
            n.startsWith("word/footnotes") ? 3 :
            n.startsWith("word/endnotes") ? 4 : 5;
          const ra = rank(a), rb = rank(b);
          return ra !== rb ? ra - rb : a.localeCompare(b);
        });

        // Global fallback counters (used when no region matches the offset).
        const globalCounters = new Map<string, number>();
        // Region log buffer for diagnostics.
        const regionLog: string[] = [];

        for (const filename of orderedNames) {
          const bytes = decompressed[filename];
          const isContentPart =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer") ||
            filename.startsWith("word/footnotes") ||
            filename.startsWith("word/endnotes");
          if (!isContentPart) {
            out[filename] = bytes;
            continue;
          }
          let xml = decoder.decode(bytes);
          const remainingDynamicHits = (xml.match(REMAINING_DYNAMIC_TOKEN_RE) || []).slice(0, 20);
          if (remainingDynamicHits.length > 0) {
            console.log(`[generate-document] RE851D Remaining parsed placeholder keys in ${filename}: ${remainingDynamicHits.join(", ")}`);
          }
          if (!xml.includes("_N") && !xml.includes("_{N}") && !xml.includes("_(N)") && !xml.includes("_{P}") && !xml.includes("_(P)") && !xml.includes("ld_p_vestin")) {
            out[filename] = bytes;
            continue;
          }
          // Normalize fragmented Word runs BEFORE scanning for `_N` placeholders.
          // Word frequently splits "{{property_type_sfr_owner_N}}" across multiple
          // <w:r> runs, which prevents the plain-regex rewriter below from matching
          // those occurrences. Running normalizeWordXml first joins the runs so
          // every `_N` placeholder becomes a contiguous string. This is idempotent
          // — the later processDocx() call will re-normalize as a no-op fast-path.
          //
          // CPU guard: only invoke normalize when there is evidence of
          // fragmentation (Word field-code structures or split delimiters).
          // For multi-property RE851D documents document.xml can exceed 4 MB,
          // and even the fast-path normalize pays a sizable preCheck cost on
          // every byte. Skipping it when the template is already flat is safe
          // because the post-render passes also re-normalize on demand.
          const needsNormalize =
            xml.includes("w:fldChar") ||
            xml.includes("w:fldSimple") ||
            xml.includes("w:instrText") ||
            /\{(?:\s|<[^>]+>)+\{/.test(xml) ||
            /\}(?:\s|<[^>]+>)+\}/.test(xml) ||
            // RE851D encumbrance balloon labels are frequently authored with
            // parenthesized/braced indices (pr_li_(rem|ant)_<field>_(N)_(S))
            // and Word commonly splits those identifiers across <w:r> runs,
            // which defeats the parenthesized-index rewrite below. When the
            // file mentions the encumbrance prefix AND any (N)/{N} marker,
            // force a normalize so the rewrite + strip passes can match.
            (xml.includes("pr_li_") && /[\(\{][NP][\)\}]/.test(xml));
          if (needsNormalize) {
            try {
              xml = normalizeWordXml(xml, template.name || "");
            } catch (_normErr) {
              // If normalization fails for any reason, fall back to the raw XML
              // (preserves previous behavior — partial rewrites are still better
              // than failing the whole document).
            }
          }
          // Normalize parenthesized index syntax used by some authored RE851D
          // templates: pr_li_(rem|ant)_<field>_(N)_(S) -> _N_S, _(N) -> _N.
          // Strictly scoped to encumbrance families so other prose with
          // literal parens is never touched.
          xml = xml.replace(
            /\b(pr_li_rem_[A-Za-z]+)_\(P\)_\(S\)/g,
            "$1_N_S",
          );
          xml = xml.replace(
            /\b(pr_li_rem_[A-Za-z]+)_\(P\)/g,
            "$1_N",
          );
          xml = xml.replace(
            /\b(pr_li_(?:rem|ant)_[A-Za-z]+)_\(N\)_\(S\)/g,
            "$1_N_S",
          );
          xml = xml.replace(
            /\b(pr_li_(?:rem|ant)_[A-Za-z]+)_\(N\)/g,
            "$1_N",
          );
          // Curly-brace placeholder variant authored in some RE851D templates:
          // pr_li_(rem|ant)_<field>_{N}_{S} -> _N_S, _{N} -> _N.
          xml = xml.replace(
            /\b(pr_li_rem_[A-Za-z]+)_\{P\}_\{S\}/g,
            "$1_N_S",
          );
          xml = xml.replace(
            /\b(pr_li_rem_[A-Za-z]+)_\{P\}/g,
            "$1_N",
          );
          xml = xml.replace(
            /\b(pr_li_(?:rem|ant)_[A-Za-z]+)_\{N\}_\{S\}/g,
            "$1_N_S",
          );
          xml = xml.replace(
            /\b(pr_li_(?:rem|ant)_[A-Za-z]+)_\{N\}/g,
            "$1_N",
          );

          // RE851D Owner Occupied condition normalizer.
          // Some authored RE851D templates write the (eq ...) sub-expression
          // with missing whitespace before the literal, or with the wrong
          // literal value ("Owner" instead of "Owner Occupied"), e.g.
          //   (eq pr_p_occupanc_N"Owner")
          //   (eq pr_p_occupanc_N "Owner")
          //   (eq pr_p_occupanc_1 "Owner")
          // Both variants make the conditional silently fail to evaluate or
          // evaluate against the wrong literal, leaving the static Yes/No
          // glyphs untouched (=> both checked). Normalize to:
          //   (eq pr_p_occupanc_N "Owner Occupied")
          // Strictly scoped to the pr_p_occupanc field family.
          xml = xml.replace(
            /\(\s*eq\s+(pr_p_occupanc(?:_(?:N|[1-5]))?)\s*"\s*Owner\s*"\s*\)/gi,
            '(eq $1 "Owner Occupied")',
          );
          xml = xml.replace(
            /\(\s*eq\s+(pr_p_occupanc(?:_(?:N|[1-5]))?)"\s*Owner(?:\s+Occupied)?\s*"\s*\)/gi,
            '(eq $1 "Owner Occupied")',
          );
          // Also normalize the (ne …) inverse used by the No checkbox in some
          // RE851D template variants.
          xml = xml.replace(
            /\(\s*ne\s+(pr_p_occupanc(?:_(?:N|[1-5]))?)\s*"\s*Owner\s*"\s*\)/gi,
            '(ne $1 "Owner Occupied")',
          );
          xml = xml.replace(
            /\(\s*ne\s+(pr_p_occupanc(?:_(?:N|[1-5]))?)"\s*Owner(?:\s+Occupied)?\s*"\s*\)/gi,
            '(ne $1 "Owner Occupied")',
          );
          // Decode XML-entity-encoded quotes inside pr_p_occupanc eq/ne openers
          // so the downstream tag-parser eq evaluator (which expects raw " quotes)
          // can match. Strictly limited to the pr_p_occupanc field family.
          xml = xml.replace(
            /(\{\{#(?:if|unless)\s+\(\s*(?:eq|ne)\s+pr_p_occupanc(?:_(?:N|[1-5]))?\s+)&quot;([^"<]*?)&quot;(\s*\)\s*\}\})/g,
            '$1"$2"$3',
          );

          // ── RE851D malformed inline-expression sanitization ──
          // The uploaded RE851D template variants contain a handful of
          // syntactically-broken merge-tag fragments that, left as-is, either
          // print verbatim or trick downstream cleanup into mis-slicing
          // paragraphs (causing unbalanced <w:p> integrity failures).
          // All rewrites below are scoped to specific RE851D field families
          // so other templates are never touched.

          // (a) Fix `(eq pr_p_performeBy_N"Broker")` / `(eq pr_p_performedBy_N"Broker")`
          //     where the literal lacks whitespace before the opening quote.
          //     The eq evaluator requires `eq FIELD "LITERAL"` with whitespace.
          xml = xml.replace(
            /(\(\s*(?:eq|ne)\s+pr_p_perform(?:e|ed)By(?:_(?:N|[1-5]))?)\s*"\s*([^"<]*?)\s*"\s*\)/gi,
            '$1 "$2")',
          );
          xml = xml.replace(
            /(\(\s*(?:eq|ne)\s+pr_p_perform(?:e|ed)By(?:_(?:N|[1-5]))?)\s*&quot;([^"<]*?)&quot;\s*\)/gi,
            '$1 "$2")',
          );

          // (b) Fix `{{#ifFIELD}}` openers that are missing whitespace after
          //     `#if`. Limited to RE851D pr_li_(rem|ant)_* boolean fields used
          //     by the encumbrance balloon checkboxes (template authors wrote
          //     `{{#ifpr_li_ant_balloonYes_(N)_(S)}}`). Combined with the
          //     parenthesized-index normalization above, this resolves to a
          //     valid `{{#if pr_li_ant_balloonYes_N_S}}` opener.
          xml = xml.replace(
            /\{\{#if(pr_li_(?:rem|ant)_[A-Za-z]+(?:_(?:N|S|[1-5]))*)\s*\}\}/g,
            "{{#if $1}}",
          );

          // (c) Fix incomplete `{{/if}` (single trailing brace) — close it
          //     properly so the conditional evaluator can match the block
          //     and the safety-net stripper can consume any orphans. Only
          //     rewrite when the next character is NOT a `}` (i.e. it is
          //     genuinely missing the second brace, not a normal `{{/if}}`).
          xml = xml.replace(/\{\{\/if\}(?!\})/g, "{{/if}}");
          xml = xml.replace(/\{\{\/unless\}(?!\})/g, "{{/unless}}");

          // (d) Fix the `{{...}}` merge tags that lost their trailing brace,
          //     where the malformed bare RE851D encumbrance field is
          //     immediately followed by another `{{` opener (e.g.
          //     `{{pr_li_ant_priority_{N}_{S}}` followed by ` <w:t>` then
          //     `{{else}}`). After the `_{N}_{S}` → `_N_S` rewrite above,
          //     repair any single-brace tail that we can identify
          //     unambiguously (next non-space, non-`}` char is `<`).
          xml = xml.replace(
            /(\{\{pr_li_(?:rem|ant)_[A-Za-z]+(?:_(?:N|S|[1-5]))*)\}(?!\})/g,
            "$1}}",
          );

          // Strip leftover decorative "_(N)_(S)" / "_(N)" annotation labels
          // that some authored RE851D templates place after each encumbrance
          // field as a slot/property indicator. Step A above has already
          // rewritten any suffix that belonged to a real pr_li_(rem|ant)_<field>
          // identifier, so anything remaining is pure annotation prose.
          // Restrict to <w:t> bodies so XML tag/attribute syntax can never be
          // touched, and use [^<]*? so each strip stays inside one text run.
          xml = xml.replace(
            /(<w:t(?:\s[^>]*)?>)([^<]*?)_\(N\)_\(S\)([^<]*?)(<\/w:t>)/g,
            "$1$2$3$4",
          );
          xml = xml.replace(
            /(<w:t(?:\s[^>]*)?>)([^<]*?)_\(N\)([^<]*?)(<\/w:t>)/g,
            "$1$2$3$4",
          );
          xml = xml.replace(
            /(<w:t(?:\s[^>]*)?>)([^<]*?)_\{N\}_\{S\}([^<]*?)(<\/w:t>)/g,
            "$1$2$3$4",
          );
          xml = xml.replace(
            /(<w:t(?:\s[^>]*)?>)([^<]*?)_\{N\}([^<]*?)(<\/w:t>)/g,
            "$1$2$3$4",
          );

          // (e) RE851D placeholder identifier repair.
          //
          // The uploaded RE851D V12.x template carries identifiers that have
          // an embedded space inside the merge-tag identifier itself, e.g.
          //   {{ pr_p_squareFeet_ N }}
          //   {{ property_type_sfr_owner _N }}
          //   {{ pr_pt_actual_N_ glyph }}
          //   {{ pr_p_m ultipleProperties_no_glyph }}
          //   {{ propertytax.source _of_information_N }}
          //   {{ pr_li_sourceOfPayment_ N } }
          // Word splits these spans across multiple <w:r>/<w:t> runs at the
          // exact insertion point of the stray space. After normalizeWordXml
          // joined the runs, the whitespace survives and the merge-tag
          // resolver looks up "pr_p_squareFeet_ N" instead of
          // "pr_p_squareFeet_N", silently dropping every value.
          //
          // Repair scope: ONLY inside `{{ ... }}` bodies, ONLY between
          // identifier characters (letter/digit/underscore/dot), and ONLY
          // when the surrounding tag matches a known RE851D field family.
          // We scan with a bounded {{...}} window to avoid touching prose.
          xml = xml.replace(/\{\{([^{}]{1,240})\}\}/g, (full, body: string) => {
            // Quick reject: if there is no inner whitespace between identifier
            // chars, leave the body untouched (cheap exit for intact tags).
            if (!/[A-Za-z0-9_.]\s+[A-Za-z0-9_.]/.test(body)) return full;
            // Collapse whitespace that sits between two identifier chars.
            const collapsed = body.replace(
              /([A-Za-z0-9_.])\s+([A-Za-z0-9_.])/g,
              "$1$2",
            );
            return `{{${collapsed}}}`;
          });

          // (f) Repair `{{ identifier } }` (closing braces split by whitespace).
          // After (e) collapses inner identifier whitespace, the trailing
          // `} }` form sometimes survives because the gap is between the two
          // closing braces (not between identifier chars). Scoped to bodies
          // that look like RE851D placeholders (no spaces, identifier-only).
          xml = xml.replace(
            /\{\{(\s*[A-Za-z0-9_.]+\s*)\}\s+\}/g,
            "{{$1}}",
          );

          // (g) Repair `{{ identifier }` (single trailing brace, no second
          // brace at all) when the opener is on the same paragraph and the
          // body is identifier-only. Conservative: only fires when the next
          // few characters are XML markup or whitespace, never another `{`
          // or alphanumeric content.
          xml = xml.replace(
            /\{\{(\s*[A-Za-z0-9_.]+\s*)\}(?!\})(?=\s|<)/g,
            "{{$1}}",
          );

          // (h) RE851D lender vesting tag repair. The live template's
          // ACKNOWLEDGEMENT OF RECEIPT line has appeared with malformed brace
          // variants such as `{ld_p_vestin`, `{ld_p_vestin}`, and
          // `{{ld_p_vestin}`. These never reach the generic merge-tag parser,
          // so normalize only this legacy lender-vesting token inside text
          // runs before rendering. Layout XML and all other placeholders are
          // left untouched.
          xml = xml.replace(
            /(<w:t(?:\s[^>]*)?>)([^<]*ld_p_vestin[^<]*)(<\/w:t>)/g,
            (_m, open: string, body: string, close: string) => {
              let repaired = body.replace(
                /\{\{?\s*ld_p_vesting?\s*\}?\}?/g,
                "{{ld_p_vestin}}",
              );
              // Also handle the case where braces were stripped entirely
              // and the identifier is leaking as bare text (e.g. RE851D
              // ACKNOWLEDGEMENT OF RECEIPT line). Only fires when the
              // identifier is NOT already adjacent to a `{`/`}` (so we
              // never double-wrap a tag the previous branch just fixed).
              repaired = repaired.replace(
                /(^|[^{A-Za-z0-9_])ld_p_vestin(?:g)?(?![A-Za-z0-9_}])/g,
                "$1{{ld_p_vestin}}",
              );
              return `${open}${repaired}${close}`;
            },
          );

          if (!xml.includes("_N")) {
            out[filename] = encoder.encode(xml);
            continue;
          }

          // Detect region boundaries (only meaningful in word/document.xml,
          // but harmless to attempt elsewhere — anchors won't be present).
          let regions: ReturnType<typeof findAnchorOffsets>;
          try {
            regions = findAnchorOffsets(xml);
          } catch (e) {
            regions = { partA: null, partB: null, props: [] };
          }
          if (filename === "word/document.xml") {
            regionLog.push(
              `${filename}: PART1=${regions.partA ? `[${regions.partA[0]},${regions.partA[1]}]` : "none"}, ` +
              `PART2=${regions.partB ? `[${regions.partB[0]},${regions.partB[1]}]` : "none"}, ` +
              `PROPS=[${regions.props.map(p => `#${p.k}@[${p.range[0]},${p.range[1]}]`).join(", ")}]`
            );
          }

          // Per-region counters: regionId -> tag -> count
          const regionCounters = new Map<string, Map<string, number>>();
          const bumpRegion = (id: string) => {
            if (!regionRewriteCounts[id]) regionRewriteCounts[id] = 0;
            regionRewriteCounts[id]++;
          };
          const getRegionCounter = (id: string, tag: string): number => {
            let m = regionCounters.get(id);
            if (!m) { m = new Map(); regionCounters.set(id, m); }
            const next = (m.get(tag) || 0) + 1;
            m.set(tag, next);
            return next;
          };

          // Resolve which region contains a given character offset.
          // Returns { id, forcedIndex?, allowedTags? }.
          const resolveRegion = (offset: number): {
            id: string;
            forcedIndex: number | null;
            allowedTags: Set<string> | null;
          } => {
            // Property sections take precedence (they sit after PART 2).
            for (const p of regions.props) {
              if (offset >= p.range[0] && offset < p.range[1]) {
                return {
                  id: `PROP#${p.k}`,
                  forcedIndex: p.k,
                  allowedTags: new Set(RE851D_INDEXED_TAGS),
                };
              }
            }
            if (regions.partB && offset >= regions.partB[0] && offset < regions.partB[1]) {
              return {
                id: "PART2",
                forcedIndex: null,
                allowedTags: new Set(PART2_TAGS),
              };
            }
            if (regions.partA && offset >= regions.partA[0] && offset < regions.partA[1]) {
              return {
                id: "PART1",
                forcedIndex: null,
                allowedTags: new Set(PART1_TAGS),
              };
            }
            // RE851A is a single-property document with no PROPERTY #K anchors,
            // so encumbrance row tags (pr_li_(rem|ant)_*_N_S) would otherwise
            // fall into GLOBAL where the property index counter is shared with
            // the slot counter and the _N_S tags never get fanned out properly.
            // Treat the whole document as a synthetic PROP#1 so the per-region
            // slot counter increments per family in document order and the
            // forced property index resolves to 1, matching RE851D behavior
            // inside its single PROPERTY block. Strictly scoped to RE851A.
            if (isTemplate851A) {
              return {
                id: "RE851A_PROP#1",
                forcedIndex: 1,
                allowedTags: new Set(RE851D_INDEXED_TAGS),
              };
            }
            return { id: "GLOBAL", forcedIndex: null, allowedTags: null };
          };

          // Use exec-based scan so we can read each match's offset and decide
          // its region. Process tags longest-first to avoid prefix collisions
          // (e.g. "propertytax.delinquent_amount_N" before "...delinquent_N").
          // CPU optimization: pre-filter the tag list to only tags actually
          // present in the XML via a cheap substring scan. The full RE851D
          // tag list is ~180 entries and most are absent from any given
          // template — running a 4MB regex.exec for each absent tag is the
          // dominant CPU cost in the RE851D path. xml.includes() is O(n)
          // single-pass and avoids regex compilation/backtracking entirely.
          const tagsByLengthDesc = RE851D_INDEXED_TAGS
            .filter((t) => xml.includes(t))
            .sort((a, b) => b.length - a.length);
          // We collect all rewrites first, then apply them in reverse order so
          // earlier offsets remain valid. Each rewrite is (start, end, replacement).
          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          // Track consumed [start,end) ranges. Hot path uses a Set keyed by
          // start offset for O(1) lookup since the longest-first ordering
          // means overlapping shorter tags share the same start offset; the
          // array form is preserved for downstream passes that may add
          // arbitrary [s,e) ranges and need full overlap semantics.
          const consumed: Array<[number, number]> = [];
          const consumedStarts = new Set<number>();
          const isConsumed = (s: number, e: number): boolean => {
            if (consumedStarts.has(s)) return true;
            for (const [cs, ce] of consumed) {
              if (s < ce && e > cs) return true;
            }
            return false;
          };

          for (const tag of tagsByLengthDesc) {
            const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
            let m: RegExpExecArray | null;
            while ((m = re.exec(xml)) !== null) {
              const start = m.index;
              const end = start + m[0].length;
              // Hot-path fast check: longest-first ordering means any shorter
              // tag that overlaps a previously-rewritten longer tag will share
              // the same start offset, so the Set lookup is sufficient here.
              // (The full overlap-aware `isConsumed` is still used by the
              // downstream encumbrance/performBy passes that may add ranges
              // with arbitrary spans.)
              if (consumedStarts.has(start)) continue;
              const region = resolveRegion(start);
              // If the region restricts allowed tags and this tag isn't in the
              // allowlist, skip it (don't rewrite, don't consume the counter).
              if (region.allowedTags && !region.allowedTags.has(tag)) continue;

              let indexNum: number;
              if (region.forcedIndex !== null) {
                // PROPERTY #K: force every _N inside this block to _K.
                indexNum = region.forcedIndex;
                // Still bump the region counter so logs reflect activity.
                getRegionCounter(region.id, tag);
              } else if (region.id === "GLOBAL") {
                // Outside known regions: preserve previous global behavior.
                indexNum = (globalCounters.get(tag) || 0) + 1;
                globalCounters.set(tag, indexNum);
              } else {
                // PART1 / PART2: per-region running counter that resets at
                // the region boundary (each region has its own counter map).
                indexNum = getRegionCounter(region.id, tag);
              }

              let replacement: string;
              // Handle _N_S tags (per-property + per-slot, e.g. encumbrance rows).
              // The base regex matches the literal tag including _N_S, but the
              // _N$ replace below would leave it unchanged. Use a per-region,
              // per-family slot counter so successive rows in the same property
              // resolve to _K_1, _K_2, _K_3, ... in document order.
              if (/_N_S$/.test(tag)) {
                const family = tag.replace(/_N_S$/, "");
                const slot = getRegionCounter(region.id, `__slot_${family}`);
                if (indexNum > 5) {
                  replacement = tag.replace(/_N_S$/, `_overflow${indexNum}_${slot}`);
                } else {
                  replacement = tag.replace(/_N_S$/, `_${indexNum}_${slot}`);
                }
              } else {
                // Replace the property-index `_N` token. It may sit at the end
                // of the tag (e.g. `pr_li_sourceOfPayment_N`) OR in the middle
                // followed by a known glyph/yes/no suffix (e.g.
                // `pr_li_currentDelinqu_N_yes_glyph`). Without this middle-
                // position handling the glyph tags stay literal and the YES/NO
                // checkboxes never resolve.
                const idxToken = indexNum > 5 ? `_overflow${indexNum}` : `_${indexNum}`;
                // _N may sit in the middle when followed by a known suffix:
                //   _yes_glyph / _no_glyph / _yes / _no  (lien questionnaires)
                //   _glyph                                (pr_pt_actual_N_glyph,
                //                                          pr_pt_estimated_N_glyph)
                const middleSuffixRe = /_N(_yes_glyph|_no_glyph|_yes|_no|_glyph)$/;
                if (middleSuffixRe.test(tag)) {
                  replacement = tag.replace(middleSuffixRe, `${idxToken}$1`);
                } else {
                  replacement = tag.replace(/_N$/, idxToken);
                }
              }
              rewrites.push({ start, end, replacement });
              consumed.push([start, end]);
              consumedStarts.add(start);
              bumpRegion(region.id);
              totalRewrites++;
            }
          }

          // ── RE851D bare encumbrance-token rewrite ──
          // Some authored RE851D templates write encumbrance tags as bare text
          // (no {{ }} braces), so the merge-tag parser cannot resolve them and
          // they print verbatim. Substitute the resolved value directly inside
          // PROPERTY #K regions. Strictly limited to the encumbrance field
          // whitelist; nothing else in the document is touched.
          const encValueRegions = regions.props.length > 0
            ? regions.props
            : (isTemplate851A ? [{ k: 1, range: [0, xml.length] as [number, number] }] : []);
          if (encValueRegions.length > 0) {
            const encFields = [
              "priority", "interestRate", "interest_rate", "intRate",
              "beneficiary", "lienHolder", "holder",
              "originalAmount", "principalBalance",
              "monthlyPayment", "maturityDate", "maturity_date", "matDate",
              "balloonAmount",
              "balloonYes", "balloonNo", "balloonUnknown",
              "amountOwing", "amount_owing",
            ];
            const encTagRe = new RegExp(
              "\\bpr_li_(rem|ant)_(" + encFields.join("|") + ")(?:_(?:N|[1-5])(?:_(?:S|[1-9][0-9]*))?(?:_\\{S\\})?)?(?![A-Za-z0-9_])",
              "g",
            );
            const mergeTagContext = (offset: number): "curly" | "chevron" | null => {
              const lastCurlyOpen = xml.lastIndexOf("{{", offset);
              const lastCurlyClose = xml.lastIndexOf("}}", offset);
              if (lastCurlyOpen > lastCurlyClose) return "curly";
              const lastChevronOpen = xml.lastIndexOf("«", offset);
              const lastChevronClose = xml.lastIndexOf("»", offset);
              if (lastChevronOpen > lastChevronClose) return "chevron";
              return null;
            };
            let m2: RegExpExecArray | null;
            while ((m2 = encTagRe.exec(xml)) !== null) {
              const start = m2.index;
              const end = start + m2[0].length;
              if (isConsumed(start, end)) continue;
              const region = encValueRegions.find((p) => start >= p.range[0] && start < p.range[1]);
              if (!region) continue;
              const pIdx = region.k;
              const family = `${m2[1]}_${m2[2]}`;
              const slot = getRegionCounter(region.id, `__enc_${family}`);
              const lookupKey = `pr_li_${family}_${pIdx}_${slot}`;
              const v = fieldValues.get(lookupKey)
                || fieldValues.get(`pr_li_${family}_${pIdx}`);
              const context = mergeTagContext(start);
              if (context) {
                rewrites.push({ start, end, replacement: lookupKey });
              } else {
                let rendered = "";
                if (v && v.rawValue !== null && v.rawValue !== undefined) {
                  rendered = formatByDataType(v.rawValue, v.dataType, lookupKey);
                  if (v.dataType === "currency" && rendered.startsWith("$")) {
                    rendered = rendered.substring(1);
                  }
                }
                rewrites.push({ start, end, replacement: escapeXmlValue(rendered) });
              }
              consumed.push([start, end]);
              bumpRegion(region.id);
              totalRewrites++;
            }
          }

          // ── RE851D appraiser conditional → merge-tag rewrite ──
          // The authored RE851D template contains:
          //   {{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{/if}}
          //   {{#if (eq pr_p_performeBy_N "Broker")}}N/A{{/if}}
          // Our renderer prints these raw because (a) the literal `_N` survives
          // and (b) the conditional helper does not always evaluate cleanly.
          // We pre-publish per-property `pr_p_appraiserName_K` /
          // `pr_p_appraiserAddress_K` values upstream; here we replace the entire
          // {{#if … }}…{{/if}} block with the corresponding plain merge tag,
          // anchored to the PROPERTY #K region the match sits in. Strictly
          // scoped: only matches the two literal payloads ("BPO Performed by
          // Broker" and "N/A") so unrelated conditionals are never touched.
          {
            const apprCondRe = /\{\{\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(?:N|[1-5])\s*"\s*Broker\s*"\s*\)\s*\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?(?:\{\{\s*\/\s*if\s*\}\}|\{\{\s*\/\s*if\s*\}(?!\}))/g;
            let acm: RegExpExecArray | null;
            let appraiserBlocksRewritten = 0;
            const appraiserPairCounter: Record<"name" | "addr", number> = { name: 0, addr: 0 };
            while ((acm = apprCondRe.exec(xml)) !== null) {
              const fullStart = acm.index;
              const fullEnd = fullStart + acm[0].length;
              if (isConsumed(fullStart, fullEnd)) continue;
              const payload = String(acm[1] || "").replace(/<[^>]+>/g, "").trim();
              const elsePayload = String(acm[2] || "").replace(/<[^>]+>/g, "").trim();
              // Safe-by-default: only rewrite when else branch is empty/missing,
              // so a future non-empty else is never silently dropped.
              if (elsePayload !== "") continue;
              let kind: "name" | "addr" | null = null;
              if (/^BPO Performed by Broker$/i.test(payload)) kind = "name";
              else if (/^N\/A$/i.test(payload)) kind = "addr";
              if (kind === null) continue;
              // Determine PROPERTY #K by region; fall back to occurrence order.
              let pIdx: number | null = null;
              for (const p of regions.props) {
                if (fullStart >= p.range[0] && fullStart < p.range[1]) {
                  pIdx = p.k;
                  break;
                }
              }
              if (pIdx === null) {
                appraiserPairCounter[kind] += 1;
                pIdx = Math.min(Math.max(appraiserPairCounter[kind], 1), 5);
              }
              const tagBase = kind === "name" ? "pr_p_appraiserName" : "pr_p_appraiserAddress";
              rewrites.push({
                start: fullStart,
                end: fullEnd,
                replacement: `{{${tagBase}_${pIdx}}}`,
              });
              consumed.push([fullStart, fullEnd]);
              totalRewrites++;
              appraiserBlocksRewritten++;
            }
            if (appraiserBlocksRewritten > 0) {
              try {
                debugLog(`[generate-document] RE851D appraiser conditional rewrite: ${appraiserBlocksRewritten} {{#if pr_p_performeBy_N}} block(s) replaced with appraiserName/Address merge tags`);
              } catch (_) { /* ignore */ }
            }
          }

          // ── RE851D appraiser conditional → TOLERANT fallback rewrite ──
          // Production templates have been observed leaking the conditional
          // into rendered output as raw text with missing/partial braces,
          // e.g. `#if (eq pr_p_performeBy_1 "Broker")N/A{{else}}{{/if}}` —
          // the opener `{{` and the `}}` after `)` are gone (stripped by an
          // upstream brace-repair pass or split across <w:r> runs Word can't
          // recombine). The strict matcher above never fires for these.
          //
          // This tolerant pass anchors on the recognized payload (exactly
          // "N/A" or "BPO Performed by Broker") and accepts the opener with
          // OR without `{{`/`}}`, and the closer as `{{/if}}`, `{{else}}{{/if}}`,
          // or missing entirely. Strictly scoped to the appraiser payloads
          // so unrelated conditionals are never touched.
          {
            const Q = `(?:"|&quot;|\\u201C|\\u201D)`;
            const apprTolRe = new RegExp(
              `(?:\\{\\{)?\\s*#\\s*if\\s*\\(\\s*eq\\s+pr_p_perform(?:e|ed)By_(?:N|[1-5])\\s*${Q}\\s*Broker\\s*${Q}\\s*\\)\\s*(?:\\}\\})?\\s*(N\\/A|BPO Performed by Broker)\\s*(?:\\{\\{\\s*else\\s*\\}\\}\\s*)?(?:\\{\\{\\s*\\/\\s*if\\s*\\}\\}|\\{\\{\\s*\\/\\s*if\\s*\\}(?!\\}))?`,
              "gi",
            );
            let tm: RegExpExecArray | null;
            let tolRewrites = 0;
            const tolCounter: Record<"name" | "addr", number> = { name: 0, addr: 0 };
            while ((tm = apprTolRe.exec(xml)) !== null) {
              const fullStart = tm.index;
              const fullEnd = fullStart + tm[0].length;
              if (isConsumed(fullStart, fullEnd)) continue;
              const payload = String(tm[1] || "").trim();
              let kind: "name" | "addr" | null = null;
              if (/^BPO Performed by Broker$/i.test(payload)) kind = "name";
              else if (/^N\/A$/i.test(payload)) kind = "addr";
              if (kind === null) continue;
              // Resolve PROPERTY #K by region; fall back to per-kind order.
              let pIdx: number | null = null;
              for (const p of regions.props) {
                if (fullStart >= p.range[0] && fullStart < p.range[1]) {
                  pIdx = p.k;
                  break;
                }
              }
              if (pIdx === null) {
                tolCounter[kind] += 1;
                pIdx = Math.min(Math.max(tolCounter[kind], 1), 5);
              }
              const tagBase = kind === "name" ? "pr_p_appraiserName" : "pr_p_appraiserAddress";
              rewrites.push({
                start: fullStart,
                end: fullEnd,
                replacement: `{{${tagBase}_${pIdx}}}`,
              });
              consumed.push([fullStart, fullEnd]);
              totalRewrites++;
              tolRewrites++;
            }
            if (tolRewrites > 0) {
              try {
                debugLog(`[generate-document] RE851D appraiser conditional TOLERANT rewrite: ${tolRewrites} brace-less/partial block(s) collapsed to merge tags`);
              } catch (_) { /* ignore */ }
            }
          }

          // ── RE851D pr_p_performeBy_N targeted safety rewrite ──
          // Some authored RE851D templates split the
          // `{{#if (eq pr_p_performeBy_N "Broker")}}` opener across multiple
          // <w:r> runs. After normalizeWordXml the literal `pr_p_performeBy_N`
          // is contiguous again, but if a glyph/whitespace artifact prevented
          // the main region rewriter from matching it, the literal `_N` survives
          // and the resolver falls back via canonical_key to the bare
          // `pr_p_performeBy` field — which holds property #1's value, causing
          // every PROPERTY block to render Broker's BPO/N/A lines.
          // This pass scans for ANY remaining literal occurrences (both the
          // canonical and legacy-misspelled aliases) and rewrites _N -> _K
          // based on the PROPERTY region the offset sits in. If the offset is
          // outside all detected PROPERTY ranges (shouldn't happen given the
          // log shows all 5 detected, but defensive), fall back to occurrence
          // pair index (occurrences 1+2 -> property 1, 3+4 -> property 2, ...).
          {
            const performByTagRe = /\bpr_p_perform(?:e|ed)By_N\b/g;
            const literalHits: Array<{ start: number; end: number; matched: string }> = [];
            let pm: RegExpExecArray | null;
            while ((pm = performByTagRe.exec(xml)) !== null) {
              const s = pm.index;
              const e = s + pm[0].length;
              if (isConsumed(s, e)) continue;
              literalHits.push({ start: s, end: e, matched: pm[0] });
            }
            if (literalHits.length > 0) {
              let pairCounter = 0;
              let lastPropOfPair = 0;
              for (const hit of literalHits) {
                let pIdx: number | null = null;
                for (const p of regions.props) {
                  if (hit.start >= p.range[0] && hit.start < p.range[1]) {
                    pIdx = p.k;
                    break;
                  }
                }
                if (pIdx === null) {
                  // Pair fallback: 1st & 2nd literal -> property 1, etc.
                  pairCounter++;
                  const pair = Math.ceil(pairCounter / 2);
                  pIdx = Math.min(Math.max(pair, 1), 5);
                  lastPropOfPair = pIdx;
                }
                const replacement = hit.matched.replace(/_N$/, `_${pIdx}`);
                rewrites.push({ start: hit.start, end: hit.end, replacement });
                consumed.push([hit.start, hit.end]);
                totalRewrites++;
              }
              try {
                debugLog(`[generate-document] RE851D performBy targeted rewrite: ${literalHits.length} literal _N occurrence(s) reindexed`);
              } catch (_) { /* ignore */ }
            }
          }

          // ── RE851D contextual bare-tag rewrite ──
          // The uploaded RE851D template contains bare (non-_N) tags inside
          // some PROPERTY #K detail sections, e.g.
          //   PROPERTY #2 AGE  -> {{ pr_p_yearBuilt}}
          //   PROPERTY #3 SQUARE FEET -> {{pr_p_squareFeet}}
          //   {{#if propertytax.delinquent}}
          // Without rewriting, these resolve against Property #1's data
          // (or empty) regardless of which PROPERTY #K block they sit in.
          // Strictly scoped to the detected PROPERTY #K ranges.
          if (regions.props.length > 0) {
            const BARE_TAGS = [
              "pr_p_yearBuilt",
              "pr_p_squareFeet",
              "pr_p_appraiseValue",
              "pr_p_appraiseDate",
              "pr_p_construcType",
              "pr_p_descript",
              "pr_p_address",
              "pr_p_occupanc",
              "propertytax.annual_payment",
              "propertytax.delinquent_amount",
              "propertytax.source_of_information",
              "propertytax.delinquent",
            ];
            const isInRewriteSpan = (s: number, e: number): boolean => {
              for (const r of rewrites) {
                if (s < r.end && e > r.start) return true;
              }
              return false;
            };
            // Sort longest-first so dotted longer keys win over shorter prefixes.
            const bareSorted = [...BARE_TAGS].sort((a, b) => b.length - a.length);
            for (const p of regions.props) {
              for (const tag of bareSorted) {
                // Match the bare token only when it is NOT already followed by _<digit>
                // (so we don't double-rewrite tags that already have a numeric suffix).
                const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp(`${escaped}(?!_\\d|[A-Za-z0-9_])`, "g");
                let m: RegExpExecArray | null;
                while ((m = re.exec(xml)) !== null) {
                  const start = m.index;
                  const end = start + m[0].length;
                  if (start < p.range[0] || end > p.range[1]) continue;
                  if (isInRewriteSpan(start, end)) continue;
                  rewrites.push({
                    start,
                    end,
                    replacement: `${tag}_${p.k}`,
                  });
                  totalRewrites++;
                  if (!regionRewriteCounts[`PROP#${p.k}`]) regionRewriteCounts[`PROP#${p.k}`] = 0;
                  regionRewriteCounts[`PROP#${p.k}`]++;
                }
              }
            }
          }

          // ── RE851D "Do any of these payments remain unpaid?" YES/NO safety pass ──
          // The authored template uses two static ☐ glyph runs after this question
          // and (depending on variant) either no conditional or a non-strict one,
          // so both checkboxes can render checked. Anchor the next two glyph runs
          // following the question text to the per-property pr_li_currentDelinqu_K
          // boolean: YES = ☑ when true / ☐ when false; NO is the inverse.
          // Strictly scoped to detected PROPERTY #K regions; bounded look-ahead.
          if (regions.props.length > 0) {
            const questionRe = /Do any of these payments remain unpaid/gi;
            const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
            let qm: RegExpExecArray | null;
            while ((qm = questionRe.exec(xml)) !== null) {
              const qStart = qm.index;
              // Determine which PROPERTY #K block this question lives in.
              let pIdx: number | null = null;
              for (const p of regions.props) {
                if (qStart >= p.range[0] && qStart < p.range[1]) {
                  pIdx = p.k;
                  break;
                }
              }
              if (pIdx === null) continue;
              // Bounded look-ahead window (4 KB) to find the two glyph runs.
              const windowEnd = Math.min(xml.length, qStart + 4096);
              glyphRunRe.lastIndex = qStart;
              const glyphMatches: RegExpExecArray[] = [];
              let gm: RegExpExecArray | null;
              while ((gm = glyphRunRe.exec(xml)) !== null && gm.index < windowEnd) {
                glyphMatches.push(gm);
                if (glyphMatches.length >= 2) break;
              }
              if (glyphMatches.length < 2) continue;
              // Skip if either glyph already overlaps a queued rewrite span.
              const overlaps = (s: number, e: number) =>
                rewrites.some((r) => s < r.end && e > r.start) ||
                consumed.some(([cs, ce]) => s < ce && e > cs);
              const yesM = glyphMatches[0];
              const noM = glyphMatches[1];
              const yesStart = yesM.index;
              const yesEnd = yesStart + yesM[0].length;
              const noStart = noM.index;
              const noEnd = noStart + noM[0].length;
              if (overlaps(yesStart, yesEnd) || overlaps(noStart, noEnd)) continue;
              // Resolve the per-property boolean.
              const truthy = (raw: unknown): boolean => {
                if (raw === null || raw === undefined) return false;
                if (typeof raw === "boolean") return raw;
                if (typeof raw === "number") return raw !== 0;
                const s = String(raw).trim().toLowerCase();
                return ["true", "yes", "y", "1", "checked", "on"].includes(s);
              };
              const yesAlias = fieldValues.get(`pr_li_remainUnpaid_${pIdx}_yes`);
              const bareAlias = fieldValues.get(`pr_li_remainUnpaid_${pIdx}`);
              const isYes = yesAlias
                ? truthy(yesAlias.rawValue)
                : truthy(bareAlias?.rawValue);
              const yesGlyph = isYes ? "☑" : "☐";
              const noGlyph = isYes ? "☐" : "☑";
              rewrites.push({
                start: yesStart,
                end: yesEnd,
                replacement: `${yesM[1]}${yesGlyph}${yesM[3]}`,
              });
              rewrites.push({
                start: noStart,
                end: noEnd,
                replacement: `${noM[1]}${noGlyph}${noM[3]}`,
              });
              consumed.push([yesStart, yesEnd]);
              consumed.push([noStart, noEnd]);
              totalRewrites += 2;
              if (!regionRewriteCounts[`PROP#${pIdx}`]) regionRewriteCounts[`PROP#${pIdx}`] = 0;
              regionRewriteCounts[`PROP#${pIdx}`] += 2;
              debugLog(
                `[generate-document] RE851D remain-unpaid YES/NO anchored: PROP#${pIdx} isYes=${isYes}`
              );
            }
          }

          // ── RE851D "Are there multiple properties on the loan?" YES/NO safety pass ──
          // Global (NOT per-property region). Anchors the next two glyph runs
          // following the question text to property count: >1 → YES ☑ NO ☐;
          // ==1 → YES ☐ NO ☑. The merge-tag publisher
          // (pr_p_multipleProperties_*_glyph) remains primary; this pass only
          // fires when the next two glyph runs are still raw ☐/☑/☑.
          {
            const PRESENCE = ["address", "street", "city", "state", "zip", "county", "legal_description"];
            const propCount = [...propertyIndices]
              .sort((a, b) => a - b)
              .slice(0, 5)
              .filter((idx) => PRESENCE.some((f) => {
                const v = fieldValues.get(`property${idx}.${f}`)?.rawValue;
                return v !== undefined && v !== null && String(v).trim() !== "";
              })).length;
            const isMultipleQ = propCount > 1;
            const multiQRe = /Are there multiple properties on the loan/gi;
            const multiGlyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
            let mqm: RegExpExecArray | null;
            while ((mqm = multiQRe.exec(xml)) !== null) {
              const qStart = mqm.index;
              const windowEnd = Math.min(xml.length, qStart + 4096);
              multiGlyphRunRe.lastIndex = qStart;
              const matches: RegExpExecArray[] = [];
              let mgm: RegExpExecArray | null;
              while ((mgm = multiGlyphRunRe.exec(xml)) !== null && mgm.index < windowEnd) {
                matches.push(mgm);
                if (matches.length >= 2) break;
              }
              if (matches.length < 2) continue;
              const overlapsM = (s: number, e: number) =>
                rewrites.some((r) => s < r.end && e > r.start) ||
                consumed.some(([cs, ce]) => s < ce && e > cs);
              const yMm = matches[0];
              const nMm = matches[1];
              const ysM = yMm.index;
              const yeM = ysM + yMm[0].length;
              const nsM = nMm.index;
              const neM = nsM + nMm[0].length;
              if (overlapsM(ysM, yeM) || overlapsM(nsM, neM)) continue;
              const yGlyph = isMultipleQ ? "☑" : "☐";
              const nGlyph = isMultipleQ ? "☐" : "☑";
              rewrites.push({
                start: ysM,
                end: yeM,
                replacement: `${yMm[1]}${yGlyph}${yMm[3]}`,
              });
              rewrites.push({
                start: nsM,
                end: neM,
                replacement: `${nMm[1]}${nGlyph}${nMm[3]}`,
              });
              consumed.push([ysM, yeM]);
              consumed.push([nsM, neM]);
              totalRewrites += 2;
              debugLog(
                `[generate-document] RE851D multiple-properties YES/NO anchored: count=${propCount} isMultiple=${isMultipleQ}`
              );
            }
          }

          // ── RE851D ANNUAL PROPERTY TAXES ACTUAL/ESTIMATED safety pass ──
          // For each PROPERTY #K block, locate the "ANNUAL PROPERTY TAX(ES)"
          // anchor and force the next two checkbox glyph runs (typically
          // before the labels "ACTUAL" and "ESTIMATED") based on per-property
          // tax confidence:
          //   confidence === Actual    → ACTUAL ☑  ESTIMATED ☐
          //   confidence === Estimated → ACTUAL ☐  ESTIMATED ☑
          //   blank/other              → both ☐
          // Bounded look-ahead (4 KB). Skips any glyph already overlapping a
          // queued rewrite span so this never collides with the merge-tag
          // publisher when the template uses {{pr_pt_actual_K_glyph}} /
          // {{pr_pt_estimated_K_glyph}} directly.
          if (regions.props.length > 0) {
            const taxAnchorRe = /ANNUAL\s+PROPERTY\s+TAX/gi;
            const taxGlyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☒])(<\/w:t>\s*<\/w:r>)/g;
            let tqm: RegExpExecArray | null;
            while ((tqm = taxAnchorRe.exec(xml)) !== null) {
              const qStart = tqm.index;
              let pIdxT: number | null = null;
              for (const p of regions.props) {
                if (qStart >= p.range[0] && qStart < p.range[1]) { pIdxT = p.k; break; }
              }
              if (pIdxT === null) continue;
              const windowEnd = Math.min(xml.length, qStart + 4096);
              taxGlyphRunRe.lastIndex = qStart;
              const tgms: RegExpExecArray[] = [];
              let tgm: RegExpExecArray | null;
              while ((tgm = taxGlyphRunRe.exec(xml)) !== null && tgm.index < windowEnd) {
                tgms.push(tgm);
                if (tgms.length >= 2) break;
              }
              if (tgms.length < 2) continue;
              const overlapsT = (s: number, e: number) =>
                rewrites.some((r) => s < r.end && e > r.start) ||
                consumed.some(([cs, ce]) => s < ce && e > cs);
              const aMt = tgms[0];
              const eMt = tgms[1];
              const aS = aMt.index, aE = aS + aMt[0].length;
              const eS = eMt.index, eE = eS + eMt[0].length;
              if (overlapsT(aS, aE) || overlapsT(eS, eE)) continue;
              const truthyT = (raw: unknown): boolean => {
                if (raw === null || raw === undefined) return false;
                if (typeof raw === "boolean") return raw;
                const s = String(raw).trim().toLowerCase();
                return ["true", "yes", "y", "1", "checked", "on"].includes(s);
              };
              const isActualK = truthyT(fieldValues.get(`pr_pt_actual_${pIdxT}`)?.rawValue);
              const isEstK = truthyT(fieldValues.get(`pr_pt_estimated_${pIdxT}`)?.rawValue);
              const aGlyph = isActualK ? "☑" : "☐";
              const eGlyph = isEstK ? "☑" : "☐";
              rewrites.push({ start: aS, end: aE, replacement: `${aMt[1]}${aGlyph}${aMt[3]}` });
              rewrites.push({ start: eS, end: eE, replacement: `${eMt[1]}${eGlyph}${eMt[3]}` });
              consumed.push([aS, aE]);
              consumed.push([eS, eE]);
              totalRewrites += 2;
              debugLog(
                `[RE851D] annual-tax glyph anchored: PROP#${pIdxT} actual=${isActualK} estimated=${isEstK}`
              );
            }
          }

          // ── RE851D Owner-Occupied YES/NO safety pass ──
          // Anchor each glyph rewrite to the actual "Yes" / "No" label run that
          // follows the "OWNER OCCUPIED" question. We pick the checkbox glyph
          // run immediately PRECEDING each label so an unrelated glyph (e.g.
          // already-rendered conditional output, or a sibling property-type
          // checkbox) cannot be flipped. Strictly per PROPERTY #K region.
          // "Owner Occupied" => YES ☑ / NO ☐; anything else (Tenant / Other,
          // Vacant, NA, empty) => YES ☐ / NO ☑.
          if (regions.props.length > 0) {
            const ownerOccRe = /Owner[\s\u00A0\-]?Occupied/gi;
            const glyphRunRe2 = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
            // Match a "Yes" or "No" label sitting alone (or with surrounding
            // whitespace) inside a single <w:t>…</w:t> run. We anchor on these
            // text runs to find the immediately-preceding glyph run.
            const yesLabelRe = /<w:t(?:\s[^>]*)?>\s*Yes\s*<\/w:t>/gi;
            const noLabelRe = /<w:t(?:\s[^>]*)?>\s*No\s*<\/w:t>/gi;
            const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start) ||
              consumed.some(([cs, ce]) => s < ce && e > cs);

            // For a given label position, find the nearest preceding glyph run
            // start within `maxBack` chars. Returns null if none found.
            const findGlyphBefore = (
              labelStart: number,
              regionStart: number,
            ): RegExpExecArray | null => {
              const maxBack = 1024;
              const scanStart = Math.max(regionStart, labelStart - maxBack);
              const slice = xml.slice(scanStart, labelStart);
              let last: RegExpExecArray | null = null;
              const re = new RegExp(glyphRunRe2.source, "g");
              let gm: RegExpExecArray | null;
              while ((gm = re.exec(slice)) !== null) last = gm;
              if (!last) return null;
              // Re-anchor offsets back to the full xml.
              const absIndex = scanStart + last.index;
              const fake: RegExpExecArray = Object.assign(
                [last[0], last[1], last[2], last[3]] as unknown as RegExpExecArray,
                { index: absIndex, input: xml, groups: undefined },
              );
              return fake;
            };

            let om: RegExpExecArray | null;
            while ((om = ownerOccRe.exec(xml)) !== null) {
              const qStart = om.index;
              let pRange: [number, number] | null = null;
              let pIdx: number | null = null;
              for (const p of regions.props) {
                if (qStart >= p.range[0] && qStart < p.range[1]) {
                  pIdx = p.k;
                  pRange = p.range;
                  break;
                }
              }
              if (pIdx === null || pRange === null) continue;

              // Bounded look-ahead window for the Yes / No labels.
              const windowEnd = Math.min(pRange[1], qStart + 2048);
              const windowText = stripTags(xml.slice(qStart, windowEnd));
              if (!/\bYes\b/.test(windowText) || !/\bNo\b/.test(windowText)) continue;

              // Find the first standalone "Yes" / "No" label runs after the
              // OWNER OCCUPIED label, capped at the property region.
              yesLabelRe.lastIndex = qStart;
              noLabelRe.lastIndex = qStart;
              const yesLabel = yesLabelRe.exec(xml);
              const noLabel = noLabelRe.exec(xml);
              if (!yesLabel || !noLabel) continue;
              if (yesLabel.index >= windowEnd || noLabel.index >= windowEnd) continue;

              const yesM = findGlyphBefore(yesLabel.index, qStart);
              const noM = findGlyphBefore(noLabel.index, qStart);
              if (!yesM || !noM) continue;
              if (yesM.index === noM.index) continue;

              const yesStart = yesM.index;
              const yesEnd = yesStart + yesM[0].length;
              const noStart = noM.index;
              const noEnd = noStart + noM[0].length;
              if (overlaps(yesStart, yesEnd) || overlaps(noStart, noEnd)) continue;

              const occVal = String(
                fieldValues.get(`pr_p_occupanc_${pIdx}`)?.rawValue ??
                  (pIdx === 1 ? fieldValues.get("pr_p_occupanc")?.rawValue : "") ??
                  "",
              ).trim().toLowerCase();
              // Strict match: only the exact CSR value "Owner Occupied" maps to YES.
              // Tenant / Other, Vacant, NA, blank, or any other value -> NO.
              const isOwner = occVal === "owner occupied";
              const yesGlyph = isOwner ? "☑" : "☐";
              const noGlyph = isOwner ? "☐" : "☑";
              rewrites.push({ start: yesStart, end: yesEnd, replacement: `${yesM[1]}${yesGlyph}${yesM[3]}` });
              rewrites.push({ start: noStart, end: noEnd, replacement: `${noM[1]}${noGlyph}${noM[3]}` });
              consumed.push([yesStart, yesEnd]);
              consumed.push([noStart, noEnd]);
              totalRewrites += 2;
              if (!regionRewriteCounts[`PROP#${pIdx}`]) regionRewriteCounts[`PROP#${pIdx}`] = 0;
              regionRewriteCounts[`PROP#${pIdx}`] += 2;
              debugLog(
                `[generate-document] RE851D owner-occupied YES/NO label-anchored: PROP#${pIdx} isOwner=${isOwner}`
              );
            }
          }

          // Apply rewrites in reverse offset order so earlier offsets are stable.
          rewrites.sort((a, b) => b.start - a.start);
          for (const r of rewrites) {
            xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
          }

          out[filename] = encoder.encode(xml);
        }

        if (totalRewrites > 0) {
          templateBuffer = new Uint8Array(fflate.zipSync(out, { level: 0 }));
          debugLog(
            `[generate-document] RE851D regions: ${regionLog.join(" | ")}; ` +
            `rewrites per region: ${
              Object.entries(regionRewriteCounts).map(([k, v]) => `${k}=${v}`).join(", ")
            }; total=${totalRewrites}`
          );
        }
      } catch (err) {
        console.error(
          `[generate-document] RE851D _N preprocessing failed (continuing with original template):`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // ── RE851D: seed suffixed _N keys into validFieldKeys ──
    // The merge resolver's priority-1 direct match uses validFieldKeys, which is
    // built only from field_dictionary.field_key + canonical_key. Suffixed keys
    // like ln_p_expectedEncumbrance_1..5 are never in the dictionary, so the
    // resolver falls through to fallbacks. Seeding them here forces priority-1
    // direct match and removes any chance of the resolver returning a different
    // ultimate key for our publisher-set values. Template-gated.
    let effectiveValidFieldKeys = validFieldKeys;
    if (isEncumbrancePipeline) {
      effectiveValidFieldKeys = new Set(validFieldKeys);
      const SUFFIXED_BASES = [
        "ln_p_expectedEncumbrance", "ln_p_remainingEncumbrance",
        "pr_p_expectedSenior", "pr_p_remainingSenior",
        "pr_p_totalEncumbrance", "pr_p_totalSenior", "pr_p_totalSeniorPlusLoan",
        "ln_p_totalEncumbrance", "ln_p_totalWithLoan", "ln_p_amountOfEquity", "ln_p_loanToValueRatio",
        "property_number",
        // Per-property "Performed By" — both canonical and legacy-misspelled
        // aliases so the conditional resolver does an exact direct match per
        // PROPERTY #K block and never falls back to the unsuffixed field.
        "pr_p_performedBy", "pr_p_performeBy",
        "pr_p_appraiserName", "pr_p_appraiserAddress",
        // Property identity / detail families used by RE851D PROPERTY #K blocks.
        "pr_p_address", "pr_p_street", "pr_p_city", "pr_p_state",
        "pr_p_zip", "pr_p_county", "pr_p_country", "pr_p_apn",
        "pr_p_owner", "pr_p_ownerName", "pr_p_marketValue", "pr_p_appraiseValue",
        "pr_p_appraiseDate", "pr_p_legalDescri", "pr_p_yearBuilt",
        "pr_p_squareFeet", "pr_p_lotSize", "pr_p_numberOfUni",
        "pr_p_propertyTyp", "pr_p_propertyType", "pr_p_occupancySt",
        "pr_p_occupanc", "pr_p_construcType", "pr_p_purchasePrice",
        "pr_p_downPayme", "pr_p_protectiveEquity", "pr_p_descript",
        "pr_p_ltv", "pr_p_cltv", "pr_p_zoning", "pr_p_floodZone",
        "pr_p_pledgedEquity", "pr_p_delinquHowMany",
        // Property tax per-property aliases (both underscore and dotted forms).
        "propertytax_annual_payment", "propertytax.annual_payment",
        "propertytax_delinquent", "propertytax.delinquent",
        "propertytax_delinquent_amount", "propertytax.delinquent_amount",
        "propertytax_source_of_information", "propertytax.source_of_information",
        // RE851D ANNUAL PROPERTY TAXES per-property publisher aliases. Without
        // these, suffixed keys like pr_pt_annualTaxes_1 / pr_pt_actual_1_glyph
        // miss the resolver's priority-1 direct match and fall back to the
        // bare dictionary entry, blanking the value in the rendered DOCX.
        "pr_pt_annualTaxes",
        "pr_pt_actual", "pr_pt_actual_glyph",
        "pr_pt_estimated", "pr_pt_estimated_glyph",
        "pr_pt_delinquent_yes_glyph", "pr_pt_delinquent_no_glyph",
        "pr_pt_delinquentAmount", "pr_pt_delinquent",
        // Lien-derived per-property aliases used by the questionnaire blocks.
        "pr_li_delinquencyPaidByLoan", "pr_li_delinquencyPaidByLoan_yes",
        "pr_li_delinquencyPaidByLoan_no", "pr_li_delinquencyPaidByLoan_yes_glyph",
        "pr_li_delinquencyPaidByLoan_no_glyph",
        "pr_li_delinqu60day", "pr_li_delinqu60day_yes",
        "pr_li_delinqu60day_no", "pr_li_delinqu60day_yes_glyph",
        "pr_li_delinqu60day_no_glyph",
        "pr_li_currentDelinqu", "pr_li_currentDelinqu_yes",
        "pr_li_currentDelinqu_no", "pr_li_currentDelinqu_yes_glyph",
        "pr_li_currentDelinqu_no_glyph",
        "pr_li_delinquHowMany", "pr_li_sourceOfPayment",
        "pr_li_encumbranceOfRecord", "pr_li_encumbranceOfRecord_yes",
        "pr_li_encumbranceOfRecord_no", "pr_li_encumbranceOfRecord_yes_glyph",
        "pr_li_encumbranceOfRecord_no_glyph",
      ];
      for (let i = 1; i <= 5; i++) {
        for (const base of SUFFIXED_BASES) {
          effectiveValidFieldKeys.add(`${base}_${i}`);
        }
      }
      // RE851D Encumbrance Remaining/Anticipated: per-property + per-slot keys
      // so the resolver's priority-1 direct match returns publisher-set values
      // (publisher emits these at lines ~2528–2592).
      const ENC_REM_BASES = [
        "pr_li_rem_priority", "pr_li_rem_interestRate", "pr_li_rem_interest_rate", "pr_li_rem_intRate",
        "pr_li_rem_beneficiary", "pr_li_rem_lienHolder", "pr_li_rem_holder",
        "pr_li_rem_originalAmount", "pr_li_rem_principalBalance", "pr_li_rem_monthlyPayment",
        "pr_li_rem_maturityDate", "pr_li_rem_maturity_date", "pr_li_rem_matDate",
        "pr_li_rem_balloonAmount", "pr_li_rem_balloonYes", "pr_li_rem_balloonNo", "pr_li_rem_balloonUnknown",
        "pr_li_rem_amountOwing", "pr_li_rem_amount_owing", "pr_li_rem_amount", "pr_li_rem_owing",
      ];
      const ENC_ANT_BASES = ENC_REM_BASES.map(b => b.replace("pr_li_rem_", "pr_li_ant_"));
      for (let p = 1; p <= 5; p++) {
        for (const base of [...ENC_REM_BASES, ...ENC_ANT_BASES]) {
          effectiveValidFieldKeys.add(`${base}_${p}`);
          for (let s = 1; s <= 10; s++) {
            effectiveValidFieldKeys.add(`${base}_${p}_${s}`);
          }
        }
      }
    }

    let processedDocx: Uint8Array;
    const tRenderStart = performance.now();
    try {
      processedDocx = await processDocx(templateBuffer, fieldValues, fieldTransforms, mergeTagMap, effectiveLabelMap, effectiveValidFieldKeys, { templateName: template.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface DOCX integrity failures as a real generation failure rather
      // than uploading a corrupted file that Word will refuse to open.
      if (message.startsWith("DOCX_INTEGRITY")) {
        console.error(`[generate-document] DOCX integrity check failed for template ${templateId}: ${message}`);
        result.error = `Generated document failed integrity check (${message.replace(/^DOCX_INTEGRITY:\s*/, "")}). Please review the template for unbalanced tags or invalid placeholders.`;
        return result;
      }
      throw err;
    }
    if (isTemplate885) {
      debugLog(`[RE885] DOCX Render: ${Math.round(performance.now() - tRenderStart)} ms (output=${processedDocx.length} bytes)`);
    }

    // ── RE851D post-render unzip/zip cache ──
    // The 7 RE851D safety passes below each independently unzipped & rezipped
    // the full DOCX. On 5-property documents (~4 MB document.xml) that 7×
    // round-trip exhausted the edge function's CPU/memory budget. This shared
    // cache makes them all share a single in-memory representation; the final
    // rezip happens once, just before upload.
    let __re851dPassCache: Record<string, Uint8Array> | null = null;
    // Decoded-XML cache for content-bearing parts. Each part is decoded at
    // most ONCE across all 7 RE851D safety passes, and re-encoded at most
    // ONCE (at the final flush). Eliminates ~6× redundant 4 MB
    // decode/encode round-trips on 5-property documents.
    const __xmlStrCache: Record<string, string> = {};
    const __xmlDirty: Set<string> = new Set();
    const __passUnzip = (buf: Uint8Array): Record<string, Uint8Array> => {
      if (__re851dPassCache) return __re851dPassCache;
      __re851dPassCache = fflate.unzipSync(buf);
      return __re851dPassCache;
    };
    // Decode once per filename; subsequent passes reuse the cached string.
    const __xmlGet = (filename: string, bytes: Uint8Array): string => {
      let s = __xmlStrCache[filename];
      if (s === undefined) {
        s = new TextDecoder("utf-8").decode(bytes);
        __xmlStrCache[filename] = s;
      }
      return s;
    };
    // Mark a content part as mutated and update the cached string. Returns
    // a placeholder Uint8Array so callers can keep their existing rezip
    // shape; the final flush re-encodes dirty strings exactly once.
    //
    // Correctness: ALWAYS invalidate __visProjCache and __xmlLowerCache on
    // any mutation. Even length-preserving glyph/text swaps change visible-
    // text content at the same byte offsets, which makes the cached
    // projection's txt → xml map stale. Re-using a stale projection caused
    // follow-up safety passes to overwrite the wrong byte range and
    // produced a corrupted RE851D output (malformed
    // `<w:rFonts w:ascii="Time…</w:tc>` that breaks XML well-formedness so
    // Word/Google Docs refuse to open the file).
    const __xmlSet = (filename: string, xml: string): Uint8Array => {
      __xmlStrCache[filename] = xml;
      __xmlDirty.add(filename);
      delete __visProjCache[filename];
      delete __xmlLowerCache[filename];
      // Return existing bytes (or empty); the value is discarded by the
      // final flush, which uses the cached string instead.
      return (__re851dPassCache && __re851dPassCache[filename]) || new Uint8Array(0);
    };

    // Cached lowercase XML per filename. The four post-render YES/NO safety
    // passes (remain-unpaid, cure-delinquency, 60-day, encumbrances-of-record)
    // each previously called `xml.toLowerCase()` on the full ~3.9MB XML for
    // their cheap "skip if substring missing" check. Caching makes that cost
    // be paid once per file across all passes. Invalidated by __xmlSet.
    const __xmlLowerCache: Record<string, string> = {};
    const __xmlGetLower = (filename: string, xml: string): string => {
      let s = __xmlLowerCache[filename];
      if (s === undefined) {
        s = xml.toLowerCase();
        __xmlLowerCache[filename] = s;
      }
      return s;
    };
    // The 6 post-render safety passes that need to anchor on visible text
    // each previously rebuilt a per-character `buf`/`map` projection of the
    // entire (~3–4 MB on 5-property deals) word/document.xml. That repeated
    // O(N) work was the dominant remaining CPU sink and pushed generation
    // over the edge function CPU limit. This helper builds the projection
    // once per (filename, xml-version) and reuses it. Bulk-slice segments
    // replace per-char push() loops; PROPERTY INFORMATION anchors are also
    // computed once and stored on the projection.
    // Memory-optimized projection. We avoid materializing a dense
    // per-character `map` array (which on a 4.8 MB word/document.xml costs
    // ~12 MB of heap and ~20–40 ms of CPU per build). Each post-render
    // safety pass invalidates the cache via __xmlSet, so on a 5-property
    // RE851D document the dense map was being rebuilt 6+ times — the
    // dominant residual CPU sink that pushed the function past the edge
    // runtime budget. Instead we keep the compact segment table and expose
    // `map[i]` lookups via a binary-search-backed Proxy. Only the AEA
    // post-render pass actually reads `proj.map[i]` (and only at a handful
    // of regex anchor positions), so the per-access cost is negligible.
    type __VisProj = {
      txt: string;
      map: { length: number; [i: number]: number };
      propAnchorsRaw: number[];
      propRanges: Array<{ k: number; start: number; end: number }>;
    };
    const __visProjCache: Record<string, __VisProj> = {};
    const __getVisProj = (filename: string, xml: string): __VisProj => {
      const cached = __visProjCache[filename];
      if (cached) return cached;
      // First pass: count segments to size the typed arrays exactly.
      let segCount = 0;
      {
        let i = 0;
        while (i < xml.length) {
          const lt = xml.indexOf("<", i);
          if (lt === -1) {
            if (i < xml.length) segCount++;
            break;
          }
          if (lt > i) segCount++;
          segCount++; // synthetic space
          const gt = xml.indexOf(">", lt);
          if (gt === -1) break;
          i = gt + 1;
        }
      }
      const txtStart = new Int32Array(segCount);
      const xmlStart = new Int32Array(segCount);
      const segLen = new Int32Array(segCount);
      const txtParts: string[] = new Array(segCount);
      let s = 0;
      let txtPos = 0;
      let i = 0;
      while (i < xml.length) {
        const lt = xml.indexOf("<", i);
        if (lt === -1) {
          if (i < xml.length) {
            const part = xml.slice(i);
            txtStart[s] = txtPos;
            xmlStart[s] = i;
            segLen[s] = part.length;
            txtParts[s] = part;
            txtPos += part.length;
            s++;
          }
          break;
        }
        if (lt > i) {
          const part = xml.slice(i, lt);
          txtStart[s] = txtPos;
          xmlStart[s] = i;
          segLen[s] = lt - i;
          txtParts[s] = part;
          txtPos += part.length;
          s++;
        }
        txtStart[s] = txtPos;
        xmlStart[s] = lt;
        segLen[s] = 0;
        txtParts[s] = " ";
        txtPos += 1;
        s++;
        const gt = xml.indexOf(">", lt);
        if (gt === -1) break;
        i = gt + 1;
      }
      const txt = txtParts.join("");
      const segN = s;

      // Binary-search resolver over the segment table — txt-index → xml-index.
      // O(log segN) per access; segN is ~thousands (one entry per text run +
      // one per tag boundary), so each access is a handful of comparisons.
      const resolve = (ti: number): number => {
        if (ti <= 0) return xmlStart.length > 0 ? xmlStart[0] : 0;
        if (ti >= txt.length) return xml.length;
        let lo = 0, hi = segN - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (txtStart[mid] <= ti) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        const off = ti - txtStart[best];
        const sl = segLen[best];
        // Synthetic-space segments (sl===0) collapse to their '<' offset.
        return xmlStart[best] + (sl === 0 ? 0 : Math.min(off, sl - 1));
      };

      // Lazy "array-like" map facade. Backed by a Proxy so `map[i]` syntax
      // continues to work in callers without changing any consumer code.
      const map = new Proxy(
        { length: txt.length + 1 },
        {
          get(target, prop) {
            if (prop === "length") return (target as any).length;
            if (typeof prop === "string") {
              const idx = Number(prop);
              if (Number.isInteger(idx) && idx >= 0) return resolve(idx);
            }
            return (target as any)[prop];
          },
        },
      ) as unknown as { length: number; [i: number]: number };

      const propAnchorsRaw: number[] = [];
      const propRe = /\bPROPERTY\s+INFORMATION\b/gi;
      let m: RegExpExecArray | null;
      while ((m = propRe.exec(txt)) !== null) {
        propAnchorsRaw.push(resolve(m.index));
        if (propAnchorsRaw.length >= 5) break;
      }
      const propRanges: __VisProj["propRanges"] = [];
      for (let pi = 0; pi < propAnchorsRaw.length; pi++) {
        propRanges.push({
          k: pi + 1,
          start: propAnchorsRaw[pi],
          end: pi + 1 < propAnchorsRaw.length ? propAnchorsRaw[pi + 1] : xml.length,
        });
      }
      const proj: __VisProj = { txt, map, propAnchorsRaw, propRanges };
      __visProjCache[filename] = proj;
      return proj;
    };
    const __passZip = (rezip: fflate.Zippable): Uint8Array => {
      if (!__re851dPassCache) __re851dPassCache = {};
      for (const [k, v] of Object.entries(rezip)) {
        const bytes = Array.isArray(v) ? (v as [Uint8Array, unknown])[0] : (v as Uint8Array);
        // Skip placeholder bytes returned by __xmlSet — the cached string
        // is the source of truth for dirty content parts.
        if (__xmlDirty.has(k) && bytes.length === 0) continue;
        __re851dPassCache[k] = bytes;
      }
      // Return current processedDocx unchanged — passes only call unzip on
      // processedDocx, and __passUnzip ignores the buffer when the cache is
      // populated. Avoids an O(N) zip per pass.
      return processedDocx;
    };

    // ── RE851D MULTI-PROPERTY LIEN-DETAIL CLONER ─────────────────────────
    // The shipped RE851D template carries the lien-detail block (ENCUMBRANCE
    // grids + "Additional encumbrances…" YES/NO row + Broker/Lender initials
    // row) only ONCE. Property 1 maps and renders correctly today. For deals
    // with 2..5 properties we duplicate that exact block per extra property,
    // each on a fresh page, prefixed with a "PROPERTY INFORMATION" anchor so
    // every downstream per-property pass (label-anchored encumbrance value
    // publisher, balloon safety pass, additional-encumbrance YES/NO + addendum
    // attachment, lien questionnaire, etc.) automatically picks up the new
    // region and writes the matching pr_li_rem_*_{N}_{S} / pr_li_ant_*_{N}_{S}
    // values that the in-render publisher has already produced for N=2..K.
    //
    // Strictly additive: never edits Property 1's block, and short-circuits
    // when:
    //   • template is not RE851D
    //   • the loan file has 1 (or zero) properties
    //   • the lien-detail boundaries cannot be located
    //   • the document already exposes >=K PROPERTY INFORMATION anchors
    //     (idempotent — safe to re-run, e.g. on retries or if a future
    //     template revision ships pre-cloned).
    if (/851d/i.test(template.name || "")) {
      try {
        // Determine property count K from already-published field values.
        let K = 1;
        for (let n = 5; n >= 2; n--) {
          const a = fieldValues.get(`property${n}.address`)?.rawValue;
          const v = fieldValues.get(`property${n}.appraise_value`)?.rawValue;
          const ad = fieldValues.get(`property${n}.address_line1`)?.rawValue;
          if (
            (a !== undefined && String(a).trim() !== "") ||
            (v !== undefined && String(v).trim() !== "") ||
            (ad !== undefined && String(ad).trim() !== "")
          ) { K = n; break; }
        }

        if (K >= 2) {
          const unzipped = __passUnzip(processedDocx);
          for (const [filename, bytes] of Object.entries(unzipped)) {
            if (filename !== "word/document.xml") continue;
            let xml = __xmlGet(filename, bytes);
            // Idempotency: if document already has >=K "PROPERTY INFORMATION" anchors, skip.
            const existingAnchors = (xml.match(/PROPERTY\s*<[^>]*>\s*<[^>]*>?\s*INFORMATION|PROPERTY\s+INFORMATION/gi) || []).length;
            // Quick visible-text count via projection (more reliable across run splits).
            const vp0 = __getVisProj(filename, xml);
            if (vp0.propAnchorsRaw.length >= K) {
              debugLog(`[851D-clone] already has ${vp0.propAnchorsRaw.length} PROPERTY anchors (>=K=${K}); skipping`);
              continue;
            }

            // Locate the lien-detail block in raw XML.
            // Anchor: visible "ENCUMBRANCE(S) REMAINING" → walk back to its
            // enclosing <w:tbl>; then walk forward through tables until we
            // pass the table containing "INITIALS" (Broker/Lender initials).
            const txt = vp0.txt;
            const map = vp0.map;
            const remIdx = txt.search(/ENCUMBRANCE\(S\)\s+REMAINING/i);
            if (remIdx < 0) {
              debugLog(`[851D-clone] could not find ENCUMBRANCE(S) REMAINING anchor; skipping`);
              continue;
            }
            const remRaw = map[remIdx] ?? -1;
            if (remRaw < 0) continue;
            // Walk back to find the enclosing <w:tbl>.
            const blockStart = xml.lastIndexOf("<w:tbl>", remRaw);
            if (blockStart < 0) {
              debugLog(`[851D-clone] no enclosing <w:tbl> for REMAINING; skipping`);
              continue;
            }
            // From blockStart, scan forward through consecutive top-level
            // tables/paragraphs until we close the table that contains
            // "INITIALS" (Broker/Lender initials). Cap distance defensively.
            const SCAN_CAP = 200_000; // chars
            const scanLimit = Math.min(xml.length, blockStart + SCAN_CAP);
            let cursor = blockStart;
            let blockEnd = -1;
            while (cursor < scanLimit) {
              // Find next top-level <w:tbl> opening at cursor (must start with <w:tbl>).
              if (xml.startsWith("<w:tbl>", cursor) || xml.startsWith("<w:tbl ", cursor)) {
                const close = xml.indexOf("</w:tbl>", cursor);
                if (close < 0) break;
                const tblEnd = close + "</w:tbl>".length;
                const tblXml = xml.slice(cursor, tblEnd);
                const tblTxt = tblXml.replace(/<[^>]+>/g, " ");
                cursor = tblEnd;
                if (/\bINITIALS\b/i.test(tblTxt)) {
                  blockEnd = tblEnd;
                  break;
                }
              } else if (xml.startsWith("<w:p>", cursor) || xml.startsWith("<w:p ", cursor)) {
                const close = xml.indexOf("</w:p>", cursor);
                if (close < 0) break;
                cursor = close + "</w:p>".length;
              } else {
                // Skip a single character if neither table nor paragraph at cursor.
                cursor += 1;
              }
            }
            if (blockEnd < 0) {
              debugLog(`[851D-clone] could not locate end-of-lien-block (INITIALS table); skipping`);
              continue;
            }

            const slice = xml.slice(blockStart, blockEnd);

            // Build N-1 clones (N=2..K). Each clone:
            //  • leading explicit page break paragraph
            //  • a "PROPERTY INFORMATION" heading paragraph (gives the
            //    downstream per-property scanner its anchor)
            //  • the lien-detail slice with bookmark + SDT + revision IDs
            //    namespaced per property to avoid Word ID collisions.
            const PAGE_BREAK_P =
              `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
            const headingFor = (i: number) =>
              `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/></w:pPr>` +
              `<w:r><w:rPr><w:b/><w:caps/></w:rPr>` +
              `<w:t xml:space="preserve">PROPERTY INFORMATION (Property ${i})</w:t></w:r></w:p>`;

            const namespaceIds = (s: string, i: number): string => {
              const bump = i * 100000;
              // Bump numeric w:id="…" attributes (revisions, bookmarks, sdt ids, etc.)
              s = s.replace(/(\bw:id=")(\d+)(")/g, (_m, p1, num, p3) => `${p1}${parseInt(num, 10) + bump}${p3}`);
              // Bump bookmark names so they remain unique.
              s = s.replace(/(<w:bookmarkStart\b[^>]*\bw:name=")([^"]+)(")/g, (_m, p1, nm, p3) => `${p1}${nm}_p${i}${p3}`);
              return s;
            };

            const clones: string[] = [];
            for (let i = 2; i <= K; i++) {
              clones.push(PAGE_BREAK_P + headingFor(i) + namespaceIds(slice, i));
            }
            const insertion = clones.join("");

            // Splice clones immediately after the original lien-detail block
            // so each cloned block sits on its own page.
            const newXml = xml.slice(0, blockEnd) + insertion + xml.slice(blockEnd);
            __xmlSet(filename, newXml);
            debugLog(`[851D-clone] cloned lien-detail block for properties 2..${K} (slice=${slice.length} chars, ${clones.length} clones)`);
          }
        }
      } catch (cloneErr) {
        console.error(
          `[generate-document] RE851D multi-property clone pass failed (continuing):`,
          cloneErr instanceof Error ? cloneErr.message : String(cloneErr)
        );
      }
    }


    // Some authored RE851D templates carry inline conditional checkbox glyphs
    // (e.g. {{#if (eq pr_p_occupanc_N "Owner Occupied")}}☑{{else}}☐{{/if}})
    // that, depending on template variants and run fragmentation, may leave
    // both Yes ☑/☑ and No ☑/☑ checked. After full template rendering, walk
    // each PROPERTY block and force exactly one mutually-exclusive pair
    // anchored to the literal "Yes" / "No" labels following "OWNER OCCUPIED",
    // using pr_p_occupanc_K as the source of truth. Strictly RE851D-scoped.
    if (/851d/i.test(template.name || "")) {
      try {
        const occByIdx: Record<number, string> = {};
        for (let k = 1; k <= 5; k++) {
          const v = fieldValues.get(`pr_p_occupanc_${k}`);
          occByIdx[k] = String(v?.rawValue ?? "").trim().toLowerCase();
        }
        if (occByIdx[1] === "" && fieldValues.get("pr_p_occupanc")) {
          occByIdx[1] = String(fieldValues.get("pr_p_occupanc")?.rawValue ?? "").trim().toLowerCase();
        }

        const decoder2 = new TextDecoder("utf-8");
        const encoder2 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (xml.indexOf("OWNER OCCUPIED") === -1 && xml.indexOf("Owner Occupied") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          // Build property-section anchors. Prefer "PROPERTY INFORMATION"
          // gray-bar headings (RE851D standard); fall back to "PROPERTY #K"
          // headings when the gray bar is absent. Cap at 5 properties.
          const propAnchors: Array<{ k: number; orig: number }> = [];
          {
            const __vp = __getVisProj(filename, xml);
            const txt = __vp.txt;
            const map = __vp.map;
            // Primary: PROPERTY INFORMATION headings (already cached on proj).
            if (__vp.propAnchorsRaw.length > 0) {
              __vp.propAnchorsRaw.forEach((orig, i) => propAnchors.push({ k: i + 1, orig }));
            } else {
              // Fallback: PROPERTY #K detail headings.
              const rePk = /\bPROPERTY\s*#\s*([1-5])\b/gi;
              const seen = new Set<number>();
              let m: RegExpExecArray | null;
              while ((m = rePk.exec(txt)) !== null) {
                const k = parseInt(m[1], 10);
                if (k >= 1 && k <= 5 && !seen.has(k)) {
                  seen.add(k);
                  propAnchors.push({ k, orig: map[m.index] ?? 0 });
                }
              }
              propAnchors.sort((a, b) => a.orig - b.orig);
            }
          }
          if (propAnchors.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchors.length; pi++) {
            propRanges.push({
              k: propAnchors[pi].k,
              start: propAnchors[pi].orig,
              end: pi + 1 < propAnchors.length ? propAnchors[pi + 1].orig : xml.length,
            });
          }

          const ownerRe = /OWNER\s+OCCUPIED/gi;
          const yesLabelRe = /<w:t(?:\s[^>]*)?>\s*[☐☑☑]?\s*Yes\s*<\/w:t>/gi;
          const noLabelRe = /<w:t(?:\s[^>]*)?>\s*[☐☑☑]?\s*No\s*<\/w:t>/gi;
          const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
          const sdtCheckboxRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;

          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          const rewriteSdtChecked = (block: string, checked: boolean): string => {
            const val = checked ? "1" : "0";
            const glyph = checked ? "\u2611" : "\u2610";
            let next = block.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
            next = next.replace(
              /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>)/,
              `$1${glyph}$3`,
            );
            return next;
          };

          // Collect every checkbox control (SDT or bare glyph) inside [winStart, winEnd).
          type Ctrl = { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] };
          const collectControls = (winStart: number, winEnd: number): Ctrl[] => {
            const ctrls: Ctrl[] = [];
            const slice = xml.slice(winStart, winEnd);
            const sdtRe = new RegExp(sdtCheckboxRe.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(slice)) !== null) {
              ctrls.push({
                idx: winStart + sm.index,
                end: winStart + sm.index + sm[0].length,
                kind: "sdt",
                m: [sm[0]],
              });
            }
            const gRe = new RegExp(glyphRunRe.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(slice)) !== null) {
              const s = winStart + gm.index;
              const e = winStart + gm.index + gm[0].length;
              // Skip glyphs that fall inside an SDT block we already captured.
              if (ctrls.some((c) => c.kind === "sdt" && s >= c.idx && e <= c.end)) continue;
              ctrls.push({ idx: s, end: e, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] });
            }
            ctrls.sort((a, b) => a.idx - b.idx);
            return ctrls;
          };

          let om: RegExpExecArray | null;
          let ownerOccurrence = 0;
          while ((om = ownerRe.exec(xml)) !== null) {
            const qStart = om.index;
            ownerOccurrence += 1;
            // Primary: assign property index by OWNER OCCUPIED occurrence order
            // (1st OWNER OCCUPIED -> property 1, 2nd -> property 2, ...). This
            // is robust regardless of how many PROPERTY INFORMATION / PROPERTY #K
            // headings the template carries. Fall back to range-based lookup
            // only if occurrence index exceeds known properties.
            let regionK = ownerOccurrence;
            const rangeMatch = propRanges.find((p) => qStart >= p.start && qStart < p.end);
            if (regionK > 5 && rangeMatch) regionK = rangeMatch.k;
            if (regionK < 1 || regionK > 5) continue;
            // Bound search window: until next OWNER OCCUPIED or end of xml.
            const nextOwnerIdx = (() => {
              const tmp = new RegExp(ownerRe.source, "gi");
              tmp.lastIndex = qStart + 1;
              const nm = tmp.exec(xml);
              return nm ? nm.index : xml.length;
            })();
            const winEnd = Math.min(nextOwnerIdx, qStart + 3000);

            yesLabelRe.lastIndex = qStart;
            noLabelRe.lastIndex = qStart;
            const yL = yesLabelRe.exec(xml);
            const nL = noLabelRe.exec(xml);
            if (!yL || !nL) continue;
            if (yL.index >= winEnd || nL.index >= winEnd) continue;

            // Collect every checkbox control between the OWNER OCCUPIED anchor
            // and the end of the local window. Pick the control nearest to
            // each label (search both sides), ensuring the Yes and No
            // controls are distinct.
            const ctrls = collectControls(qStart, winEnd);
            if (ctrls.length < 2) continue;
            const distance = (c: Ctrl, labelIdx: number) =>
              labelIdx >= c.end ? labelIdx - c.end : c.idx - labelIdx;
            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);

            // Sort candidates by absolute distance to the label.
            const sortByDist = (labelIdx: number) =>
              ctrls
                .filter((c) => !overlaps(c.idx, c.end))
                .map((c) => ({ c, d: Math.abs(distance(c, labelIdx)) }))
                .sort((a, b) => a.d - b.d);

            const yesCands = sortByDist(yL.index);
            const noCands = sortByDist(nL.index);
            if (yesCands.length === 0 || noCands.length === 0) continue;

            const yC = yesCands[0].c;
            // Pick a No control distinct from the chosen Yes control.
            const nCSel = noCands.find((x) => x.c.idx !== yC.idx);
            if (!nCSel) continue;
            const nC = nCSel.c;

            const isOwner = occByIdx[regionK] === "owner occupied";
            const yesChecked = isOwner;
            const noChecked = !isOwner;

            const yesReplacement =
              yC.kind === "sdt"
                ? rewriteSdtChecked(yC.m[0], yesChecked)
                : `${yC.m[1]}${yesChecked ? "\u2611" : "\u2610"}${yC.m[3]}`;
            const noReplacement =
              nC.kind === "sdt"
                ? rewriteSdtChecked(nC.m[0], noChecked)
                : `${nC.m[1]}${noChecked ? "\u2611" : "\u2610"}${nC.m[3]}`;

            rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
            rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
            debugLog(
              `[generate-document] RE851D owner-occupied PROP#${regionK} (occ#${ownerOccurrence}) occ="${occByIdx[regionK]}" => YES=${yesChecked ? "☑" : "☐"} NO=${noChecked ? "☑" : "☐"}`,
            );
          }

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render owner-occupied safety pass: ${rewrites.length / 2} pairs forced in ${filename}`
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render owner-occupied pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr)
        );
      }
    }

    // ── RE851D POST-RENDER "Multiple / Additional Securing Property" YES/NO safety pass ──
    // The mapped RE851D template uses several different label texts and
    // checkbox arrangements for this question across PROPERTY blocks:
    //   - "Are there multiple properties on the loan"
    //   - "IS THERE ADDITIONAL SECURING PROPERTY?"
    // Some occurrences also have only static "☐ YES ☐ NO" with no merge tag,
    // so the pre-render publisher cannot reach them. After processDocx wraps
    // bare glyphs in <w:sdt> blocks with intrinsic <w14:checked> state, walk
    // each occurrence and force exactly one mutually-exclusive YES/NO pair
    // based on the property count detected in fieldValues. Strictly
    // RE851D-scoped; only the YES/NO pair immediately following the question
    // is touched.
    if (/851d/i.test(template.name || "")) {
      try {
        // Derive property count from fieldValues (property{N}.* keys).
        const _propIdxSet = new Set<number>();
        for (const [k] of fieldValues.entries()) {
          const m = k.match(/^property(\d+)\./i);
          if (m) _propIdxSet.add(parseInt(m[1], 10));
        }
        const propCount = _propIdxSet.size > 0 ? _propIdxSet.size : 1;
        const isMultipleQ = propCount > 1;

        const decoder3 = new TextDecoder("utf-8");
        const encoder3 = new TextEncoder();
        const unzipped3 = __passUnzip(processedDocx);
        const rezip3: fflate.Zippable = {};
        let didMutate3 = false;

        const sdtCheckboxReM = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;
        const glyphRunReM = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
        const inlineGlyphInWtReM = /<w:t(?:\s[^>]*)?>[^<]*([☐☑☑])[^<]*<\/w:t>/g;

        const rewriteSdtCheckedM = (block: string, checked: boolean): string => {
          if (!/<w14:checkbox\b/.test(block)) return block;
          const val = checked ? "1" : "0";
          const glyph = checked ? "\u2611" : "\u2610";
          let next = block;
          if (/<w14:checked\b[^/]*?w14:val="[01]"\s*\/?>/.test(next)) {
            next = next.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
          } else {
            next = next.replace(
              /(<w14:checkbox\b[^>]*>)/,
              `$1<w14:checked w14:val="${val}"/>`,
            );
          }
          next = next.replace(
            /(<w:sdtContent\b[\s\S]*?<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/,
            (_m, open, _inner, close) => `${open}${glyph}${close}`,
          );
          return next;
        };

        for (const [filename, bytes] of Object.entries(unzipped3)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip3[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);

          // Cheap cached-lowercase pre-filter: skip the entire pass for parts
          // whose XML can't possibly contain the question text. This avoids
          // building the multi-MB visible-text projection on header/footer
          // files (and on document.xml when the prompt isn't in the template),
          // which was a major contributor to "CPU Time exceeded" on RE851D.
          {
            const xmlLowerMP = __xmlGetLower(filename, xml);
            if (
              xmlLowerMP.indexOf("multiple properties") === -1 &&
              xmlLowerMP.indexOf("additional securing property") === -1
            ) {
              rezip3[filename] = [bytes, { level: 0 }];
              continue;
            }
          }

          // Build a visible-text projection with an offset map back into xml.
          // This handles Word splitting visible text across multiple <w:t>
          // runs and intervening tags.
          const __vp2 = __getVisProj(filename, xml);
          const txt = __vp2.txt;
          const map = __vp2.map;
          const txtToXml = (ti: number) =>
            ti < 0 ? 0 : ti >= map.length ? xml.length : map[ti];

          // Detect supported labels in visible text.
          const questionReTxt = /(?:Are\s+there\s+multiple\s+properties\s+on\s+the\s+loan|IS\s+THERE\s+ADDITIONAL\s+SECURING\s+PROPERTY)/gi;
          const questionHits: Array<{ ti: number; len: number }> = [];
          let qmt: RegExpExecArray | null;
          while ((qmt = questionReTxt.exec(txt)) !== null) {
            questionHits.push({ ti: qmt.index, len: qmt[0].length });
            if (qmt.index === questionReTxt.lastIndex) questionReTxt.lastIndex++;
          }

          if (questionHits.length === 0) {
            rezip3[filename] = [bytes, { level: 0 }];
            continue;
          }

          type Ctrl3 = { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] };
          const collectControls = (winStart: number, winEnd: number): Ctrl3[] => {
            const ctrls: Ctrl3[] = [];
            const slice = xml.slice(winStart, winEnd);
            const sdtRe = new RegExp(sdtCheckboxReM.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(slice)) !== null) {
              if (!/<w14:checkbox\b/.test(sm[0])) continue;
              ctrls.push({
                idx: winStart + sm.index,
                end: winStart + sm.index + sm[0].length,
                kind: "sdt",
                m: [sm[0]],
              });
            }
            const gRe = new RegExp(glyphRunReM.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(slice)) !== null) {
              const s = winStart + gm.index;
              const e = winStart + gm.index + gm[0].length;
              if (ctrls.some((c) => c.kind === "sdt" && s >= c.idx && e <= c.end)) continue;
              ctrls.push({ idx: s, end: e, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] });
            }
            ctrls.sort((a, b) => a.idx - b.idx);
            return ctrls;
          };

          type Rewrite3 = { start: number; end: number; replacement: string };
          const rewrites: Rewrite3[] = [];
          // Inline glyph rewrites (when label+glyph share one <w:t> run).
          type InlineRw = { start: number; end: number; replacement: string };
          const inlineRewrites: InlineRw[] = [];

          // Find YES/NO label offsets in visible text.
          const yesLabelReTxt = /\b(YES|Yes)\b/g;
          const noLabelReTxt = /\b(NO|No)\b/g;

          for (let qi = 0; qi < questionHits.length; qi++) {
            const q = questionHits[qi];
            const qTxtEnd = q.ti + q.len;
            const nextQTxt = qi + 1 < questionHits.length ? questionHits[qi + 1].ti : txt.length;
            const winTxtEnd = Math.min(nextQTxt, qTxtEnd + 600); // ~600 visible chars
            const winText = txt.slice(qTxtEnd, winTxtEnd);

            yesLabelReTxt.lastIndex = 0;
            noLabelReTxt.lastIndex = 0;
            const yMtxt = yesLabelReTxt.exec(winText);
            const nMtxt = noLabelReTxt.exec(winText);
            if (!yMtxt || !nMtxt) {
              debugLog(
                `[generate-document] RE851D multi-properties post-render: question occ#${qi + 1} found but YES/NO labels not located in window`,
              );
              continue;
            }
            const yTxtIdx = qTxtEnd + yMtxt.index;
            const nTxtIdx = qTxtEnd + nMtxt.index;
            const yXmlIdx = txtToXml(yTxtIdx);
            const nXmlIdx = txtToXml(nTxtIdx);
            const winXmlStart = txtToXml(qTxtEnd);
            const winXmlEnd = txtToXml(winTxtEnd);

            const ctrls = collectControls(winXmlStart, winXmlEnd);

            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);

            const yesChecked = isMultipleQ;
            const noChecked = !isMultipleQ;
            const yesGlyph = yesChecked ? "\u2611" : "\u2610";
            const noGlyph = noChecked ? "\u2611" : "\u2610";

            const pickFor = (labelXml: number, exclude: Ctrl3 | null): Ctrl3 | null => {
              const cands = ctrls
                .filter((c) => !overlaps(c.idx, c.end))
                .filter((c) => !exclude || c.idx !== exclude.idx)
                .map((c) => ({
                  c,
                  d: Math.abs(labelXml >= c.end ? labelXml - c.end : c.idx - labelXml),
                }))
                .sort((a, b) => a.d - b.d);
              return cands.length > 0 ? cands[0].c : null;
            };

            const yC = pickFor(yXmlIdx, null);
            const nC = pickFor(nXmlIdx, yC);

            let touched = false;
            if (yC) {
              const repl =
                yC.kind === "sdt"
                  ? rewriteSdtCheckedM(yC.m[0], yesChecked)
                  : `${yC.m[1]}${yesGlyph}${yC.m[3]}`;
              rewrites.push({ start: yC.idx, end: yC.end, replacement: repl });
              touched = true;
            }
            if (nC) {
              const repl =
                nC.kind === "sdt"
                  ? rewriteSdtCheckedM(nC.m[0], noChecked)
                  : `${nC.m[1]}${noGlyph}${nC.m[3]}`;
              rewrites.push({ start: nC.idx, end: nC.end, replacement: repl });
              touched = true;
            }

            // Helper: locate the enclosing <w:t…>…</w:t> bounds for a given
            // visible label position. Returns inner-content range or null.
            const wtBoundsFor = (labelXml: number): { openTagEnd: number; closeStart: number; inner: string } | null => {
              const wtOpen = xml.lastIndexOf("<w:t", labelXml);
              if (wtOpen < 0 || labelXml - wtOpen > 600) return null;
              const openTagEnd = xml.indexOf(">", wtOpen);
              if (openTagEnd === -1 || openTagEnd > labelXml) return null;
              const closeStart = xml.indexOf("</w:t>", labelXml);
              if (closeStart === -1 || closeStart - openTagEnd > 1200) return null;
              const inner = xml.slice(openTagEnd + 1, closeStart);
              return { openTagEnd, closeStart, inner };
            };

            // Position-aware single-glyph rewrite within the SAME <w:t> as
            // the label. Replaces only the glyph nearest to (and on a
            // sensible side of) the label position — never global-replaces.
            const inlineForLabel = (
              labelXml: number,
              glyph: string,
              skip: boolean,
            ) => {
              if (skip) return;
              const b = wtBoundsFor(labelXml);
              if (!b) return;
              if (overlaps(b.openTagEnd + 1, b.closeStart)) return;
              const localLabel = labelXml - (b.openTagEnd + 1);
              const glyphRe = /[☐☑]/g;
              let best: { idx: number; d: number } | null = null;
              let gm: RegExpExecArray | null;
              while ((gm = glyphRe.exec(b.inner)) !== null) {
                // Prefer glyphs to the LEFT of the label (typical layout
                // is "☐ YES"); fall back to the closest glyph either side.
                const d = gm.index <= localLabel
                  ? localLabel - gm.index
                  : (gm.index - localLabel) + 1000; // heavy penalty for right side
                if (!best || d < best.d) best = { idx: gm.index, d };
              }
              if (!best) return;
              const newInner =
                b.inner.slice(0, best.idx) + glyph + b.inner.slice(best.idx + 1);
              if (newInner === b.inner) return;
              inlineRewrites.push({
                start: b.openTagEnd + 1,
                end: b.closeStart,
                replacement: newInner,
              });
              touched = true;
            };

            // Combined-pair pass: when both YES and NO labels share ONE <w:t>
            // (e.g. "☐ YES   ☐ NO" produced by a single resolved merge-tag
            // paragraph), rewrite the two glyph chars positionally — first
            // glyph → yesGlyph, second glyph → noGlyph — to avoid two
            // competing single-side rewrites racing on the same run.
            // Tolerates leading whitespace/NBSP, alternative separators,
            // and varying label spelling.
            const combinedPairForRun = (): boolean => {
              if (yC || nC) return false;
              const b = wtBoundsFor(yXmlIdx);
              if (!b) return false;
              // Both YES and NO must live in the same <w:t>.
              if (nXmlIdx <= b.openTagEnd || nXmlIdx >= b.closeStart) return false;
              if (overlaps(b.openTagEnd + 1, b.closeStart)) return false;
              // Find first two glyph positions in inner.
              const glyphRe = /[☐☑]/g;
              const positions: number[] = [];
              let gm: RegExpExecArray | null;
              while ((gm = glyphRe.exec(b.inner)) !== null) {
                positions.push(gm.index);
                if (positions.length >= 2) break;
              }
              if (positions.length < 2) return false;
              const [p1, p2] = positions;
              const newInner =
                b.inner.slice(0, p1) + yesGlyph +
                b.inner.slice(p1 + 1, p2) + noGlyph +
                b.inner.slice(p2 + 1);
              if (newInner === b.inner) return false;
              inlineRewrites.push({
                start: b.openTagEnd + 1,
                end: b.closeStart,
                replacement: newInner,
              });
              touched = true;
              return true;
            };
            const combinedHandled = combinedPairForRun();
            inlineForLabel(yXmlIdx, yesGlyph, !!yC || combinedHandled);
            inlineForLabel(nXmlIdx, noGlyph, !!nC || combinedHandled);

            // Diagnostic: when nothing handled this occurrence, log a short
            // snippet of the YES-label run so future regressions are visible.
            if (!touched) {
              const dbg = wtBoundsFor(yXmlIdx);
              const snippet = dbg ? dbg.inner.slice(0, 80).replace(/\s+/g, " ") : "(no <w:t> bounds)";
              debugLog(
                `[generate-document] RE851D multi-properties post-render occ#${qi + 1}: NO HANDLER MATCHED — innerSnippet="${snippet}"`,
              );
            }

            debugLog(
              `[generate-document] RE851D multi-properties post-render occ#${qi + 1}: propCount=${propCount} => YES=${yesGlyph} NO=${noGlyph} (yC=${yC ? yC.kind : "none"}, nC=${nC ? nC.kind : "none"}, combined=${combinedHandled}, inline=${inlineRewrites.length}, touched=${touched})`,
            );
          }

          const allRewrites = [...rewrites, ...inlineRewrites].sort(
            (a, b) => b.start - a.start,
          );
          if (allRewrites.length > 0) {
            for (const r of allRewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip3[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate3 = true;
          } else {
            rezip3[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate3) {
          processedDocx = __passZip(rezip3);
        }
      } catch (postErrM) {
        console.error(
          `[generate-document] RE851D post-render multiple-properties pass failed (continuing):`,
          postErrM instanceof Error ? postErrM.message : String(postErrM)
        );
      }
    }

    // ── RE851D POST-RENDER literal-tag fallback for pr_p_multipleProperties_* ──
    // Final safety net: if any `{{pr_p_multipleProperties_(yes|no)(_glyph)?(_N|_1..5)?}}`
    // literal survived all earlier passes (e.g. region-allowlist mismatch,
    // unanticipated _N rewrite skip, fragmented run that normalization missed),
    // resolve it directly here using the global property-count decision so
    // the document never shows raw merge tags.
    if (/851d/i.test(template.name || "")) {
      try {
        const PRESENCE = ["address", "street", "city", "state", "zip", "county", "legal_description"];
        const propIdxSet = new Set<number>();
        for (const [k] of fieldValues.entries()) {
          const m = k.match(/^property(\d+)\./i);
          if (m) propIdxSet.add(parseInt(m[1], 10));
        }
        const realCount = [...propIdxSet]
          .filter((idx) => PRESENCE.some((f) => {
            const v = fieldValues.get(`property${idx}.${f}`)?.rawValue;
            return v !== undefined && v !== null && String(v).trim() !== "";
          })).length;
        const isMulti = realCount > 1;
        const yesGlyph = isMulti ? "\u2611" : "\u2610";
        const noGlyph = isMulti ? "\u2610" : "\u2611";
        const yesBool = isMulti ? "true" : "false";
        const noBool = isMulti ? "false" : "true";

        const unzippedFB = __passUnzip(processedDocx);
        const rezipFB: fflate.Zippable = {};
        let mutatedFB = false;
        const tagRe = /\{\{\s*pr_p_multipleProperties_(yes|no)(_glyph)?(?:_(?:N|[1-5]))?\s*\}\}/gi;

        for (const [filename, bytes] of Object.entries(unzippedFB)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezipFB[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (!tagRe.test(xml)) {
            rezipFB[filename] = [bytes, { level: 0 }];
            continue;
          }
          tagRe.lastIndex = 0;
          let hits = 0;
          xml = xml.replace(tagRe, (_m, side: string, glyphSuffix?: string) => {
            hits++;
            const isYes = side.toLowerCase() === "yes";
            if (glyphSuffix) return isYes ? yesGlyph : noGlyph;
            return isYes ? yesBool : noBool;
          });
          if (hits > 0) {
            rezipFB[filename] = [__xmlSet(filename, xml), { level: 0 }];
            mutatedFB = true;
            debugLog(
              `[generate-document] RE851D literal-tag fallback: replaced ${hits} pr_p_multipleProperties_* literal(s) in ${filename} (isMulti=${isMulti}, realCount=${realCount})`
            );
          } else {
            rezipFB[filename] = [bytes, { level: 0 }];
          }
        }

        if (mutatedFB) {
          processedDocx = __passZip(rezipFB);
        }
      } catch (fbErr) {
        console.error(
          `[generate-document] RE851D literal-tag fallback failed (continuing):`,
          fbErr instanceof Error ? fbErr.message : String(fbErr)
        );
      }
    }
    // ── RE851D POST-RENDER "Remain Unpaid" YES/NO safety pass ──
    // Mirrors the Owner-Occupied post-render pass. After processDocx wraps
    // standalone glyphs in <w:sdt> blocks with intrinsic <w14:checked> state,
    // simply flipping the visible glyph leaves Word rendering the SDT's own
    // checked state — producing the "both checked" symptom. Walk each
    // PROPERTY block and force exactly one mutually-exclusive YES/NO pair
    // anchored to the literal "YES" / "NO" labels following the question
    // "Do any of these payments remain unpaid?", using pr_li_currentDelinqu_K
    // (true → YES ☑ / NO ☐ ; false/missing → YES ☐ / NO ☑).
    if (/851d/i.test(template.name || "")) {
      try {
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          if (typeof raw === "number") return raw !== 0;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "checked", "on"].includes(s);
        };
        const unpaidByIdx: Record<number, boolean> = {};
        for (let k = 1; k <= 5; k++) {
          const yesAlias = fieldValues.get(`pr_li_remainUnpaid_${k}_yes`);
          const bareAlias = fieldValues.get(`pr_li_remainUnpaid_${k}`);
          unpaidByIdx[k] = yesAlias
            ? truthy(yesAlias.rawValue)
            : truthy(bareAlias?.rawValue);
        }

        const decoder3 = new TextDecoder("utf-8");
        const encoder3 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (__xmlGetLower(filename, xml).indexOf("remain unpaid") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          // Build "PROPERTY INFORMATION" anchors -> property indices 1..5.
          const propAnchors: number[] = [...__getVisProj(filename, xml).propAnchorsRaw];
          if (propAnchors.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchors.length; pi++) {
            propRanges.push({
              k: pi + 1,
              start: propAnchors[pi],
              end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
            });
          }

          const questionRe = /Do any of these payments remain unpaid|payments\s+remain\s+unpaid/gi;
          // Labels may be "YES"/"NO" or "Yes"/"No", optionally preceded by a
          // checkbox glyph or other inline characters within the same <w:t>.
          const yesLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:Y\s*E\s*S|Yes)\b[^<]*?<\/w:t>/gi;
          const noLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:N\s*O|No)\b[^<]*?<\/w:t>/gi;
          const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
          const sdtCheckboxRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;

          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          const rewriteSdtChecked = (block: string, checked: boolean): string => {
            const val = checked ? "1" : "0";
            const glyph = checked ? "\u2611" : "\u2610";
            let next = block.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
            next = next.replace(
              /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>)/,
              `$1${glyph}$3`,
            );
            return next;
          };

          // Find nearest preceding SDT checkbox or bare glyph run before label.
          // For "remain unpaid" the YES/NO controls appear AFTER the label text
          // in some templates, so we also try a forward search if none precede.
          const findControlNear = (
            labelStart: number,
            labelEnd: number,
            regionStart: number,
            regionEnd: number,
          ):
            | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
            | null => {
            const maxBack = 2500;
            // 1) preceding scan
            const scanStart = Math.max(regionStart, labelStart - maxBack);
            const before = xml.slice(scanStart, labelStart);
            let last:
              | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
              | null = null;
            const sdtRe = new RegExp(sdtCheckboxRe.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(before)) !== null) {
              last = { idx: scanStart + sm.index, end: scanStart + sm.index + sm[0].length, kind: "sdt", m: [sm[0]] };
            }
            if (last) return last;
            const gRe = new RegExp(glyphRunRe.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(before)) !== null) {
              last = { idx: scanStart + gm.index, end: scanStart + gm.index + gm[0].length, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] };
            }
            if (last) return last;
            // 2) forward scan (some templates: ☑ YES ☐ NO appears as glyph before label;
            // others as label then control). Cap at a short window.
            const fwdEnd = Math.min(regionEnd, labelEnd + 300);
            const after = xml.slice(labelEnd, fwdEnd);
            const sdtRe2 = new RegExp(sdtCheckboxRe.source, "g");
            const sm2 = sdtRe2.exec(after);
            if (sm2) {
              return { idx: labelEnd + sm2.index, end: labelEnd + sm2.index + sm2[0].length, kind: "sdt", m: [sm2[0]] };
            }
            const gRe2 = new RegExp(glyphRunRe.source, "g");
            const gm2 = gRe2.exec(after);
            if (gm2) {
              return { idx: labelEnd + gm2.index, end: labelEnd + gm2.index + gm2[0].length, kind: "glyph", m: [gm2[0], gm2[1], gm2[2], gm2[3]] };
            }
            return null;
          };

          let qm: RegExpExecArray | null;
          let scanned = 0;
          while ((qm = questionRe.exec(xml)) !== null) {
            scanned++;
            const qStart = qm.index;
            const region = propRanges.find((p) => qStart >= p.start && qStart < p.end);
            if (!region) { debugLog(`[generate-document] RE851D remain-unpaid: anchor@${qStart} not in any property region`); continue; }
            const winEnd = Math.min(region.end, qStart + 4096);

            yesLabelRe.lastIndex = qStart;
            noLabelRe.lastIndex = qStart;
            const yL = yesLabelRe.exec(xml);
            const nL = noLabelRe.exec(xml);
            if (!yL || !nL) { debugLog(`[generate-document] RE851D remain-unpaid PROP#${region.k}: no Y/N labels (yL=${!!yL}, nL=${!!nL})`); continue; }
            if (yL.index >= winEnd || nL.index >= winEnd) { debugLog(`[generate-document] RE851D remain-unpaid PROP#${region.k}: Y/N labels outside window`); continue; }

            const yC = findControlNear(yL.index, yL.index + yL[0].length, qStart, winEnd);
            const nC = findControlNear(nL.index, nL.index + nL[0].length, qStart, winEnd);
            if (!yC || !nC || yC.idx === nC.idx) { debugLog(`[generate-document] RE851D remain-unpaid PROP#${region.k}: missing/duplicate controls (yC=${yC?.kind || "none"}, nC=${nC?.kind || "none"})`); continue; }

            const isYes = unpaidByIdx[region.k] === true;
            const yesChecked = isYes;
            const noChecked = !isYes;

            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);
            if (overlaps(yC.idx, yC.end) || overlaps(nC.idx, nC.end)) { debugLog(`[generate-document] RE851D remain-unpaid PROP#${region.k}: overlap, skipping`); continue; }

            const yesReplacement =
              yC.kind === "sdt"
                ? rewriteSdtChecked(yC.m[0], yesChecked)
                : `${yC.m[1]}${yesChecked ? "\u2611" : "\u2610"}${yC.m[3]}`;
            const noReplacement =
              nC.kind === "sdt"
                ? rewriteSdtChecked(nC.m[0], noChecked)
                : `${nC.m[1]}${noChecked ? "\u2611" : "\u2610"}${nC.m[3]}`;

            rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
            rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
            debugLog(`[generate-document] RE851D remain-unpaid PROP#${region.k}: forced isYes=${isYes} (yC=${yC.kind}, nC=${nC.kind})`);
          }
          debugLog(`[generate-document] RE851D remain-unpaid: scanned ${scanned} anchor(s)`);

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render remain-unpaid safety pass: ${rewrites.length / 2} pairs forced in ${filename}`
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render remain-unpaid pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr)
        );
      }
    }

    // ── RE851D POST-RENDER "Cure the Delinquency" YES/NO safety pass ──
    // Anchored to "cure the delinquency" question per PROPERTY block.
    // Driven by pr_li_delinquencyPaidByLoan_K (Property→Lien "Will Be Paid By This Loan"):
    //   true  → YES ☑ / NO ☐
    //   false → YES ☐ / NO ☑
    if (/851d/i.test(template.name || "")) {
      try {
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          if (typeof raw === "number") return raw !== 0;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "checked", "on"].includes(s);
        };
        const cureByIdx: Record<number, boolean> = {};
        for (let k = 1; k <= 5; k++) {
          const v = fieldValues.get(`pr_li_delinquencyPaidByLoan_${k}`);
          cureByIdx[k] = truthy(v?.rawValue);
        }

        const decoder3 = new TextDecoder("utf-8");
        const encoder3 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          const xmlLowerCD = __xmlGetLower(filename, xml);
          if (xmlLowerCD.indexOf("cure the delinquency") === -1 && xmlLowerCD.indexOf("paid by this loan") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          const propAnchors: number[] = [...__getVisProj(filename, xml).propAnchorsRaw];
          if (propAnchors.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchors.length; pi++) {
            propRanges.push({
              k: pi + 1,
              start: propAnchors[pi],
              end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
            });
          }

          const questionRe = /cure the delinquency|paid by this loan/gi;
          const yesLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:Y\s*E\s*S|Yes)\b[^<]*?<\/w:t>/gi;
          const noLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:N\s*O|No)\b[^<]*?<\/w:t>/gi;
          const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
          const sdtCheckboxRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;

          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          const rewriteSdtChecked = (block: string, checked: boolean): string => {
            const val = checked ? "1" : "0";
            const glyph = checked ? "\u2611" : "\u2610";
            let next = block.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
            next = next.replace(
              /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>)/,
              `$1${glyph}$3`,
            );
            return next;
          };

          const findControlNear = (
            labelStart: number,
            labelEnd: number,
            regionStart: number,
            regionEnd: number,
          ):
            | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
            | null => {
            const maxBack = 2500;
            const scanStart = Math.max(regionStart, labelStart - maxBack);
            const before = xml.slice(scanStart, labelStart);
            let last:
              | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
              | null = null;
            const sdtRe = new RegExp(sdtCheckboxRe.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(before)) !== null) {
              last = { idx: scanStart + sm.index, end: scanStart + sm.index + sm[0].length, kind: "sdt", m: [sm[0]] };
            }
            if (last) return last;
            const gRe = new RegExp(glyphRunRe.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(before)) !== null) {
              last = { idx: scanStart + gm.index, end: scanStart + gm.index + gm[0].length, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] };
            }
            if (last) return last;
            const fwdEnd = Math.min(regionEnd, labelEnd + 300);
            const after = xml.slice(labelEnd, fwdEnd);
            const sdtRe2 = new RegExp(sdtCheckboxRe.source, "g");
            const sm2 = sdtRe2.exec(after);
            if (sm2) {
              return { idx: labelEnd + sm2.index, end: labelEnd + sm2.index + sm2[0].length, kind: "sdt", m: [sm2[0]] };
            }
            const gRe2 = new RegExp(glyphRunRe.source, "g");
            const gm2 = gRe2.exec(after);
            if (gm2) {
              return { idx: labelEnd + gm2.index, end: labelEnd + gm2.index + gm2[0].length, kind: "glyph", m: [gm2[0], gm2[1], gm2[2], gm2[3]] };
            }
            return null;
          };

          let qm: RegExpExecArray | null;
          let scanned = 0;
          while ((qm = questionRe.exec(xml)) !== null) {
            scanned++;
            const qStart = qm.index;
            const region = propRanges.find((p) => qStart >= p.start && qStart < p.end);
            if (!region) { debugLog(`[generate-document] RE851D cure-delinq: anchor@${qStart} not in any property region`); continue; }
            const winEnd = Math.min(region.end, qStart + 4096);

            yesLabelRe.lastIndex = qStart;
            noLabelRe.lastIndex = qStart;
            const yL = yesLabelRe.exec(xml);
            const nL = noLabelRe.exec(xml);
            if (!yL || !nL) { debugLog(`[generate-document] RE851D cure-delinq PROP#${region.k}: no Y/N labels (yL=${!!yL}, nL=${!!nL})`); continue; }
            if (yL.index >= winEnd || nL.index >= winEnd) { debugLog(`[generate-document] RE851D cure-delinq PROP#${region.k}: Y/N labels outside window`); continue; }

            const yC = findControlNear(yL.index, yL.index + yL[0].length, qStart, winEnd);
            const nC = findControlNear(nL.index, nL.index + nL[0].length, qStart, winEnd);
            if (!yC || !nC || yC.idx === nC.idx) { debugLog(`[generate-document] RE851D cure-delinq PROP#${region.k}: missing/duplicate controls (yC=${yC?.kind || "none"}, nC=${nC?.kind || "none"})`); continue; }

            const isYes = cureByIdx[region.k] === true;
            const yesChecked = isYes;
            const noChecked = !isYes;

            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);
            if (overlaps(yC.idx, yC.end) || overlaps(nC.idx, nC.end)) { debugLog(`[generate-document] RE851D cure-delinq PROP#${region.k}: overlap, skipping`); continue; }

            const yesReplacement =
              yC.kind === "sdt"
                ? rewriteSdtChecked(yC.m[0], yesChecked)
                : `${yC.m[1]}${yesChecked ? "\u2611" : "\u2610"}${yC.m[3]}`;
            const noReplacement =
              nC.kind === "sdt"
                ? rewriteSdtChecked(nC.m[0], noChecked)
                : `${nC.m[1]}${noChecked ? "\u2611" : "\u2610"}${nC.m[3]}`;

            rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
            rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
            debugLog(`[generate-document] RE851D cure-delinq PROP#${region.k}: forced isYes=${isYes} (yC=${yC.kind}, nC=${nC.kind})`);
          }
          debugLog(`[generate-document] RE851D cure-delinq: scanned ${scanned} anchor(s)`);

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render cure-delinquency safety pass: ${rewrites.length / 2} pairs forced in ${filename}`
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render cure-delinquency pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr)
        );
      }
    }

    // ── RE851D POST-RENDER "Source of Information" row safety pass ──
    // Anchors the paragraph that contains the three labels
    //   BROKER INQUIRY   BORROWER   OTHER (EXPLAIN)
    // and rewrites the paragraph body so each label is preceded by a single
    // resolved glyph (☑/☐) with a fixed space between glyph and label, and
    // the OTHER (EXPLAIN) value is appended after ": " (or blank when not
    // Other). Required because Word frequently fragments
    //   {{pr_li_sourceInfoBroker_N_glyph}} / _Borrower_ / _Other_ / _OtherText_
    // across <w:r>/<w:t> runs so the per-property _N→_K rewriter cannot stitch
    // them, leaving raw "…glyph}}" residue and no glyph/label spacing in the
    // generated document.
    //
    // Driven by the per-property publishers at lines ~3818-3824 / ~3937-3943:
    //   pr_li_sourceInfoBroker_K   (boolean)
    //   pr_li_sourceInfoBorrower_K (boolean)
    //   pr_li_sourceInfoOther_K    (boolean)
    //   pr_li_sourceInfoOtherText_K (string)
    if (/851d/i.test(template.name || "")) {
      try {
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          if (typeof raw === "number") return raw !== 0;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "checked", "on"].includes(s);
        };
        const xmlEsc = (s: string): string =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Build per-property source-info bundles for K=1..5.
        const siByIdx: Record<
          number,
          { broker: boolean; borrower: boolean; other: boolean; otherText: string }
        > = {};
        for (let k = 1; k <= 5; k++) {
          siByIdx[k] = {
            broker: truthy(fieldValues.get(`pr_li_sourceInfoBroker_${k}`)?.rawValue),
            borrower: truthy(fieldValues.get(`pr_li_sourceInfoBorrower_${k}`)?.rawValue),
            other: truthy(fieldValues.get(`pr_li_sourceInfoOther_${k}`)?.rawValue),
            otherText: String(
              fieldValues.get(`pr_li_sourceInfoOtherText_${k}`)?.rawValue ?? "",
            ).trim(),
          };
        }

        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          const lower = __xmlGetLower(filename, xml);
          if (
            lower.indexOf("broker inquiry") === -1 ||
            lower.indexOf("other (explain)") === -1
          ) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          const propAnchors = [...__getVisProj(filename, xml).propAnchorsRaw];
          // If we couldn't find PROPERTY INFORMATION anchors, default the
          // single-property case to region K=1 covering the whole document.
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          if (propAnchors.length === 0) {
            propRanges.push({ k: 1, start: 0, end: xml.length });
          } else {
            for (let pi = 0; pi < propAnchors.length; pi++) {
              propRanges.push({
                k: pi + 1,
                start: propAnchors[pi],
                end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
              });
            }
          }

          // Walk every <w:p>...</w:p>; rewrite only those whose visible text
          // contains all three labels (this is the source-of-info row).
          const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];
          let pm: RegExpExecArray | null;
          while ((pm = paraRe.exec(xml)) !== null) {
            const paraStart = pm.index;
            const paraEnd = paraStart + pm[0].length;
            const para = pm[0];
            const visibleRaw = para.replace(/<[^>]+>/g, "");
            const visible = visibleRaw.replace(/\s+/g, " ").toUpperCase();
            if (
              visible.indexOf("BROKER INQUIRY") === -1 ||
              visible.indexOf("BORROWER") === -1 ||
              visible.indexOf("OTHER (EXPLAIN)") === -1
            ) {
              continue;
            }
            // Word-boundary safety: skip if the only "BORROWER" hit is part of
            // a longer word (e.g. BORROWERS). We require the standalone token.
            if (!/\bBORROWER\b/.test(visible)) continue;

            const region =
              propRanges.find((p) => paraStart >= p.start && paraStart < p.end) ||
              propRanges[0];
            const k = region.k;
            const si = siByIdx[k] || { broker: false, borrower: false, other: false, otherText: "" };

            // Preserve <w:p ...> open tag and original <w:pPr> block (alignment,
            // tabs, indent, spacing) so layout matches the surrounding rows.
            const openMatch = para.match(/^<w:p\b[^>]*>/);
            if (!openMatch) continue;
            const open = openMatch[0];
            let body = para.slice(open.length, para.length - "</w:p>".length);
            let pprStr = "";
            const pprMatch = body.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
            if (pprMatch) {
              pprStr = pprMatch[0];
            }

            // Try to inherit run-properties from the first text-bearing run in
            // the original paragraph so font/size matches surrounding text.
            let inheritedRPr = "";
            const rPrMatch = para.match(
              /<w:r\b[^>]*>\s*(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)/,
            );
            if (rPrMatch) inheritedRPr = rPrMatch[1];

            const glyph = (on: boolean) => (on ? "\u2611" : "\u2610");
            const mkRun = (text: string): string =>
              `<w:r>${inheritedRPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;

            // Layout: "☐ BROKER INQUIRY   ☐ BORROWER   ☑ OTHER (EXPLAIN): Public Record"
            // Three spaces between groups preserves visual separation similar to
            // the original template's tab/spacing; single space between glyph
            // and label per spec.
            const otherSuffix =
              si.other && si.otherText.length > 0
                ? `: ${si.otherText}`
                : si.other
                ? ":"
                : ":";

            const runs = [
              mkRun(`${glyph(si.broker)} BROKER INQUIRY   `),
              mkRun(`${glyph(si.borrower)} BORROWER   `),
              mkRun(`${glyph(si.other)} OTHER (EXPLAIN)${otherSuffix}`),
            ].join("");

            const replacement = `${open}${pprStr}${runs}</w:p>`;
            rewrites.push({ start: paraStart, end: paraEnd, replacement });
            debugLog(
              `[generate-document] RE851D source-info PROP#${k}: rewrote row (broker=${si.broker}, borrower=${si.borrower}, other=${si.other}, otherText="${si.otherText}")`,
            );
          }

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render source-info safety pass: ${rewrites.length} row(s) rewritten in ${filename}`,
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render source-info pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr),
        );
      }
    }

    // ── RE851D POST-RENDER PROPERTY TYPE checkbox spacing safety pass ──
    // For every paragraph in the document whose visible text begins with a
    // checkbox glyph (☐ / ☑ / ☒) AND contains one of the seven PROPERTY TYPE
    // labels, normalize the gap between the glyph and its label to exactly
    // one regular space. Does NOT touch the glyph state, the label text,
    // <w:pPr> (alignment / tabs / indent / spacing), or <w:rPr> (font / size).
    // Idempotent — re-running on already-normalized XML is a no-op.
    if (/851d/i.test(template.name || "")) {
      try {
        const LABEL_PATTERN =
          "SINGLE-FAMILY RESIDENCE \\(owner occupied\\)|" +
          "SINGLE-FAMILY RESIDENCE \\(not owner occupied\\)|" +
          "SINGLE-FAMILY RESIDENCE \\(zoned residential lot/parcel\\)|" +
          "COMMERCIAL|LAND ZONED|LAND INCOME PRODUCING|OTHER";
        const labelTestRe = new RegExp(
          `(?<![A-Za-z])(?:${LABEL_PATTERN})(?![A-Za-z])`,
          "i",
        );
        const labelLeadRe = new RegExp(
          `(<w:t(?:\\s[^>]*)?>)[\\s\\u00A0]+(?=(?:${LABEL_PATTERN})(?![A-Za-z]))`,
          "gi",
        );

        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;
        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (!/[\u2610\u2611\u2612]/.test(xml) || !labelTestRe.test(xml)) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let count = 0;
          const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          xml = xml.replace(paraRe, (para) => {
            // Cheap visible-text gate: only rewrite paragraphs that visibly
            // begin with a checkbox glyph and contain one of the labels.
            const visible = para
              .replace(/<w:tab\s*\/?>/g, " ")
              .replace(/<w:br\s*\/?>/g, " ")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim();
            if (!/^[\u2610\u2611\u2612]/.test(visible)) return para;
            if (!labelTestRe.test(visible)) return para;

            let newPara = para;
            // 1) Drop stray <w:tab/> and <w:br/> elements that sit between
            //    the glyph run and the label run — they are the most common
            //    cause of the visible spacing inconsistency.
            newPara = newPara
              .replace(/<w:tab\s*\/?>/g, "")
              .replace(/<w:br\s*\/?>/g, "");
            // 2) Within each <w:t> body, collapse any whitespace (incl. NBSP)
            //    immediately following a checkbox glyph into exactly ONE
            //    regular space. Also inserts a space when the glyph is
            //    immediately followed by non-space content. Force
            //    xml:space="preserve" so the trailing space survives Word.
            newPara = newPara.replace(
              /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
              (_m, attrs: string | undefined, text: string) => {
                const t = text.replace(
                  /([\u2610\u2611\u2612])[\s\u00A0]*/g,
                  "$1 ",
                );
                const attrStr = attrs || "";
                const withPreserve = /xml:space\s*=/.test(attrStr)
                  ? attrStr
                  : `${attrStr} xml:space="preserve"`;
                return `<w:t${withPreserve}>${t}</w:t>`;
              },
            );
            // 3) Strip any leading whitespace in a <w:t> whose body begins
            //    with one of the PROPERTY TYPE labels — the prior glyph run
            //    now ends in a single space, so the label run must not add
            //    extra whitespace in front of itself.
            newPara = newPara.replace(labelLeadRe, "$1");

            if (newPara !== para) count++;
            return newPara;
          });
          if (count > 0) {
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render property-type spacing pass: ${count} row(s) normalized in ${filename}`,
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }
        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render property-type spacing pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr),
        );
      }
    }

    // ── RE851D POST-RENDER PROPERTY TYPE row alignment + SDT checkbox pass ──
    // Targets the 6 PROPERTY TYPE rows (3 left, 3 right) per property block
    // and, for every paragraph whose visible text matches one of the labels:
    //   1) strips stray <w:br/> runs (the COMMERCIAL & INCOME-PRODUCING row
    //      is shipped with two extra <w:br/> elements before the glyph, which
    //      vertically misaligns it against the SFR owner-occupied row);
    //   2) forces <w:pPr><w:spacing/> to the exact reference attributes for
    //      that row index (rows 1/2/3 -> before/after/line tuples);
    //   3) wraps any plain-text checkbox glyph (☐/☑/☒) in a <w:sdt> content
    //      control with <w14:checkbox>, preserving the checked state derived
    //      from the existing glyph and the original <w:rPr>.
    // Idempotent. Leaves placeholders, label text, alignment, tabs, indents,
    // <w:rPr>, table grid, and column widths untouched.
    if (/851d/i.test(template.name || "")) {
      try {
        const ROW_LABELS: Array<{ row: 1 | 2 | 3; label: RegExp }> = [
          { row: 1, label: /SINGLE-FAMILY RESIDENCE \(owner\s+occupied\)/i },
          { row: 1, label: /COMMERCIAL\s*&(?:amp;)?\s*INCOME[-\s]?PRODUCING/i },
          { row: 2, label: /SINGLE-FAMILY RESIDENCE \(not owner\s+occupied\)/i },
          { row: 2, label: /LAND\s*\(?zoned\s+commercial\/residential\)?/i },
          { row: 3, label: /SINGLE-FAMILY RESIDENCE \(zoned residential lot\/parcel\)/i },
          { row: 3, label: /LAND\s*\(income[-\s]?producing\)/i },
          { row: 3, label: /(?:^|[\s>\u2610\u2611\u2612])OTHER:/i },
        ];
        const ROW_SPACING: Record<1 | 2 | 3, string> = {
          1: `<w:spacing w:before="26" w:after="100" w:line="181" w:lineRule="auto"/>`,
          2: `<w:spacing w:before="12" w:after="100" w:line="181" w:lineRule="auto"/>`,
          3: `<w:spacing w:before="12" w:after="100" w:line="173" w:lineRule="auto"/>`,
        };

        const detectRow = (visible: string): 1 | 2 | 3 | null => {
          const hit = ROW_LABELS.find(({ label }) => label.test(visible));
          return hit ? hit.row : null;
        };

        const setRowSpacing = (para: string, row: 1 | 2 | 3): string => {
          const spacingXml = ROW_SPACING[row];
          const open = para.match(/^<w:p\b[^>]*>/);
          if (!open) return para;
          const pprRe = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/;
          const pprMatch = para.match(pprRe);
          if (!pprMatch) {
            return para.replace(
              open[0],
              `${open[0]}<w:pPr>${spacingXml}</w:pPr>`,
            );
          }
          const inner = pprMatch[1];
          if (/<w:spacing\b[^/]*\/>/.test(inner)) {
            const newInner = inner.replace(
              /<w:spacing\b[^/]*\/>/,
              spacingXml,
            );
            return para.replace(pprMatch[0], `<w:pPr>${newInner}</w:pPr>`);
          }
          let newInner = inner;
          if (/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/.test(newInner)) {
            newInner = newInner.replace(
              /(<\/w:numPr>)/,
              `$1${spacingXml}`,
            );
          } else if (/<w:pStyle\b[^/]*\/>/.test(newInner)) {
            newInner = newInner.replace(
              /(<w:pStyle\b[^/]*\/>)/,
              `$1${spacingXml}`,
            );
          } else {
            newInner = spacingXml + newInner;
          }
          return para.replace(pprMatch[0], `<w:pPr>${newInner}</w:pPr>`);
        };

        const GLYPH_RE = /[\u2610\u2611\u2612]/;
        let __sdtCounter = 900000;

        const wrapPlainGlyphs = (para: string): string => {
          const sdtRanges: Array<[number, number]> = [];
          const sdtRe = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;
          let sm: RegExpExecArray | null;
          while ((sm = sdtRe.exec(para)) !== null) {
            sdtRanges.push([sm.index, sm.index + sm[0].length]);
          }
          const inSdt = (pos: number): boolean =>
            sdtRanges.some(([s, e]) => pos >= s && pos < e);

          const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
          const out: string[] = [];
          let cursor = 0;
          let rm: RegExpExecArray | null;
          while ((rm = runRe.exec(para)) !== null) {
            if (inSdt(rm.index)) continue;
            const runXml = rm[0];
            const tMatch = runXml.match(
              /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/,
            );
            if (!tMatch) continue;
            const body = tMatch[1];
            const glyphMatch = body.match(GLYPH_RE);
            if (!glyphMatch) continue;
            // Accept either "just the glyph" OR "glyph + trailing whitespace"
            // (covers the LAND (income-producing) plain-text "☐ " run that
            // ships unwrapped on instances 3/4/5). Mixed runs that carry
            // label text are still left alone — we never split label runs.
            if (
              !/^[\s\u00A0]*[\u2610\u2611\u2612][\s\u00A0]*$/.test(body)
            ) {
              continue;
            }
            const glyph = glyphMatch[0];
            const checked = glyph === "\u2610" ? 0 : 1;
            const id = ++__sdtCounter;
            const sdt =
              `<w:sdt>` +
              `<w:sdtPr>` +
              `<w:id w:val="${id}"/>` +
              `<w14:checkbox>` +
              `<w14:checked w14:val="${checked}"/>` +
              `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
              `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
              `</w14:checkbox>` +
              `</w:sdtPr>` +
              `<w:sdtContent>${runXml}</w:sdtContent>` +
              `</w:sdt>`;
            out.push(para.slice(cursor, rm.index));
            out.push(sdt);
            cursor = rm.index + runXml.length;
          }
          if (out.length === 0) return para;
          out.push(para.slice(cursor));
          return out.join("");
        };

        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;
        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (
            !/SINGLE-FAMILY RESIDENCE|COMMERCIAL|LAND\s*\(?zoned|LAND\s*\(income|OTHER:/i
              .test(xml)
          ) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let count = 0;

          // ── Pre-pass: split instance-5 "LAND (income-producing) … OTHER:" ──
          // Some instances ship a single <w:p> whose visible text contains
          // BOTH "LAND (income-producing)" AND "OTHER:" concatenated in one
          // run. Replace that paragraph with two sibling paragraphs (row 3
          // spacing) so downstream passes see two well-formed rows.
          const splitParaRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          xml = xml.replace(splitParaRe, (para) => {
            const visible = para
              .replace(/<w:tab\s*\/?>/g, " ")
              .replace(/<w:br\s*\/?>/g, " ")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim();
            if (
              !/LAND\s*\(income[-\s]?producing\)/i.test(visible) ||
              !/OTHER:/i.test(visible)
            ) {
              return para;
            }
            // Locate the offending mixed-content run that carries both
            // labels — it's the run whose <w:t> body contains "LAND " AND
            // "OTHER:".
            const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
            let offending: { run: string; tStart: number } | null = null;
            let rm: RegExpExecArray | null;
            while ((rm = runRe.exec(para)) !== null) {
              const rXml = rm[0];
              const tMatch = rXml.match(
                /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/,
              );
              if (!tMatch) continue;
              if (
                /LAND\s*\(income/i.test(tMatch[1]) &&
                /OTHER:/i.test(tMatch[1])
              ) {
                offending = { run: rXml, tStart: rm.index };
                break;
              }
            }
            if (!offending) return para;

            // Extract <w:rPr> from the source run (preserve formatting).
            const rprMatch = offending.run.match(
              /<w:rPr\b[\s\S]*?<\/w:rPr>/,
            );
            const rPr = rprMatch ? rprMatch[0] : "";

            // Detect index N from any nearby placeholder if present.
            const idxMatch = para.match(/property_type_other_text_(\d+)/);
            const idxToken = idxMatch ? idxMatch[1] : "N";

            const sdtFor = (glyph: string, id: number): string =>
              `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w14:checkbox>` +
              `<w14:checked w14:val="${
                glyph === "\u2610" ? 0 : 1
              }"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
              `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
              `</w14:checkbox></w:sdtPr><w:sdtContent>` +
              `<w:r>${rPr}<w:t xml:space="preserve">${glyph} </w:t></w:r>` +
              `</w:sdtContent></w:sdt>`;

            const labelRun = (text: string): string =>
              `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

            const pPr = `<w:pPr>${ROW_SPACING[3]}</w:pPr>`;
            const idA = 940001;
            const idB = 940002;
            const paraA =
              `<w:p>${pPr}${sdtFor("\u2610", idA)}` +
              `${labelRun("LAND (income-producing)")}</w:p>`;
            const paraB =
              `<w:p>${pPr}${sdtFor("\u2610", idB)}` +
              `${labelRun(`OTHER: {{property_type_other_text_${idxToken}}}`)}</w:p>`;

            count++;
            return `${paraA}${paraB}`;
          });

          const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          xml = xml.replace(paraRe, (para) => {
            const visible = para
              .replace(/<w:tab\s*\/?>/g, " ")
              .replace(/<w:br\s*\/?>/g, " ")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim();
            const row = detectRow(visible);
            if (!row) return para;
            let next = para;
            // 1) Strip stray <w:br/> runs from the row.
            next = next.replace(/<w:br\s*\/?>/g, "");
            // 2) Force exact spacing for the row index.
            next = setRowSpacing(next, row);
            // 3) Promote plain-text glyph runs to <w:sdt><w14:checkbox/></w:sdt>.
            next = wrapPlainGlyphs(next);
            // 4) Normalize "owner   occupied" → "owner occupied" inside <w:t>.
            if (/SINGLE-FAMILY RESIDENCE \(owner\s+occupied\)/i.test(visible)) {
              next = next.replace(
                /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
                (_m, attrs: string | undefined, t: string) =>
                  `<w:t${attrs || ""}>${t.replace(
                    /(owner)[\s\u00A0]{2,}(occupied)/gi,
                    "$1 $2",
                  )}</w:t>`,
              );
            }
            // 5) Insert missing space after LAND in "LAND(zoned commercial/residential)".
            if (/LAND\(zoned\s+commercial\/residential\)/i.test(visible)) {
              next = next.replace(
                /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
                (_m, attrs: string | undefined, t: string) =>
                  `<w:t${attrs || ""}>${t.replace(
                    /LAND\(zoned/g,
                    "LAND (zoned",
                  )}</w:t>`,
              );
            }
            if (next !== para) count++;
            return next;
          });
          if (count > 0) {
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render property-type alignment pass: ${count} row(s) normalized in ${filename}`,
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }
        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render property-type alignment pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr),
        );
      }
    }







    // ── RE851D POST-RENDER encumbrance-question paragraph cleanup ──
    // Some merge values upstream emit leading/trailing <w:br/> runs into the
    // paragraph that contains "Are there any encumbrances of record..." or
    // "Over the last 12 months, were any payments more than 60 days late?".
    // Those stray soft breaks push the question to the bottom of one page and
    // strand the YES/NO row at the top of the next page, which is the visible
    // mismatch against the reference RE851D template. Strip leading and
    // trailing <w:br/> runs (and whitespace-only runs) from those question
    // paragraphs so the block stays together like the original template.
    if (/851d/i.test(template.name || "")) {
      try {
        const QUESTION_PHRASES = [
          "encumbrances of record against the securing property",
          "payments more than 60 days late",
        ];
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;
        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          const lower = xml.toLowerCase();
          if (!QUESTION_PHRASES.some((p) => lower.indexOf(p) !== -1)) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          // Match every <w:p>...</w:p>; rewrite only those whose visible text
          // contains one of the question phrases.
          const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          let mutated = false;
          xml = xml.replace(paraRe, (para) => {
            const visible = para
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .toLowerCase();
            if (!QUESTION_PHRASES.some((p) => visible.indexOf(p) !== -1)) {
              return para;
            }
            const openMatch = para.match(/^<w:p\b[^>]*>/);
            if (!openMatch) return para;
            const open = openMatch[0];
            let body = para.slice(open.length, para.length - "</w:p>".length);

            // Skip optional pPr block — only act on runs that follow it.
            let prefix = "";
            const pprMatch = body.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
            if (pprMatch) {
              prefix = pprMatch[0];
              body = body.slice(prefix.length);
            }

            // Tokenize: keep <w:r>...</w:r> blocks and inter-run whitespace.
            const runs: Array<{ kind: "run" | "other"; text: string }> = [];
            const tokenRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
            let cursor = 0;
            let rm: RegExpExecArray | null;
            while ((rm = tokenRe.exec(body)) !== null) {
              if (rm.index > cursor) {
                runs.push({ kind: "other", text: body.slice(cursor, rm.index) });
              }
              runs.push({ kind: "run", text: rm[0] });
              cursor = rm.index + rm[0].length;
            }
            if (cursor < body.length) {
              runs.push({ kind: "other", text: body.slice(cursor) });
            }

            const isStripRun = (txt: string): boolean => {
              if (!/^<w:r\b/.test(txt)) return false;
              // Run that contains <w:br/> AND no visible text or <w:t> with
              // only whitespace.
              const hasBr = /<w:br\b[^>]*\/>/.test(txt);
              const tMatches = [...txt.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)];
              const visibleText = tMatches.map((m) => m[1]).join("");
              const onlyWs = visibleText.replace(/\s+/g, "") === "";
              if (hasBr && onlyWs) return true;
              // Also strip pure whitespace-only <w:t> runs that have nothing
              // else (no break, no drawing).
              if (
                onlyWs &&
                !/<w:drawing\b/.test(txt) &&
                !/<w:tab\b/.test(txt) &&
                !/<w:sym\b/.test(txt) &&
                tMatches.length > 0
              ) {
                return true;
              }
              return false;
            };

            // Locate first/last "real" run (i.e. not a strippable break/ws run).
            let firstReal = -1;
            let lastReal = -1;
            for (let i = 0; i < runs.length; i++) {
              if (runs[i].kind !== "run") continue;
              if (!isStripRun(runs[i].text)) {
                if (firstReal === -1) firstReal = i;
                lastReal = i;
              }
            }
            if (firstReal === -1) return para; // nothing to keep — leave alone.

            const trimmed: typeof runs = [];
            let changed = false;
            for (let i = 0; i < runs.length; i++) {
              if (runs[i].kind === "other") {
                // Drop inter-run whitespace outside the [firstReal..lastReal]
                // span; keep inner whitespace as-is.
                if (i < firstReal || i > lastReal) {
                  if (runs[i].text.trim() !== "") {
                    trimmed.push(runs[i]);
                  } else if (runs[i].text.length > 0) {
                    changed = true;
                  }
                } else {
                  trimmed.push(runs[i]);
                }
                continue;
              }
              if (i < firstReal || i > lastReal) {
                if (isStripRun(runs[i].text)) {
                  changed = true;
                  continue;
                }
              }
              trimmed.push(runs[i]);
            }

            if (!changed) return para;
            mutated = true;
            const newBody = prefix + trimmed.map((t) => t.text).join("");
            return open + newBody + "</w:p>";
          });

          if (mutated) {
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D encumbrance-question cleanup: stripped leading/trailing breaks in ${filename}`,
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }
        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D encumbrance-question cleanup failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr),
        );
      }
    }

    // ── RE851D POST-RENDER "60 day(s) or more delinquent" YES/NO safety pass ──
    // Anchored to the Q2 question text per PROPERTY block.
    // Driven by pr_li_delinqu60day_K (delinquencies_how_many > 0).
    if (/851d/i.test(template.name || "")) {
      try {
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          if (typeof raw === "number") return raw !== 0;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "checked", "on"].includes(s);
        };
        const sixtyByIdx: Record<number, boolean> = {};
        for (let k = 1; k <= 5; k++) {
          const v = fieldValues.get(`pr_li_delinqu60day_${k}`);
          sixtyByIdx[k] = truthy(v?.rawValue);
        }

        const decoder3 = new TextDecoder("utf-8");
        const encoder3 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          const xmlLower60 = __xmlGetLower(filename, xml);
          if (xmlLower60.indexOf("60 day") === -1 && xmlLower60.indexOf("60-day") === -1 && xmlLower60.indexOf("sixty day") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          const propAnchors: number[] = [...__getVisProj(filename, xml).propAnchorsRaw];
          if (propAnchors.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchors.length; pi++) {
            propRanges.push({
              k: pi + 1,
              start: propAnchors[pi],
              end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
            });
          }

          const questionRe = /payments?\s+more\s+than\s+60\s*[-\s]?\s*days?\s+late|60[\s\-]?day(?:s)?\s+or\s+more\s+delinquent|60[\s\-]?day(?:s)?\s+delinquen|sixty\s+day(?:s)?\s+delinquen|60\s+days?\s+late/gi;
          const yesLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:Y\s*E\s*S|Yes)\b[^<]*?<\/w:t>/gi;
          const noLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:N\s*O|No)\b[^<]*?<\/w:t>/gi;
          const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
          const sdtCheckboxRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;

          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          const rewriteSdtChecked = (block: string, checked: boolean): string => {
            const val = checked ? "1" : "0";
            const glyph = checked ? "\u2611" : "\u2610";
            let next = block.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
            next = next.replace(
              /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>)/,
              `$1${glyph}$3`,
            );
            return next;
          };

          const findControlNear = (
            labelStart: number,
            labelEnd: number,
            regionStart: number,
            regionEnd: number,
          ):
            | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
            | null => {
            const maxBack = 2500;
            const scanStart = Math.max(regionStart, labelStart - maxBack);
            const before = xml.slice(scanStart, labelStart);
            let last:
              | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
              | null = null;
            const sdtRe = new RegExp(sdtCheckboxRe.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(before)) !== null) {
              last = { idx: scanStart + sm.index, end: scanStart + sm.index + sm[0].length, kind: "sdt", m: [sm[0]] };
            }
            if (last) return last;
            const gRe = new RegExp(glyphRunRe.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(before)) !== null) {
              last = { idx: scanStart + gm.index, end: scanStart + gm.index + gm[0].length, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] };
            }
            if (last) return last;
            const fwdEnd = Math.min(regionEnd, labelEnd + 300);
            const after = xml.slice(labelEnd, fwdEnd);
            const sdtRe2 = new RegExp(sdtCheckboxRe.source, "g");
            const sm2 = sdtRe2.exec(after);
            if (sm2) {
              return { idx: labelEnd + sm2.index, end: labelEnd + sm2.index + sm2[0].length, kind: "sdt", m: [sm2[0]] };
            }
            const gRe2 = new RegExp(glyphRunRe.source, "g");
            const gm2 = gRe2.exec(after);
            if (gm2) {
              return { idx: labelEnd + gm2.index, end: labelEnd + gm2.index + gm2[0].length, kind: "glyph", m: [gm2[0], gm2[1], gm2[2], gm2[3]] };
            }
            return null;
          };

          let qm: RegExpExecArray | null;
          let scanned = 0;
          while ((qm = questionRe.exec(xml)) !== null) {
            scanned++;
            const qStart = qm.index;
            const region = propRanges.find((p) => qStart >= p.start && qStart < p.end);
            if (!region) { debugLog(`[generate-document] RE851D 60-day: anchor@${qStart} not in any property region`); continue; }
            const winEnd = Math.min(region.end, qStart + 4096);

            yesLabelRe.lastIndex = qStart;
            noLabelRe.lastIndex = qStart;
            const yL = yesLabelRe.exec(xml);
            const nL = noLabelRe.exec(xml);
            if (!yL || !nL) { debugLog(`[generate-document] RE851D 60-day PROP#${region.k}: no Y/N labels`); continue; }
            if (yL.index >= winEnd || nL.index >= winEnd) continue;

            const yC = findControlNear(yL.index, yL.index + yL[0].length, qStart, winEnd);
            const nC = findControlNear(nL.index, nL.index + nL[0].length, qStart, winEnd);
            if (!yC || !nC || yC.idx === nC.idx) { debugLog(`[generate-document] RE851D 60-day PROP#${region.k}: missing/duplicate controls`); continue; }

            const isYes = sixtyByIdx[region.k] === true;
            const yesChecked = isYes;
            const noChecked = !isYes;

            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);
            if (overlaps(yC.idx, yC.end) || overlaps(nC.idx, nC.end)) continue;

            const yesReplacement =
              yC.kind === "sdt"
                ? rewriteSdtChecked(yC.m[0], yesChecked)
                : `${yC.m[1]}${yesChecked ? "\u2611" : "\u2610"}${yC.m[3]}`;
            const noReplacement =
              nC.kind === "sdt"
                ? rewriteSdtChecked(nC.m[0], noChecked)
                : `${nC.m[1]}${noChecked ? "\u2611" : "\u2610"}${nC.m[3]}`;

            rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
            rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
            debugLog(`[generate-document] RE851D 60-day PROP#${region.k}: forced isYes=${isYes}`);
          }
          debugLog(`[generate-document] RE851D 60-day: scanned ${scanned} anchor(s)`);

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render 60-day safety pass: ${rewrites.length / 2} pairs forced in ${filename}`
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render 60-day pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr)
        );
      }
    }

    // Template uses static ??? + ☐ glyphs (no merge tag) per PROPERTY block.
    // Driven by pr_li_encumbranceOfRecord_K (paid_off rule):
    //   true  → YES ☑ / NO ☐    false → YES ☐ / NO ☑
    if (/851d/i.test(template.name || "")) {
      try {
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          if (typeof raw === "number") return raw !== 0;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "checked", "on"].includes(s);
        };
        const encByIdx: Record<number, boolean> = {};
        for (let k = 1; k <= 5; k++) {
          const v = fieldValues.get(`pr_li_encumbranceOfRecord_${k}_yes`)
            ?? fieldValues.get(`pr_li_encumbranceOfRecord_${k}`);
          encByIdx[k] = truthy(v?.rawValue);
        }

        const decoder3 = new TextDecoder("utf-8");
        const encoder3 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (__xmlGetLower(filename, xml).indexOf("encumbrances of record") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          const propAnchors: number[] = [...__getVisProj(filename, xml).propAnchorsRaw];
          if (propAnchors.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchors.length; pi++) {
            propRanges.push({
              k: pi + 1,
              start: propAnchors[pi],
              end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
            });
          }

          const questionRe = /Are there any encumbrances of record|encumbrances of record/gi;
          const yesLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:Y\s*E\s*S|Yes)\b[^<]*?<\/w:t>/gi;
          const noLabelRe = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:N\s*O|No)\b[^<]*?<\/w:t>/gi;
          const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>\s*<\/w:r>)/g;
          const sdtCheckboxRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;

          type Rewrite = { start: number; end: number; replacement: string };
          const rewrites: Rewrite[] = [];

          const rewriteSdtChecked = (block: string, checked: boolean): string => {
            const val = checked ? "1" : "0";
            const glyph = checked ? "\u2611" : "\u2610";
            let next = block.replace(
              /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
              `$1${val}$2`,
            );
            next = next.replace(
              /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☑])(<\/w:t>)/,
              `$1${glyph}$3`,
            );
            return next;
          };

          const findControlNear = (
            labelStart: number,
            labelEnd: number,
            regionStart: number,
            regionEnd: number,
          ):
            | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
            | null => {
            const maxBack = 2500;
            const scanStart = Math.max(regionStart, labelStart - maxBack);
            const before = xml.slice(scanStart, labelStart);
            let last:
              | { idx: number; end: number; kind: "sdt" | "glyph"; m: string[] }
              | null = null;
            const sdtRe = new RegExp(sdtCheckboxRe.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(before)) !== null) {
              last = { idx: scanStart + sm.index, end: scanStart + sm.index + sm[0].length, kind: "sdt", m: [sm[0]] };
            }
            if (last) return last;
            const gRe = new RegExp(glyphRunRe.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(before)) !== null) {
              last = { idx: scanStart + gm.index, end: scanStart + gm.index + gm[0].length, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] };
            }
            if (last) return last;
            const fwdEnd = Math.min(regionEnd, labelEnd + 300);
            const after = xml.slice(labelEnd, fwdEnd);
            const sdtRe2 = new RegExp(sdtCheckboxRe.source, "g");
            const sm2 = sdtRe2.exec(after);
            if (sm2) {
              return { idx: labelEnd + sm2.index, end: labelEnd + sm2.index + sm2[0].length, kind: "sdt", m: [sm2[0]] };
            }
            const gRe2 = new RegExp(glyphRunRe.source, "g");
            const gm2 = gRe2.exec(after);
            if (gm2) {
              return { idx: labelEnd + gm2.index, end: labelEnd + gm2.index + gm2[0].length, kind: "glyph", m: [gm2[0], gm2[1], gm2[2], gm2[3]] };
            }
            return null;
          };

          let qm: RegExpExecArray | null;
          let scanned = 0;
          while ((qm = questionRe.exec(xml)) !== null) {
            scanned++;
            const qStart = qm.index;
            const region = propRanges.find((p) => qStart >= p.start && qStart < p.end);
            if (!region) { debugLog(`[generate-document] RE851D enc-of-record: anchor@${qStart} not in any property region`); continue; }
            const winEnd = Math.min(region.end, qStart + 4096);

            yesLabelRe.lastIndex = qStart;
            noLabelRe.lastIndex = qStart;
            const yL = yesLabelRe.exec(xml);
            const nL = noLabelRe.exec(xml);
            if (!yL || !nL) { debugLog(`[generate-document] RE851D enc-of-record PROP#${region.k}: no Y/N labels (yL=${!!yL}, nL=${!!nL})`); continue; }
            if (yL.index >= winEnd || nL.index >= winEnd) { debugLog(`[generate-document] RE851D enc-of-record PROP#${region.k}: Y/N labels outside window`); continue; }

            const yC = findControlNear(yL.index, yL.index + yL[0].length, qStart, winEnd);
            const nC = findControlNear(nL.index, nL.index + nL[0].length, qStart, winEnd);
            if (!yC || !nC || yC.idx === nC.idx) { debugLog(`[generate-document] RE851D enc-of-record PROP#${region.k}: missing/duplicate controls (yC=${yC?.kind || "none"}, nC=${nC?.kind || "none"})`); continue; }

            const isYes = encByIdx[region.k] === true;
            const yesChecked = isYes;
            const noChecked = !isYes;

            const overlaps = (s: number, e: number) =>
              rewrites.some((r) => s < r.end && e > r.start);
            if (overlaps(yC.idx, yC.end) || overlaps(nC.idx, nC.end)) { debugLog(`[generate-document] RE851D enc-of-record PROP#${region.k}: overlap, skipping`); continue; }

            const yesReplacement =
              yC.kind === "sdt"
                ? rewriteSdtChecked(yC.m[0], yesChecked)
                : `${yC.m[1]}${yesChecked ? "\u2611" : "\u2610"}${yC.m[3]}`;
            const noReplacement =
              nC.kind === "sdt"
                ? rewriteSdtChecked(nC.m[0], noChecked)
                : `${nC.m[1]}${noChecked ? "\u2611" : "\u2610"}${nC.m[3]}`;

            rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
            rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
            debugLog(`[generate-document] RE851D enc-of-record PROP#${region.k}: forced isYes=${isYes} (yC=${yC.kind}, nC=${nC.kind})`);
          }
          debugLog(`[generate-document] RE851D enc-of-record: scanned ${scanned} anchor(s)`);

          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) {
              xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
            }
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
            debugLog(
              `[generate-document] RE851D post-render encumbrance-of-record safety pass: ${rewrites.length / 2} pairs forced in ${filename}`
            );
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render encumbrance-of-record pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr)
        );
      }
    }

    // ── RE851D Additional Encumbrances Attachment: post-render YES/NO + addendum ──
    // For each property, if the published pr_li_additionalEncumbrance_<N> flag is
    // YES (count of remaining liens > 2 OR anticipated liens > 2), force the
    // matching "set forth in an attachment" YES checkbox (NO if false), then
    // append an Addendum section at the end of word/document.xml listing the
    // overflow liens (3rd onward) split by Remaining vs Anticipated.
    if (isEncumbrancePipeline) {
      try {
        // Re-derive per-property remaining/anticipated lien lists from fieldValues.
        const lienPrefixesAEA = new Set<string>();
        for (const k of fieldValues.keys()) {
          const m = k.match(/^(lien\d+)\./);
          if (m) lienPrefixesAEA.add(m[1]);
        }
        const orderedLiensAEA = [...lienPrefixesAEA].sort((a, b) =>
          parseInt(a.replace("lien", ""), 10) - parseInt(b.replace("lien", ""), 10)
        );
        const remByProp: Record<number, string[]> = {};
        const antByProp: Record<number, string[]> = {};
        for (const lp of orderedLiensAEA) {
          const propRaw = String(fieldValues.get(`${lp}.property`)?.rawValue ?? "").trim();
          const pm = propRaw.match(/^property(\d+)$/);
          if (!pm) continue;
          const pIdx = parseInt(pm[1], 10);
          const antRaw = String(fieldValues.get(`${lp}.anticipated`)?.rawValue ?? "").trim().toLowerCase();
          const isAnt = antRaw !== "" && antRaw !== "no" && antRaw !== "false" && antRaw !== "0" && antRaw !== "off";
          const bucket = isAnt ? antByProp : remByProp;
          if (!bucket[pIdx]) bucket[pIdx] = [];
          bucket[pIdx].push(lp);
        }
        const yesPropIdx = new Set<number>();
        for (const pIdx of new Set<number>([
          ...Object.keys(remByProp).map(s => parseInt(s, 10)),
          ...Object.keys(antByProp).map(s => parseInt(s, 10)),
        ])) {
          const remN = remByProp[pIdx]?.length ?? 0;
          const antN = antByProp[pIdx]?.length ?? 0;
          if (remN > 2 || antN > 2) yesPropIdx.add(pIdx);
        }

        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        const sdtCheckboxReAEA = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;
        const glyphRunReAEA = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([☐☑☒])(<\/w:t>\s*<\/w:r>)/g;
        // Image-based checkbox: a run containing a <w:drawing> (PNG of empty/checked box)
        const drawingRunReAEA = /<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:drawing\b[\s\S]*?<\/w:drawing>\s*<\/w:r>/g;
        const yesLabelReSrc = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:Y\s*E\s*S|Yes)\b[^<]*?<\/w:t>/gi;
        const noLabelReSrc  = /<w:t(?:\s[^>]*)?>[^<]*?\b(?:N\s*O|No)\b[^<]*?<\/w:t>/gi;

        const rewriteSdtCheckedAEA = (block: string, checked: boolean): string => {
          const val = checked ? "1" : "0";
          const glyph = checked ? "\u2611" : "\u2610";
          let next = block.replace(/(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/, `$1${val}$2`);
          next = next.replace(/(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)([☐☑☒])(<\/w:t>)/, `$1${glyph}$3`);
          return next;
        };
        // Replace an image-based checkbox run with a glyph run (☑ checked / ☐ unchecked).
        // Uses Segoe UI Symbol so the glyph renders consistently across Word/LibreOffice.
        const rewriteDrawingRunAEA = (_block: string, checked: boolean): string => {
          const glyph = checked ? "\u2611" : "\u2610";
          return `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${glyph}</w:t></w:r>`;
        };

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          // Cheap cached-lowercase pre-filter: skip parts (typically every
          // header/footer and most documents) whose XML cannot contain the
          // anchor text OR an addendum insertion site. Avoids building the
          // multi-MB visible-text projection + its lowercase copy on every
          // content part — a major CPU sink on 5-property RE851D documents.
          {
            const xmlLowerAEA = __xmlGetLower(filename, xml);
            const couldHaveAnchor =
              xmlLowerAEA.indexOf("set forth in an attachment") !== -1;
            const couldNeedAddendum =
              filename === "word/document.xml" && yesPropIdx.size > 0;
            if (!couldHaveAnchor && !couldNeedAddendum) {
              rezip[filename] = [bytes, { level: 0 }];
              continue;
            }
          }
          // Use the visible-text projection so anchor + Yes/No label matching
          // works even when Word fragments the phrase across multiple
          // <w:r><w:t>…</w:t></w:r> runs (the prior raw-XML scan silently
          // failed in that — very common — case, leaving the YES checkbox
          // unchecked on every property).
          const projAEA = __getVisProj(filename, xml);
          const txtAEA = projAEA.txt;
          const txtLowerAEA = txtAEA.toLowerCase();
          const hasAnchor = txtLowerAEA.indexOf("set forth in an attachment") !== -1;

          // Build property regions (only used by Pass A) from the projection's
          // raw-xml anchors. propRanges values are already xml indices.
          const propAnchors: number[] = [...projAEA.propAnchorsRaw];
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          if (propAnchors.length === 0) {
            propRanges.push({ k: 1, start: 0, end: xml.length });
          } else {
            for (let pi = 0; pi < propAnchors.length; pi++) {
              propRanges.push({
                k: pi + 1,
                start: propAnchors[pi],
                end: pi + 1 < propAnchors.length ? propAnchors[pi + 1] : xml.length,
              });
            }
          }

          type RewriteAEA = { start: number; end: number; replacement: string };
          const rewrites: RewriteAEA[] = [];

          const findControlNearAEA = (
            labelStart: number, labelEnd: number, regionStart: number, regionEnd: number,
          ): { idx: number; end: number; kind: "sdt" | "glyph" | "drawing"; m: string[] } | null => {
            const maxBack = 2500;
            const scanStart = Math.max(regionStart, labelStart - maxBack);
            const before = xml.slice(scanStart, labelStart);
            let last: { idx: number; end: number; kind: "sdt" | "glyph" | "drawing"; m: string[] } | null = null;
            const sdtRe = new RegExp(sdtCheckboxReAEA.source, "g");
            let sm: RegExpExecArray | null;
            while ((sm = sdtRe.exec(before)) !== null) {
              last = { idx: scanStart + sm.index, end: scanStart + sm.index + sm[0].length, kind: "sdt", m: [sm[0]] };
            }
            if (last) return last;
            const gRe = new RegExp(glyphRunReAEA.source, "g");
            let gm: RegExpExecArray | null;
            while ((gm = gRe.exec(before)) !== null) {
              last = { idx: scanStart + gm.index, end: scanStart + gm.index + gm[0].length, kind: "glyph", m: [gm[0], gm[1], gm[2], gm[3]] };
            }
            if (last) return last;
            const dRe = new RegExp(drawingRunReAEA.source, "g");
            let dm: RegExpExecArray | null;
            while ((dm = dRe.exec(before)) !== null) {
              last = { idx: scanStart + dm.index, end: scanStart + dm.index + dm[0].length, kind: "drawing", m: [dm[0]] };
            }
            if (last) return last;
            const fwdEnd = Math.min(regionEnd, labelEnd + 400);
            const after = xml.slice(labelEnd, fwdEnd);
            const sdtRe2 = new RegExp(sdtCheckboxReAEA.source, "g");
            const sm2 = sdtRe2.exec(after);
            if (sm2) return { idx: labelEnd + sm2.index, end: labelEnd + sm2.index + sm2[0].length, kind: "sdt", m: [sm2[0]] };
            const gRe2 = new RegExp(glyphRunReAEA.source, "g");
            const gm2 = gRe2.exec(after);
            if (gm2) return { idx: labelEnd + gm2.index, end: labelEnd + gm2.index + gm2[0].length, kind: "glyph", m: [gm2[0], gm2[1], gm2[2], gm2[3]] };
            const dRe2 = new RegExp(drawingRunReAEA.source, "g");
            const dm2 = dRe2.exec(after);
            if (dm2) return { idx: labelEnd + dm2.index, end: labelEnd + dm2.index + dm2[0].length, kind: "drawing", m: [dm2[0]] };
            return null;
          };

          // Pass A — YES/NO safety pass anchored on attachment phrase.
          // All scanning is done against the visible-text projection (txtAEA)
          // and converted back to xml indices via projAEA.map[ti] before we
          // hand off to findControlNearAEA, which still operates on raw xml.
          if (hasAnchor) {
            const anchorReTxt = /set\s*forth\s*in\s*an\s*attachment/gi;
            const yesReTxt = /\b(?:Y\s*E\s*S|Yes)\b/g;
            const noReTxt  = /\b(?:N\s*O|No)\b/g;
            let am: RegExpExecArray | null;
            let scanned = 0;
            const forcedProps: number[] = [];
            // When property anchors are missing from the visible-text projection
            // (template uses a layout the anchor scanner doesn't detect), the
            // single fallback region attributes EVERY anchor to property 1,
            // leaving properties 2..N stuck on NO. Detect this case and assign
            // each anchor occurrence its ordinal property index instead.
            const anchorsHaveOrdinalFallback =
              propRanges.length === 1 && propRanges[0].k === 1 && propAnchors.length === 0;
            let anchorOrdinal = 0;
            while ((am = anchorReTxt.exec(txtAEA)) !== null) {
              scanned++;
              anchorOrdinal++;
              const aStartXml = projAEA.map[am.index];
              const region = propRanges.find((p) => aStartXml >= p.start && aStartXml < p.end);
              const propK = anchorsHaveOrdinalFallback
                ? anchorOrdinal
                : (region ? region.k : 1);
              const winStartXml = Math.max(region ? region.start : 0, aStartXml - 600);
              const winEndXml   = region ? region.end : xml.length;

              // Find next Yes / No labels in visible text after the anchor.
              yesReTxt.lastIndex = am.index + am[0].length;
              noReTxt.lastIndex  = am.index + am[0].length;
              const yLm = yesReTxt.exec(txtAEA);
              const nLm = noReTxt.exec(txtAEA);
              if (!yLm || !nLm) continue;

              const yLstartXml = projAEA.map[yLm.index];
              const yLendXml   = projAEA.map[yLm.index + yLm[0].length];
              const nLstartXml = projAEA.map[nLm.index];
              const nLendXml   = projAEA.map[nLm.index + nLm[0].length];
              if (yLstartXml >= winEndXml || nLstartXml >= winEndXml) continue;

              const yC = findControlNearAEA(yLstartXml, yLendXml, winStartXml, winEndXml);
              const nC = findControlNearAEA(nLstartXml, nLendXml, winStartXml, winEndXml);
              if (!yC || !nC || yC.idx === nC.idx) continue;

              const isYes = yesPropIdx.has(propK);
              const overlaps = (s: number, e: number) => rewrites.some((r) => s < r.end && e > r.start);
              if (overlaps(yC.idx, yC.end) || overlaps(nC.idx, nC.end)) continue;

              const yesReplacement = yC.kind === "sdt"
                ? rewriteSdtCheckedAEA(yC.m[0], isYes)
                : yC.kind === "drawing"
                  ? rewriteDrawingRunAEA(yC.m[0], isYes)
                  : `${yC.m[1]}${isYes ? "\u2611" : "\u2610"}${yC.m[3]}`;
              const noReplacement = nC.kind === "sdt"
                ? rewriteSdtCheckedAEA(nC.m[0], !isYes)
                : nC.kind === "drawing"
                  ? rewriteDrawingRunAEA(nC.m[0], !isYes)
                  : `${nC.m[1]}${!isYes ? "\u2611" : "\u2610"}${nC.m[3]}`;

              rewrites.push({ start: yC.idx, end: yC.end, replacement: yesReplacement });
              rewrites.push({ start: nC.idx, end: nC.end, replacement: noReplacement });
              forcedProps.push(propK);
              debugLog(`[generate-document] RE851D additional-encumbrance PROP#${propK}: forced ${isYes ? "YES" : "NO"}`);
            }
            debugLog(
              `[generate-document] RE851D AEA Pass A: anchors=${scanned} rewrites=${rewrites.length} ` +
              `yesProps=[${[...yesPropIdx].sort((a,b)=>a-b).join(",")}] forcedProps=[${forcedProps.join(",")}] in ${filename}`
            );
          }

          // Pass B — append addendum at end of word/document.xml
          let addendumXml = "";
          if (filename === "word/document.xml" && yesPropIdx.size > 0) {
            const xmlEscA = (s: string) =>
              String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const fmtCurrencyA = (raw: unknown): string => {
              const n = parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
              if (!Number.isFinite(n)) return String(raw ?? "");
              return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
            };
            const getLien = (lp: string, ...sfx: string[]): string => {
              for (const s of sfx) {
                const v = fieldValues.get(`${lp}.${s}`)?.rawValue;
                if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
              }
              return "";
            };
            const para = (text: string, opts?: { bold?: boolean; size?: number }) => {
              const sz = opts?.size ?? 22;
              const b = opts?.bold ? "<w:b/><w:bCs/>" : "";
              return `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr>${b}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEscA(text)}</w:t></w:r></w:p>`;
            };
            const pageBreakPara = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

            // Render a 2-column key/value table so addendum lien details line
            // up consistently (mirrors the main encumbrance grid layout).
            const tableCell = (text: string, widthDxa: number, opts?: { bold?: boolean }) => {
              const b = opts?.bold ? "<w:b/><w:bCs/>" : "";
              return `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/><w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${b}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEscA(text)}</w:t></w:r></w:p></w:tc>`;
            };
            const renderLienTable = (rows: Array<[string, string]>): string => {
              const tblRows = rows
                .filter(([, v]) => v !== "")
                .map(([k, v]) => `<w:tr>${tableCell(k, 3000, { bold: true })}${tableCell(v, 6360)}</w:tr>`)
                .join("");
              return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6360"/></w:tblGrid>${tblRows}</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
            };

            const renderLienLines = (lp: string): string => {
              const beneficiary = getLien(lp, "lien_holder", "lienHolder", "holder", "beneficiary");
              const priority    = getLien(lp, "lien_priority_now", "priority", "lien_priority_after");
              const orig        = getLien(lp, "original_balance", "originalBalance");
              const cur         = getLien(lp, "current_balance", "currentBalance", "new_remaining_balance");
              const rate        = getLien(lp, "interest_rate", "intRate");
              const pmt         = getLien(lp, "regular_payment", "regularPayment");
              const mat         = getLien(lp, "maturity_date", "matDate");
              const balloonAmt  = getLien(lp, "balloon_amount", "balloonAmount", "balloon_payment_amount");
              const balloonRaw  = getLien(lp, "balloon_payment", "balloonPayment", "balloon", "has_balloon");
              const norm = balloonRaw.trim().toLowerCase();
              let balloonStatus = "";
              if (["yes", "y", "true", "1"].includes(norm)) balloonStatus = "YES";
              else if (["no", "n", "false", "0"].includes(norm)) balloonStatus = "NO";
              else if (["unknown", "unk", "u"].includes(norm)) balloonStatus = "UNKNOWN";
              else if (balloonRaw) balloonStatus = balloonRaw.toUpperCase();
              else if (balloonAmt && parseFloat(String(balloonAmt).replace(/[^0-9.\-]/g, "")) > 0) balloonStatus = "YES";
              const rows: Array<[string, string]> = [
                ["Priority", priority],
                ["Beneficiary", beneficiary],
                ["Original Amount", orig ? fmtCurrencyA(orig) : ""],
                ["Approximate Principal Balance", cur ? fmtCurrencyA(cur) : ""],
                ["Monthly Payment", pmt ? fmtCurrencyA(pmt) : ""],
                ["Interest Rate", rate ? `${rate}${/%\s*$/.test(rate) ? "" : "%"}` : ""],
                ["Maturity Date", mat],
                ["Balloon Payment", balloonStatus],
              ];
              if (balloonStatus === "YES" && balloonAmt) {
                rows.push(["Balloon Amount", fmtCurrencyA(balloonAmt)]);
              }
              if (rows.every(([, v]) => !v)) return para("(no details)");
              return renderLienTable(rows);
            };

            const sections: string[] = [];
            sections.push(pageBreakPara);
            sections.push(para("Addendum — Additional Encumbrances", { bold: true, size: 28 }));
            let totalRemOver = 0, totalAntOver = 0;
            const sortedYes = [...yesPropIdx].sort((a, b) => a - b);
            for (const pIdx of sortedYes) {
              const remRows = remByProp[pIdx] ?? [];
              const antRows = antByProp[pIdx] ?? [];
              const remOver = remRows.slice(2);
              const antOver = antRows.slice(2);
              if (remOver.length === 0 && antOver.length === 0) continue;
              const propAddr = String(fieldValues.get(`property${pIdx}.address`)?.rawValue ?? "").trim();
              sections.push(para(`Property ${pIdx}${propAddr ? " — " + propAddr : ""}`, { bold: true, size: 24 }));
              if (remOver.length > 0) {
                sections.push(para("Additional Remaining Encumbrances", { bold: true, size: 22 }));
                remOver.forEach((lp, i) => {
                  sections.push(para(`Lien ${i + 3}`, { bold: true }));
                  sections.push(renderLienLines(lp));
                });
                totalRemOver += remOver.length;
              }
              if (antOver.length > 0) {
                sections.push(para("Additional Anticipated Encumbrances", { bold: true, size: 22 }));
                antOver.forEach((lp, i) => {
                  sections.push(para(`Lien ${i + 3}`, { bold: true }));
                  sections.push(renderLienLines(lp));
                });
                totalAntOver += antOver.length;
              }
            }
            if (sections.length > 2) {
              addendumXml = sections.join("");
              debugLog(`[generate-document] RE851D addendum: appending ${sortedYes.length} property section(s) (rem-overflow=${totalRemOver}, ant-overflow=${totalAntOver})`);
            }
          }

          // Apply rewrites (descending) then insert addendum before sectPr/body close.
          if (rewrites.length > 0) {
            rewrites.sort((a, b) => b.start - a.start);
            for (const r of rewrites) xml = xml.slice(0, r.start) + r.replacement + xml.slice(r.end);
          }
          if (addendumXml) {
            const bodyCloseIdx = xml.lastIndexOf("</w:body>");
            if (bodyCloseIdx !== -1) {
              const beforeClose = xml.slice(0, bodyCloseIdx);
              const lastSectPrIdx = beforeClose.lastIndexOf("<w:sectPr");
              const insertAt = lastSectPrIdx !== -1 && lastSectPrIdx > beforeClose.lastIndexOf("</w:tbl>")
                ? lastSectPrIdx
                : bodyCloseIdx;
              xml = xml.slice(0, insertAt) + addendumXml + xml.slice(insertAt);
            }
          }

          if (rewrites.length > 0 || addendumXml) {
            rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            didMutate = true;
          } else {
            rezip[filename] = [bytes, { level: 0 }];
          }
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (aeaErr) {
        console.error(
          `[generate-document] RE851D additional-encumbrance pass failed (continuing):`,
          aeaErr instanceof Error ? aeaErr.message : String(aeaErr)
        );
      }
    }

    // The template's encumbrance grids contain only static label cells with no merge
    // tags in the value cells, so the existing in-render publishers (pr_li_rem_*_N_S /
    // pr_li_ant_*_N_S) write keys nothing references. This pass label-anchors each
    // known label cell within each PROPERTY block and appends a value paragraph at the
    // end of that cell (per slot S=1,2) using values already published by the in-render
    // publisher. Strictly additive: never overwrites an existing non-empty paragraph.
    if (/851d/i.test(template.name || "")) {
      try {
        const decoder4 = new TextDecoder("utf-8");
        const encoder4 = new TextEncoder();
        const unzipped = __passUnzip(processedDocx);
        const rezip: fflate.Zippable = {};
        let didMutate = false;

        const xmlEsc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const fmtVal = (key: string): string => {
          const v = fieldValues.get(key);
          if (!v || v.rawValue === null || v.rawValue === undefined || String(v.rawValue).trim() === "") return "";
          let r = formatByDataType(v.rawValue, v.dataType, key);
          // Cells already contain leading "$" / trailing "%" glyphs — strip ours so we
          // don't duplicate them.
          if (v.dataType === "currency" && r.startsWith("$")) r = r.substring(1).trim();
          if (v.dataType === "percent" && r.endsWith("%")) r = r.slice(0, -1).trim();
          // RE851D MM/DD/YYYY guarantee: when a date value passes through as
          // raw ISO yyyy-MM-dd (no upstream formatter applied), convert to
          // MM/DD/YYYY so per-property maturity-date cells render consistently
          // with Property 1's path. Local-only — does not affect other fields.
          if (v.dataType === "date") {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r);
            if (m) r = `${m[2]}/${m[3]}/${m[1]}`;
          }
          return r;
        };
        const truthy = (raw: unknown): boolean => {
          if (raw === null || raw === undefined) return false;
          if (typeof raw === "boolean") return raw;
          const s = String(raw).trim().toLowerCase();
          return ["true", "yes", "y", "1", "on", "checked"].includes(s);
        };

        // Labels we recognize, mapped to the published value-key suffix.
        // First-of-pair = slot 1 cell, second-of-pair = slot 2 cell (in document order
        // within each ENCUMBRANCE section).
        const ENC_LABELS: Array<{ rx: RegExp; suffix: string }> = [
          { rx: /\bPRIORITY\s*\(1\s*ST\s*,\s*2\s*ND\s*,\s*ETC\.?\)/i, suffix: "priority" },
          { rx: /\bINTEREST\s+RATE\b/i, suffix: "interestRate" },
          { rx: /\bBENEFICIARY\b/i, suffix: "beneficiary" },
          { rx: /\bORIGINAL\s+AMOUNT\b/i, suffix: "originalAmount" },
          { rx: /\bAPPROXIMATE\s+PRINCIPAL\s+BALANCE\b/i, suffix: "principalBalance" },
          { rx: /\bMONTHLY\s+PAYMENT\b/i, suffix: "monthlyPayment" },
          { rx: /\bMATURITY\s+DATE\b/i, suffix: "maturityDate" },
          { rx: /\bIF\s+YES,\s*AMOUNT\b/i, suffix: "balloonAmount" },
          { rx: /\bAMOUNT\s+OWING\b/i, suffix: "amountOwing" },
        ];

        for (const [filename, bytes] of Object.entries(unzipped)) {
          const isContent =
            filename === "word/document.xml" ||
            filename.startsWith("word/header") ||
            filename.startsWith("word/footer");
          if (!isContent) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          let xml = __xmlGet(filename, bytes);
          if (xml.indexOf("ENCUMBRANCE") === -1) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }

          // Visible-text projection (shared cache). The previously-built
          // raw→visible reverse `rawToVis` Map and computed `visStart` were
          // never actually consumed downstream and allocated an O(N) entry
          // per visible character — on a ~4 MB document this was a major
          // memory sink that helped trip the edge function's memory limit.
          const __vpE = __getVisProj(filename, xml);
          const txt = __vpE.txt;
          const map = __vpE.map;

          // Find PROPERTY anchors via "PROPERTY INFORMATION" headings (cached).
          const propAnchorsRaw: number[] = [...__vpE.propAnchorsRaw];
          if (propAnchorsRaw.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          const propRanges: Array<{ k: number; start: number; end: number }> = [];
          for (let pi = 0; pi < propAnchorsRaw.length; pi++) {
            propRanges.push({
              k: pi + 1,
              start: propAnchorsRaw[pi],
              end: pi + 1 < propAnchorsRaw.length ? propAnchorsRaw[pi + 1] : xml.length,
            });
          }

          type Insert = { at: number; html: string };
          const inserts: Insert[] = [];
          // Set true when the defensive balloon-token scrub mutates `xml`
          // outside the `inserts` flow so the empty-inserts early-exit still
          // flushes the cleaned XML back into the rezip cache.
          let xmlScrubMutated = false;

          // Helper: given a raw xml position inside a label, return the [tcStart, tcEnd]
          // (positions of "<w:tc" start tag and the END index of the matching "</w:tc>").
          const findEnclosingTc = (pos: number): { open: number; close: number } | null => {
            const tcOpen = xml.lastIndexOf("<w:tc>", pos);
            const tcOpenAttr = xml.lastIndexOf("<w:tc ", pos);
            const open = Math.max(tcOpen, tcOpenAttr);
            if (open < 0) return null;
            const close = xml.indexOf("</w:tc>", pos);
            if (close < 0) return null;
            return { open, close };
          };

          // Detect whether a cell already contains a "value" beyond its label text.
          // The template's value cells often contain empty Word content controls
          // (<w:sdt> in placeholder mode) that render as a "▼" dropdown glyph or
          // grey placeholder text like "Click here to enter text". Treat those as
          // empty so the post-render publisher can insert the resolved value.
          const cellAlreadyPopulated = (
            tcOpen: number,
            tcClose: number,
            labelRx: RegExp,
          ): boolean => {
            let inner = xml.slice(tcOpen, tcClose);
            // Drop entire SDT blocks that are in placeholder state — those carry
            // no user value and only render the control chrome.
            inner = inner.replace(
              /<w:sdt\b[\s\S]*?<\/w:sdt>/g,
              (block) => (/\bw:showingPlcHdr\b/.test(block) ? "" : block),
            );
            const visible = inner.replace(/<[^>]+>/g, "");
            const stripped = visible
              .replace(labelRx, "")
              // Strip currency/percent glyphs, common form-control chrome glyphs
              // (▼ ▾ ▸ ☐ ☑ ☒) and whitespace.
              .replace(/[$%\u25BC\u25BE\u25B8\u2610\u2611\u2612]/g, "")
              // Strip Word's default placeholder phrases.
              .replace(/Click here to enter text\.?/gi, "")
              .replace(/Choose an item\.?/gi, "")
              .replace(/Enter a date\.?/gi, "")
              .replace(/\s+/g, "")
              .trim();
            return stripped.length > 0;
          };

          // Scan each property region for ENCUMBRANCE sections.
          for (const region of propRanges) {
            // (visStart was previously computed via the rawToVis lookup but
            // never used; the section scanner below operates directly on
            // the visible-text and maps each hit back via map[].)

            // Locate ENCUMBRANCE section headers in visible text within this region.
            // We need the visible-text offsets corresponding to region.start..region.end.
            // Find via simple substring search on visible text indexes whose mapped
            // raw offset falls inside the region.
            const sectionRe = /ENCUMBRANCE\(S\)\s+(REMAINING|EXPECTED\s+OR\s+ANTICIPATED)/gi;
            let sm: RegExpExecArray | null;
            while ((sm = sectionRe.exec(txt)) !== null) {
              const rawAt = map[sm.index] ?? -1;
              if (rawAt < region.start || rawAt >= region.end) continue;
              const isAnt = /EXPECTED/i.test(sm[1]);
              const tagPrefix = isAnt ? "pr_li_ant" : "pr_li_rem";

              // Search window for this section: from header to the next section header
              // OR end of property region OR ~6000 visible chars (whichever is closer).
              const visHeaderEnd = sm.index + sm[0].length;
              // find next ENCUMBRANCE section in same region (or end of region in vis)
              const nextRe = /ENCUMBRANCE\(S\)\s+(REMAINING|EXPECTED\s+OR\s+ANTICIPATED)/gi;
              nextRe.lastIndex = visHeaderEnd;
              let visSecEnd = txt.length;
              const nm = nextRe.exec(txt);
              if (nm) {
                const nmRaw = map[nm.index] ?? xml.length;
                if (nmRaw <= region.end) visSecEnd = nm.index;
              }
              // Also bound by region end in raw → translate region.end to visible idx
              // (rough): walk back to find largest map index <= region.end.
              let visRegionEnd = txt.length;
              // binary search via for-loop (map is monotonically increasing)
              let lo = 0, hi = map.length - 1;
              while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (map[mid] <= region.end) lo = mid + 1; else hi = mid - 1;
              }
              visRegionEnd = lo;
              const winEnd = Math.min(visSecEnd, visRegionEnd, visHeaderEnd + 6000);

              // For each label, find first 2 occurrences within the section window
              // → slots 1 and 2. Append value paragraph into the enclosing <w:tc>.
              for (const { rx, suffix } of ENC_LABELS) {
                const re = new RegExp(rx.source, "gi");
                re.lastIndex = visHeaderEnd;
                let occ = 0;
                let lm: RegExpExecArray | null;
                while ((lm = re.exec(txt)) !== null && occ < 2) {
                  if (lm.index >= winEnd) break;
                  const rawLabelAt = map[lm.index] ?? -1;
                  if (rawLabelAt < region.start) continue;
                  occ += 1;
                  const slot = occ;
                  const tc = findEnclosingTc(rawLabelAt);
                  if (!tc) continue;
                  const lookupKey = `${tagPrefix}_${suffix}_${region.k}_${slot}`;
                  const value = fmtVal(lookupKey);
                  if (!value) continue;
                  if (cellAlreadyPopulated(tc.open, tc.close, rx)) continue;
                  // Also check the enclosing <w:tr> row: if a sibling cell in
                  // the same row already renders the value (because the
                  // template carries its own merge tag for it in an adjacent
                  // value cell, e.g. "IF YES, AMOUNT" label cell + separate
                  // value cell), skip to avoid double-printing.
                  {
                    const trOpen = xml.lastIndexOf("<w:tr>", tc.open);
                    const trOpenAttr = xml.lastIndexOf("<w:tr ", tc.open);
                    const trStart = Math.max(trOpen, trOpenAttr);
                    const trEnd = xml.indexOf("</w:tr>", tc.close);
                    if (trStart >= 0 && trEnd > trStart) {
                      const rowXml = xml.slice(trStart, trEnd);
                      // Strip the label cell's contribution then look for the
                      // formatted value (or its digit-only signature) elsewhere
                      // in the row.
                      const rowVisible = rowXml.replace(/<[^>]+>/g, "");
                      const rowStripped = rowVisible.replace(rx, "");
                      const valueDigits = value.replace(/[^0-9A-Za-z]/g, "");
                      if (
                        valueDigits.length > 0 &&
                        rowStripped.replace(/[^0-9A-Za-z]/g, "").includes(valueDigits)
                      ) {
                        continue;
                      }
                    }
                  }
                  // For balloonAmount, widen the dedup beyond <w:tr> to the
                  // enclosing <w:tbl> (the balloon mini-grid). The template
                  // commonly places the IF YES, AMOUNT label and the actual
                  // balloon-amount value in DIFFERENT rows of the same small
                  // table (label row on top, checkbox + amount row below),
                  // so the row-scoped check above cannot see the duplicate.
                  // Without this, the publisher appends the value into the
                  // label cell AND the template renders it in the row below,
                  // producing two visible balloon amounts per encumbrance.
                  if (suffix === "balloonAmount") {
                    const tblOpenA = xml.lastIndexOf("<w:tbl>", tc.open);
                    const tblOpenB = xml.lastIndexOf("<w:tbl ", tc.open);
                    const tblStart = Math.max(tblOpenA, tblOpenB);
                    const tblEnd = xml.indexOf("</w:tbl>", tc.close);
                    if (tblStart >= 0 && tblEnd > tblStart) {
                      const tblXml = xml.slice(tblStart, tblEnd);
                      const tblVisible = tblXml.replace(/<[^>]+>/g, "");
                      const tblStripped = tblVisible.replace(rx, "");
                      const valueDigits = value.replace(/[^0-9A-Za-z]/g, "");
                      if (
                        valueDigits.length > 0 &&
                        tblStripped.replace(/[^0-9A-Za-z]/g, "").includes(valueDigits)
                      ) {
                        continue;
                      }
                    }
                  }
                  // Bug 1 (v174): NEVER append a balloon amount value into the
                  // "IF YES, AMOUNT" label cell. Redirect the write to the
                  // dedicated checkbox-row amount cell (the Nth "$"-only cell
                  // in the enclosing balloon mini-table, indexed by slot).
                  if (suffix === "balloonAmount") {
                    const cellXmlForGuard = xml.slice(tc.open, tc.close);
                    const cellVisibleForGuard = cellXmlForGuard.replace(/<[^>]+>/g, "");
                    if (/\bIF\s+YES,\s*AMOUNT\b/i.test(cellVisibleForGuard)) {
                      const tblOpenA = xml.lastIndexOf("<w:tbl>", tc.open);
                      const tblOpenB = xml.lastIndexOf("<w:tbl ", tc.open);
                      const tblStart = Math.max(tblOpenA, tblOpenB);
                      const tblCloseStart = xml.indexOf("</w:tbl>", tc.close);
                      if (tblStart >= 0 && tblCloseStart > tblStart) {
                        const tblEnd = tblCloseStart + "</w:tbl>".length;
                        const tblXml = xml.slice(tblStart, tblEnd);
                        const tcScanRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
                        const dollarCells: { absOpen: number; absClose: number }[] = [];
                        let tcM: RegExpExecArray | null;
                        while ((tcM = tcScanRe.exec(tblXml)) !== null) {
                          const cellXml2 = tcM[0];
                          const visible2 = cellXml2.replace(/<[^>]+>/g, "").trim();
                          // Empty "$" cell: a "$" with no digits and very few visible chars.
                          if (visible2 === "$" || (/\$/.test(visible2) && !/\d/.test(visible2) && visible2.length <= 3)) {
                            const absOpen = tblStart + tcM.index;
                            const absClose = absOpen + cellXml2.length - "</w:tc>".length;
                            dollarCells.push({ absOpen, absClose });
                          }
                        }
                        const target = dollarCells[slot - 1];
                        if (target) {
                          const cellXml3 = xml.slice(target.absOpen, target.absClose + "</w:tc>".length);
                          const wtRe = /<w:t(?:\s[^>]*)?>\s*\$\s*<\/w:t>/;
                          const wM = wtRe.exec(cellXml3);
                          if (wM) {
                            const wAbsStart = target.absOpen + wM.index;
                            const wAbsEnd = wAbsStart + wM[0].length;
                            const openM = /^<w:t(?:\s[^>]*)?>/.exec(wM[0]);
                            const openTag = openM ? openM[0] : "<w:t>";
                            const openWithSpace = /xml:space="preserve"/.test(openTag)
                              ? openTag
                              : openTag.replace(/<w:t/, `<w:t xml:space="preserve"`);
                            const replacement = `${openWithSpace}${xmlEsc(value)}</w:t>`;
                            inserts.push({ at: -wAbsEnd, html: `${replacement}|||REPLACE|||${wAbsStart}` });
                          } else {
                            const para =
                              `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
                              `<w:t xml:space="preserve">${xmlEsc(value)}</w:t></w:r></w:p>`;
                            inserts.push({ at: target.absClose, html: para });
                          }
                        }
                      }
                      continue;
                    }
                  }
                  // Append a new <w:p> just before </w:tc>.
                  const para =
                    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
                    `<w:t xml:space="preserve">${xmlEsc(value)}</w:t></w:r></w:p>`;
                  inserts.push({ at: tc.close, html: para });
                }
              }

              // BALLOON YES / NO / UNKNOWN glyph pass — anchored after "BALLOON PAYMENT?"
              // up to two slots in document order.
              const balloonAnchorRe = /BALLOON\s+PAYMENT\?/gi;
              balloonAnchorRe.lastIndex = visHeaderEnd;
              for (let bSlot = 1; bSlot <= 2; bSlot++) {
                const bm = balloonAnchorRe.exec(txt);
                if (!bm || bm.index >= winEnd) break;
                // window after this BALLOON for ~600 visible chars to find Y/N/U glyphs
                const winVisStart = bm.index + bm[0].length;
                const winVisEnd = Math.min(winEnd, winVisStart + 600);
                const rawWinStart = map[winVisStart] ?? -1;
                const rawWinEnd = map[winVisEnd] ?? xml.length;
                if (rawWinStart < 0) continue;
                const yesK = `${tagPrefix}_balloonYes_${region.k}_${bSlot}`;
                const noK = `${tagPrefix}_balloonNo_${region.k}_${bSlot}`;
                const unkK = `${tagPrefix}_balloonUnknown_${region.k}_${bSlot}`;
                const isYes = truthy(fieldValues.get(yesK)?.rawValue);
                const isNo = truthy(fieldValues.get(noK)?.rawValue);
                const isUnk = truthy(fieldValues.get(unkK)?.rawValue) || (!isYes && !isNo);
                // Mutually-exclusive winner: Yes > No > Unknown (defaults to Unknown
                // when no value persisted). Each of the three checkbox slots is
                // anchored to the visible label that follows it (YES / NO /
                // UNKNOWN) so a template that emits two glyphs per option (one
                // per Handlebars branch — true-branch ☑ + else-branch ☐ as
                // separate runs) cannot misalign the forced state.
                const winner: "yes" | "no" | "unk" = isYes ? "yes" : isNo ? "no" : "unk";
                 const wantFor = (l: "yes" | "no" | "unk") => (l === winner ? "\u2611" : "\u2610");

                 // ── SDT-first sub-pass ──
                 // Cloned property regions (P2..P5) and ANT P1 typically carry
                 // <w:sdt><w14:checkbox>…</w:sdt> content controls for YES/NO/
                 // UNKNOWN (earlier RE851D passes promote bare glyphs to SDTs).
                 // The glyph-run pass below filters those out via
                 // `insideExistingSdt`, leaving the row unchecked. Force the
                 // SDT's <w14:checked w14:val> + inner ☐/☒ glyph here, then
                 // skip the glyph/handlebars pass for this bSlot.
                 {
                   const sliceForSdt = xml.slice(rawWinStart, rawWinEnd);
                   const sdtRe = /<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g;
                   type SdtMatch = { absStart: number; absEnd: number; block: string; labelVisIdx: number };
                   const sdtMatches: SdtMatch[] = [];
                   let sM: RegExpExecArray | null;
                   while ((sM = sdtRe.exec(sliceForSdt)) !== null) {
                     const absStart = rawWinStart + sM.index;
                     const absEnd = absStart + sM[0].length;
                     sdtMatches.push({ absStart, absEnd, block: sM[0], labelVisIdx: -1 });
                   }
                   if (sdtMatches.length > 0) {
                     // Pair each SDT with the next visible YES/NO/UNKNOWN label
                     // that follows it in document order.
                     const lblRe = /\b(YES|NO|UNKNOWN)\b/gi;
                     lblRe.lastIndex = winVisStart;
                     const labels: { label: "yes" | "no" | "unk"; visIdx: number; rawIdx: number }[] = [];
                     let lM: RegExpExecArray | null;
                     while ((lM = lblRe.exec(txt)) !== null && lM.index < winVisEnd) {
                       const w = lM[1].toUpperCase();
                       const lbl: "yes" | "no" | "unk" = w === "YES" ? "yes" : w === "NO" ? "no" : "unk";
                       const rawIdx = map[lM.index] ?? -1;
                       if (rawIdx >= 0) labels.push({ label: lbl, visIdx: lM.index, rawIdx });
                     }
                     const pairings: { sdt: SdtMatch; label: "yes" | "no" | "unk" }[] = [];
                     const usedLabels = new Set<number>();
                     for (const sdt of sdtMatches) {
                       // First label whose raw position is >= the SDT's end.
                       let chosen = -1;
                       for (let li = 0; li < labels.length; li++) {
                         if (usedLabels.has(li)) continue;
                         if (labels[li].rawIdx >= sdt.absEnd) { chosen = li; break; }
                       }
                       if (chosen < 0) continue;
                       usedLabels.add(chosen);
                       pairings.push({ sdt, label: labels[chosen].label });
                     }
                     // Dedup: keep only first SDT per label.
                     const seenLbl = new Set<string>();
                     const dedupedPairings = pairings.filter(p => {
                       if (seenLbl.has(p.label)) return false;
                       seenLbl.add(p.label);
                       return true;
                     });
                     if (dedupedPairings.length > 0) {
                       let sdtTouched = 0;
                       for (const { sdt, label } of dedupedPairings) {
                         const checked = label === winner ? "1" : "0";
                         const glyph = label === winner ? "\u2612" : "\u2610";
                         let newBlock = sdt.block;
                         // Force <w14:checked w14:val="…"/> (insert if missing).
                         if (/<w14:checked\b[^/]*?w14:val="[01]"\s*\/?>/.test(newBlock)) {
                           newBlock = newBlock.replace(
                             /(<w14:checked\b[^/]*?w14:val=")[01]("\s*\/?>)/,
                             `$1${checked}$2`,
                           );
                         } else {
                           newBlock = newBlock.replace(
                             /(<w14:checkbox\b[^>]*>)/,
                             `$1<w14:checked w14:val="${checked}"/>`,
                           );
                         }
                         // Force inner <w:sdtContent> glyph so PDF renderers
                         // that ignore <w14:checked> still display correctly.
                         newBlock = newBlock.replace(
                           /(<w:sdtContent\b[^>]*>[\s\S]*?<w:t(?:\s[^>]*)?>)[\u2610\u2611\u2612]?([\s\S]*?<\/w:t>)/,
                           `$1${glyph}$2`,
                         );
                         inserts.push({ at: -sdt.absEnd, html: `${newBlock}|||REPLACE|||${sdt.absStart}` });
                         sdtTouched++;
                       }
                       debugLog(
                         `[generate-document] RE851D enc post-render P${region.k} ${tagPrefix === "pr_li_ant" ? "ANT" : "REM"} S${bSlot}: balloon=${winner.toUpperCase()} mode=sdt sdtTouched=${sdtTouched}`,
                       );
                       continue;
                     }
                   }
                 }



                // Collect only standalone checkbox-bearing text runs in window order.
                // Do NOT target glyphs that already live inside native Word SDT
                // checkbox content controls: replacing/removing the inner <w:r>
                // of an SDT can leave malformed <w:sdtContent> nesting in the
                // final word/document.xml. Existing SDTs are left structurally
                // untouched by this pass.
                const slice = xml.slice(rawWinStart, rawWinEnd);
                const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([\u2610\u2611\u2612])(<\/w:t>\s*<\/w:r>)/g;
                const handlebarsRunRe = /<w:r\b[^>]*>(?:\s*<w:rPr>([\s\S]*?)<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>([^<]*\{\{[^{}]*?pr_li_(?:rem|ant)_balloon(?:Yes|No|Unknown)[^{}]*?\}\}[^<]*)<\/w:t>\s*<\/w:r>/g;
                type Hit = { idx: number; len: number; kind: "glyph" | "handlebars"; cur?: string; pre?: string; post?: string; rPr?: string };
                const hits: Hit[] = [];
                const insideExistingSdt = (absStart: number): boolean => {
                  const lastContentOpen = xml.lastIndexOf("<w:sdtContent", absStart);
                  const lastContentClose = xml.lastIndexOf("</w:sdtContent>", absStart);
                  if (lastContentOpen > lastContentClose) return true;
                  const lastPrOpen = xml.lastIndexOf("<w:sdtPr", absStart);
                  const lastPrClose = xml.lastIndexOf("</w:sdtPr>", absStart);
                  return lastPrOpen > lastPrClose;
                };
                let gm: RegExpExecArray | null;
                while ((gm = glyphRunRe.exec(slice)) !== null) {
                  if (insideExistingSdt(rawWinStart + gm.index)) continue;
                  hits.push({ idx: gm.index, len: gm[0].length, kind: "glyph", pre: gm[1], cur: gm[2], post: gm[3] });
                }
                let hm: RegExpExecArray | null;
                while ((hm = handlebarsRunRe.exec(slice)) !== null) {
                  if (insideExistingSdt(rawWinStart + hm.index)) continue;
                  hits.push({ idx: hm.index, len: hm[0].length, kind: "handlebars", rPr: hm[1] || "" });
                }
                hits.sort((a, b) => a.idx - b.idx);

                // Build a list of (label, raw-position) anchors in document order.
                const labelAnchors: { label: "yes" | "no" | "unk"; rawIdx: number }[] = [];
                const labelRe = /\b(YES|NO|UNKNOWN)\b/gi;
                labelRe.lastIndex = winVisStart;
                let lblM: RegExpExecArray | null;
                while ((lblM = labelRe.exec(txt)) !== null && lblM.index < winVisEnd) {
                  const w = lblM[1].toUpperCase();
                  const lbl: "yes" | "no" | "unk" = w === "YES" ? "yes" : w === "NO" ? "no" : "unk";
                  const rawIdx = map[lblM.index] ?? -1;
                  if (rawIdx >= 0) labelAnchors.push({ label: lbl, rawIdx });
                }
                // Keep only the first occurrence of each label (closest to
                // BALLOON PAYMENT?), so a stray YES/NO/UNKNOWN further down
                // the cell does not capture the wrong glyph slot.
                const seen = new Set<string>();
                const dedupedAnchors = labelAnchors.filter(a => {
                  if (seen.has(a.label)) return false;
                  seen.add(a.label);
                  return true;
                });

                const buildReplacement = (h: Hit, want: string): string => {
                  if (h.kind === "glyph") {
                    return `${h.pre}${want}${h.post}`;
                  }
                  if (h.kind === "handlebars") {
                    const rPr = h.rPr ? `<w:rPr>${h.rPr}</w:rPr>` : "";
                    return `<w:r>${rPr}<w:t xml:space="preserve">${want}</w:t></w:r>`;
                  }
                  return `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${want}</w:t></w:r>`;
                };

                if (dedupedAnchors.length > 0) {
                  // Anchor each label to the LAST checkbox-bearing run that
                  // appears before it (and after the previous label boundary).
                  // All other runs in that span are stripped so duplicate
                  // branch glyphs (true + else) collapse to a single forced
                  // checkbox per option.
                  let prevRawBoundary = rawWinStart;
                  for (const anchor of dedupedAnchors) {
                    const labelRawAbs = anchor.rawIdx;
                    const want = wantFor(anchor.label);
                    const candidates = hits.filter(h => {
                      const hStart = rawWinStart + h.idx;
                      const hEnd = hStart + h.len;
                      return hStart >= prevRawBoundary && hEnd <= labelRawAbs;
                    });
                    if (candidates.length > 0) {
                      const chosen = candidates[candidates.length - 1];
                      const chosenStart = rawWinStart + chosen.idx;
                      const chosenEnd = chosenStart + chosen.len;
                      inserts.push({ at: -chosenEnd, html: `${buildReplacement(chosen, want)}|||REPLACE|||${chosenStart}` });
                      // Strip every other candidate (duplicate branch glyphs).
                      for (const other of candidates) {
                        if (other === chosen) continue;
                        const oStart = rawWinStart + other.idx;
                        const oEnd = oStart + other.len;
                        inserts.push({ at: -oEnd, html: `|||REPLACE|||${oStart}` });
                      }
                    }
                    prevRawBoundary = labelRawAbs;
                  }
                } else {
                  // Fallback: legacy positional mapping (3 hits → Yes/No/Unk
                  // in document order). Only triggers when the cell has no
                  // visible YES/NO/UNKNOWN labels (e.g. label-less templates).
                  const states = [isYes && winner === "yes", isNo && winner === "no", winner === "unk"];
                  for (let gIdx = 0; gIdx < Math.min(3, hits.length); gIdx++) {
                    const h = hits[gIdx];
                    const want = states[gIdx] ? "\u2611" : "\u2610";
                    const start = rawWinStart + h.idx;
                    const end = start + h.len;
                    if (h.kind === "glyph" && h.cur === want) continue;
                    inserts.push({ at: -end, html: `${buildReplacement(h, want)}|||REPLACE|||${start}` });
                  }
                }
                debugLog(
                  `[generate-document] RE851D enc post-render P${region.k} ${tagPrefix === "pr_li_ant" ? "ANT" : "REM"} S${bSlot}: balloon=${winner.toUpperCase()} (anchors=${dedupedAnchors.map(a => a.label).join(",") || "none"}, hits=${hits.length})`,
                );
              }

              // ── Defensive scrub: unresolved balloon-token literals ──
              // Some authored RE851D templates leave the BALLOON PAYMENT?
              // Handlebars conditionals (e.g.
              //   {{#if pr_li_ant_balloonYes_(N)_(S)}}☒{{else}}☐{{/if}}
              // ) split across <w:r> runs in shapes that defeat both the
              // parenthesized-index normalize and the main rewriter, so the
              // raw token text and {{#if .. }} / {{else}} / {{/if}} markers
              // survive into the rendered document. The glyph-forcing pass
              // above has already set the correct ☒/☐ checkbox state from
              // the published booleans, so here we simply strip the literal
              // noise from <w:t> bodies inside the section window.
              //
              // OFFSET-SAFETY: queue these as proper {start,end} edits in the
              // shared `inserts` queue (using absolute offsets in the original
              // xml). Mutating `xml` in-place mid-loop invalidated all queued
              // balloon-checkbox replacement offsets for later property regions,
              // splicing replacements into the middle of <w:rPr> attributes and
              // producing the "expected </w:rPr> before </w:p>" failure.
              {
                const rawSecStart = map[sm.index] ?? -1;
                const rawSecEnd = map[Math.min(winEnd, map.length - 1)] ?? region.end;
                if (rawSecStart >= 0 && rawSecEnd > rawSecStart) {
                  const balloonTokenRe = /pr_li_(?:rem|ant)_balloon(?:Yes|No|Unknown|Amount)(?:_(?:\(?[A-Za-z0-9]+\)?))*/g;
                  const wtRe = /(<w:t(?:\s[^>]*)?>)([^<]*?)(<\/w:t>)/g;
                  let scrubbed = 0;
                  // Iterate over the immutable section slice; queue absolute-
                  // offset edits instead of mutating `xml`.
                  let wm: RegExpExecArray | null;
                  wtRe.lastIndex = 0;
                  const sectionSlice = xml.slice(rawSecStart, rawSecEnd);
                  while ((wm = wtRe.exec(sectionSlice)) !== null) {
                    const text = wm[2];
                    if (!/pr_li_(?:rem|ant)_balloon/i.test(text) &&
                        !/\{\{\s*(?:#if|else|\/if)\b[^{}]*?balloon/i.test(text) &&
                        !/\{\{\s*(?:#if|else|\/if)\b/i.test(text) &&
                        !/(?:^|[\s>])#if\b/i.test(text) &&
                        !/\{\{|\}\}/.test(text)) {
                      continue;
                    }
                    let cleaned = text;
                    cleaned = cleaned.replace(
                      /\{\{[^{}]*?pr_li_(?:rem|ant)_balloon[^{}]*?\}\}/g,
                      "",
                    );
                    cleaned = cleaned.replace(/\{\{\s*#if\s*\}\}/g, "");
                    cleaned = cleaned.replace(/\b#if\b/g, "");
                    cleaned = cleaned.replace(/\{\{\s*else\s*\}\}/g, "");
                    cleaned = cleaned.replace(/\{\{\s*\/if\s*\}\}/g, "");
                    cleaned = cleaned.replace(/\belse\b/g, "");
                    cleaned = cleaned.replace(/\/?if\b/g, "");
                    cleaned = cleaned.replace(balloonTokenRe, "");
                    cleaned = cleaned.replace(/\{\{[^{}]*?\}\}/g, "");
                    cleaned = cleaned.replace(/\{\{|\}\}/g, "");
                    cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
                    if (cleaned === text) continue;
                    const absStart = rawSecStart + wm.index;
                    const absEnd = absStart + wm[0].length;
                    const replacement = `${wm[1]}${cleaned}${wm[3]}`;
                    // Queue as a "replacement" edit using the same encoding
                    // (negative `at`, "|||REPLACE|||{start}" tail) the
                    // downstream applier already understands.
                    inserts.push({ at: -absEnd, html: `${replacement}|||REPLACE|||${absStart}` });
                    scrubbed++;
                  }
                  if (scrubbed > 0) {
                    debugLog(
                      `[generate-document] RE851D enc post-render P${region.k} ${tagPrefix === "pr_li_ant" ? "ANT" : "REM"}: queued ${scrubbed} balloon-token <w:t> scrub edit(s)`,
                    );
                  }
                }
              }

              // ── FINAL BALLOON ENFORCEMENT ─────────────────────────────
              // Bug 1: "IF YES, AMOUNT" header cell must contain ONLY its
              //   label. Some authored templates carry a stray balloon-
              //   amount merge tag inside that same cell's second <w:p>,
              //   which then renders the amount twice (once in the header
              //   cell, once in the checkbox row's amount cell). Strip
              //   <w:t> bodies of any non-label paragraph inside the cell
              //   that carries numeric content.
              // Bug 2: For cloned property regions (P2..P5) and any cell
              //   whose template did not survive as an SDT or as a
              //   {{handlebars}} run, the YES / NO / UNKNOWN labels render
              //   as plain text with no leading ☑/☐ glyph. Prepend the
              //   correct glyph + space to each label's <w:t> when no
              //   checkbox glyph is already visible immediately before it.
              try {
                // Bug 1 — scrub stray amount paragraphs from the
                // "IF YES, AMOUNT" header cells (slots 1 & 2).
                {
                  const ifYesLabelRx = /\bIF\s+YES,\s*AMOUNT\b/i;
                  const ifYesRe = /\bIF\s+YES,\s*AMOUNT\b/gi;
                  ifYesRe.lastIndex = visHeaderEnd;
                  let occI = 0;
                  let lm: RegExpExecArray | null;
                  while ((lm = ifYesRe.exec(txt)) !== null && occI < 2) {
                    if (lm.index >= winEnd) break;
                    const rawAt = map[lm.index] ?? -1;
                    if (rawAt < region.start) continue;
                    occI++;
                    const tc = findEnclosingTc(rawAt);
                    if (!tc) continue;
                    const cellXml = xml.slice(tc.open, tc.close);
                    const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
                    let pm: RegExpExecArray | null;
                    while ((pm = paraRe.exec(cellXml)) !== null) {
                      const paraXml = pm[0];
                      const visible = paraXml.replace(/<[^>]+>/g, "");
                      // Keep the label paragraph itself untouched.
                      if (ifYesLabelRx.test(visible)) continue;
                      // Only scrub paragraphs that carry numeric content
                      // (the doubled balloon amount). Leave empty
                      // paragraphs alone.
                      if (!/\d/.test(visible)) continue;
                      const wtRe = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
                      let wmm: RegExpExecArray | null;
                      while ((wmm = wtRe.exec(paraXml)) !== null) {
                        if (wmm[2].length === 0) continue;
                        const absStart = tc.open + pm.index + wmm.index;
                        const absEnd = absStart + wmm[0].length;
                        const replacement = `${wmm[1]}${wmm[3]}`;
                        inserts.push({
                          at: -absEnd,
                          html: `${replacement}|||REPLACE|||${absStart}`,
                        });
                      }
                    }
                  }
                }

                // Bug 2 (v174) — prepend ☑/☐ to YES/NO/UNKNOWN labels following
                // each BALLOON PAYMENT? anchor. Track per-cell + per-<w:t> so
                // the right-lien cell (which lives in a separate <w:tc> but in
                // the same scan window as the left-lien cell, and which often
                // packs YES/NO/UNKNOWN into a single <w:t> body) still gets
                // every glyph forced.
                {
                  const balloonRe = /BALLOON\s+PAYMENT\?/gi;
                  balloonRe.lastIndex = visHeaderEnd;
                  for (let bSlot = 1; bSlot <= 2; bSlot++) {
                    const bm = balloonRe.exec(txt);
                    if (!bm || bm.index >= winEnd) break;
                    const winVisStart = bm.index + bm[0].length;
                    const winVisEnd = Math.min(winEnd, winVisStart + 600);
                    const yesK = `${tagPrefix}_balloonYes_${region.k}_${bSlot}`;
                    const noK = `${tagPrefix}_balloonNo_${region.k}_${bSlot}`;
                    const unkK = `${tagPrefix}_balloonUnknown_${region.k}_${bSlot}`;
                    const isYes = truthy(fieldValues.get(yesK)?.rawValue);
                    const isNo = truthy(fieldValues.get(noK)?.rawValue);
                    const isUnk = truthy(fieldValues.get(unkK)?.rawValue);
                    const winner: "yes" | "no" | "unk" = isYes
                      ? "yes"
                      : isNo
                      ? "no"
                      : isUnk
                      ? "unk"
                      : "unk";
                    const glyphFor = (l: "yes" | "no" | "unk") =>
                      l === winner ? "\u2611" : "\u2610";

                    // Group all label ops by their enclosing <w:t>, and dedup
                    // per-cell so an SDT-forced glyph elsewhere in the same
                    // cell does not prevent bare labels from being decorated.
                    type WtEdit = {
                      wtCloseEnd: number;
                      openTag: string;
                      body: string;
                      ops: Array<{ lbl: "yes" | "no" | "unk"; w: string }>;
                    };
                    const wtEdits = new Map<number, WtEdit>();
                    const cellLabelSeen = new Map<number, Set<string>>();

                    const lblRe = /\b(YES|NO|UNKNOWN)\b/gi;
                    lblRe.lastIndex = winVisStart;
                    let lM: RegExpExecArray | null;
                    while ((lM = lblRe.exec(txt)) !== null && lM.index < winVisEnd) {
                      const w = lM[1].toUpperCase();
                      const lbl: "yes" | "no" | "unk" =
                        w === "YES" ? "yes" : w === "NO" ? "no" : "unk";

                      // Skip "YES" inside "IF YES, AMOUNT".
                      const lookBackStart = Math.max(0, lM.index - 6);
                      const lookBack = txt.slice(lookBackStart, lM.index);
                      if (/\bIF\s*$/i.test(lookBack)) continue;
                      // Skip if a checkbox glyph is already immediately before
                      // the label (within the 6 visible chars look-back).
                      if (/[\u2610\u2611\u2612]/.test(lookBack)) continue;

                      const rawIdx = map[lM.index] ?? -1;
                      if (rawIdx < 0) continue;
                      const labelTc = findEnclosingTc(rawIdx);
                      if (!labelTc) continue;
                      let seen = cellLabelSeen.get(labelTc.open);
                      if (!seen) {
                        seen = new Set();
                        cellLabelSeen.set(labelTc.open, seen);
                      }
                      if (seen.has(lbl)) continue;
                      seen.add(lbl);

                      // Locate enclosing <w:t>.
                      const wtOpenA = xml.lastIndexOf("<w:t>", rawIdx);
                      const wtOpenB = xml.lastIndexOf("<w:t ", rawIdx);
                      const wtOpen = Math.max(wtOpenA, wtOpenB);
                      if (wtOpen < 0) continue;
                      const openTagEnd = xml.indexOf(">", wtOpen) + 1;
                      if (openTagEnd <= wtOpen) continue;
                      const wtCloseStart = xml.indexOf("</w:t>", openTagEnd);
                      if (wtCloseStart < 0) continue;
                      const wtCloseEnd = wtCloseStart + "</w:t>".length;
                      const openTag = xml.slice(wtOpen, openTagEnd);
                      const body = xml.slice(openTagEnd, wtCloseStart);
                      if (/IF\s+YES|AMOUNT/i.test(body)) continue;
                      if (!new RegExp(`\\b${w}\\b`, "i").test(body)) continue;
                      // Already glyphed in body?
                      const alreadyRe = new RegExp(
                        `[\\u2610\\u2611\\u2612]\\s*${w}\\b`,
                        "i",
                      );
                      if (alreadyRe.test(body)) continue;

                      const existing = wtEdits.get(wtOpen);
                      if (existing) {
                        existing.ops.push({ lbl, w });
                      } else {
                        wtEdits.set(wtOpen, {
                          wtCloseEnd,
                          openTag,
                          body,
                          ops: [{ lbl, w }],
                        });
                      }
                    }

                    // Emit one combined replacement per <w:t>.
                    for (const [wtOpen, ed] of wtEdits) {
                      let newBody = ed.body;
                      for (const { lbl, w } of ed.ops) {
                        const already = new RegExp(
                          `[\\u2610\\u2611\\u2612]\\s*${w}\\b`,
                          "i",
                        );
                        if (already.test(newBody)) continue;
                        newBody = newBody.replace(
                          new RegExp(`\\b${w}\\b`),
                          `${glyphFor(lbl)} ${w}`,
                        );
                      }
                      if (newBody === ed.body) continue;
                      const openWithSpace = /xml:space="preserve"/.test(
                        ed.openTag,
                      )
                        ? ed.openTag
                        : ed.openTag.replace(
                            /<w:t/,
                            `<w:t xml:space="preserve"`,
                          );
                      const replacement = `${openWithSpace}${newBody}</w:t>`;
                      inserts.push({
                        at: -ed.wtCloseEnd,
                        html: `${replacement}|||REPLACE|||${wtOpen}`,
                      });
                    }
                  }
                }
              } catch (balloonEnforceErr) {
                debugLog(
                  `[generate-document] RE851D balloon enforcement pass error P${region.k}: ${
                    balloonEnforceErr instanceof Error
                      ? balloonEnforceErr.message
                      : String(balloonEnforceErr)
                  }`,
                );
              }
            }
          }

          if (inserts.length === 0) {
            if (xmlScrubMutated) {
              rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
            } else {
              rezip[filename] = [bytes, { level: 0 }];
            }
            continue;
          }
          // Apply ALL edits (pure inserts + replacements) in one ascending-cursor
          // pass so an insert that lands at a replacement boundary cannot
          // truncate the replacement body — and vice versa. The previous
          // "inserts first descending, replacements second using original
          // offsets" sequence corrupted XML when a label insert at `end` of
          // a replaced glyph caused the subsequent replacement to slice INTO
          // the inserted label, dropping bytes (including `<w:p>` opens) and
          // producing the observed "unbalanced <w:p>" integrity failure.
          type Edit = { start: number; end: number; body: string };
          const edits: Edit[] = [];
          let pureInsertCount = 0;
          let replacementCount = 0;
          for (const ins of inserts) {
            if (ins.at >= 0) {
              edits.push({ start: ins.at, end: ins.at, body: ins.html });
              pureInsertCount++;
            } else {
              const [body, tail] = ins.html.split("|||REPLACE|||");
              const start = parseInt(tail, 10);
              const end = -ins.at;
              if (Number.isFinite(start) && end > start) {
                edits.push({ start, end, body });
                replacementCount++;
              }
            }
          }
          // Sort by start ascending, then by end ascending so a zero-width
          // insert at position P comes BEFORE a replacement starting at P.
          edits.sort((a, b) => (a.start - b.start) || (a.end - b.end));
          let cursor = 0;
          let outBuf = "";
          let dropped = 0;
          let unsafe = 0;
          // Boundary safety: an edit must start at a safe XML position. For
          // pure inserts (start === end) the position must be either at end-of-
          // doc, immediately before a `<`, or immediately after a `>`.
          // For replacements, start must point at `<`, end must be one past
          // `>`, and the replaced fragment must be exactly one safe text run
          // (`<w:r>...</w:r>`) or one text node (`<w:t>...</w:t>`). This
          // prevents a stale offset from splicing inside an
          // attribute (e.g. `<w:color w:v|`) and producing the malformed
          // `</w:rPr> before </w:p>` failure observed on RE851D.
          const isSafeBoundary = (e: { start: number; end: number }): boolean => {
            if (e.start < 0 || e.end > xml.length || e.start > e.end) return false;
            if (e.start === e.end) {
              if (e.start === xml.length) return true;
              const ch = xml.charAt(e.start);
              const prev = e.start > 0 ? xml.charAt(e.start - 1) : "";
              return ch === "<" || prev === ">";
            }
            if (xml.charAt(e.start) !== "<" || xml.charAt(e.end - 1) !== ">") return false;
            const frag = xml.slice(e.start, e.end);
            return /^<w:r\b[^>]*>[\s\S]*<\/w:r>$/.test(frag) || /^<w:t\b[^>]*>[\s\S]*<\/w:t>$/.test(frag);
          };
          for (const e of edits) {
            if (e.start < cursor) {
              dropped++;
              continue;
            }
            if (!isSafeBoundary(e)) {
              unsafe++;
              continue;
            }
            outBuf += xml.slice(cursor, e.start) + e.body;
            cursor = e.end;
          }
          outBuf += xml.slice(cursor);
          xml = outBuf;
          if (dropped > 0 || unsafe > 0) {
            debugLog(
              `[generate-document] RE851D enc post-render: dropped ${dropped} overlapping + ${unsafe} unsafe-boundary edit(s) in ${filename}`,
            );
          }
          // Preserve previous variable names below for the existing log line.
          const pureInserts = { length: pureInsertCount } as { length: number };
          const replacements = { length: replacementCount } as { length: number };
          rezip[filename] = [__xmlSet(filename, xml), { level: 0 }];
          didMutate = true;
          debugLog(
            `[generate-document] RE851D post-render encumbrance pass: ${pureInserts.length} value cells filled, ${replacements.length} balloon glyphs forced in ${filename}`,
          );
        }

        if (didMutate) {
          processedDocx = __passZip(rezip);
        }
      } catch (postErr) {
        console.error(
          `[generate-document] RE851D post-render encumbrance pass failed (continuing):`,
          postErr instanceof Error ? postErr.message : String(postErr),
        );
      }
    }


    // ── RE851D post-render flush ──
    // If any RE851D safety pass mutated the in-memory cache, run a final
    // table-cell paragraph repair sweep on every dirty content part, then
    // validate each one with the same integrity rules processDocx uses
    // internally — but on the FINAL bytes we are about to upload. Without
    // this gate, a post-render mutation that produces malformed XML (the
    // historical cause of RE851D "Xml parsing error" reports in Word) would
    // ship as a successful generation.
    if (__re851dPassCache) {
      try {
        const flushZip: fflate.Zippable = {};
        const flushEncoder = new TextEncoder();
        for (const [k, v] of Object.entries(__re851dPassCache)) {
          if (__xmlDirty.has(k)) {
            // Repair table cells stripped of their sole <w:p> by mutations.
            const repaired = repairTableCellParagraphs(__xmlStrCache[k]);
            if (repaired.repaired > 0) {
              __xmlStrCache[k] = repaired.xml;
              debugLog(
                `[generate-document] RE851D post-render flush: repaired ${repaired.repaired} <w:tc> in ${k}`,
              );
            }
            const sdtRepaired = repairOrphanedSdtOpen(__xmlStrCache[k]);
            if (sdtRepaired.repaired > 0) {
              __xmlStrCache[k] = sdtRepaired.xml;
              debugLog(
                `[generate-document] RE851D post-render flush: removed ${sdtRepaired.repaired} orphaned <w:sdt> opener in ${k}`,
              );
            }
            // Heal unclosed <w:rPr> blocks left behind by post-render regex
            // replacements (root cause of "expected </w:rPr> before </w:p>").
            const rPrRepaired = repairUnclosedRunProperties(__xmlStrCache[k]);
            if (rPrRepaired.repaired > 0) {
              __xmlStrCache[k] = rPrRepaired.xml;
              console.log(
                `[generate-document] RE851D post-render flush: closed ${rPrRepaired.repaired} unclosed <w:rPr> in ${k}`,
              );
            }
            // Heal unclosed <w:p> blocks that leak past structural boundaries
            // (root cause of "expected </w:p> before </w:sdtContent>" — the
            // current RE851D failure mode where post-render glyph/handlebars
            // run replacements consumed a </w:p> they shouldn't have).
            const pRepaired = repairUnclosedParagraphsBeforeStructuralClose(
              __xmlStrCache[k],
            );
            if (pRepaired.repaired > 0) {
              __xmlStrCache[k] = pRepaired.xml;
              console.log(
                `[generate-document] RE851D post-render flush: closed ${pRepaired.repaired} unclosed <w:p> before structural close in ${k}`,
              );
            }
            const straySdtRepaired = repairStraySdtClosingPair(__xmlStrCache[k]);
            if (straySdtRepaired.repaired > 0) {
              __xmlStrCache[k] = straySdtRepaired.xml;
              console.log(
                `[generate-document] RE851D post-render flush: removed ${straySdtRepaired.repaired} stray </w:sdtContent></w:sdt> pair(s) in ${k}`,
              );
            }
            // Final XML attribute-space sanitization. Earlier rsid-strip
            // and bookmark-strip passes (combined with cross-run merge tag
            // consolidation around `{{ld_p_vesting}}` / `{{ld_p_vestin}}`)
            // have occasionally produced malformed element starts like
            // `<w:bookmarkEndw:id="2"/>` and `<w:szw:val="16"/>` — i.e. a
            // missing whitespace between the element name and its first
            // attribute, or between two adjacent attributes. Word refuses
            // to open the resulting DOCX with "Xml parsing error". This
            // pass restores the required separating space in a narrowly
            // scoped, idempotent way without touching any other content.
            {
              const before = __xmlStrCache[k];
              const fixed = repairOoXmlTagBoundaries(before);
              if (fixed.xml !== before) {
                __xmlStrCache[k] = fixed.xml;
                console.log(
                  `[generate-document] RE851D post-render flush: repaired malformed OOXML tag boundaries in ${k} (Δ=${fixed.repaired} chars)`,
                );
              }
            }
            // Validate the FINAL XML before re-encoding — fail loudly rather
            // than upload a corrupt DOCX that Word will refuse to open.
            try {
              validateContentXmlPart(k, __xmlStrCache[k]);
            } catch (vErr) {
              const vMsg = vErr instanceof Error ? vErr.message : String(vErr);
              const offMatch = vMsg.match(/offset (\d+)/);
              if (offMatch) {
                const off = parseInt(offMatch[1], 10);
                const ctxStart = Math.max(0, off - 240);
                const ctxEnd = Math.min(__xmlStrCache[k].length, off + 80);
                console.error(
                  `[generate-document] DOCX integrity context for ${k} @${off}: …${__xmlStrCache[k].slice(ctxStart, ctxEnd).replace(/\s+/g, " ")}…`,
                );
              }
              throw vErr;
            }
            flushZip[k] = [flushEncoder.encode(__xmlStrCache[k]), { level: 0 }];
          } else {
            flushZip[k] = [v, { level: 0 }];
          }
        }
        processedDocx = new Uint8Array(fflate.zipSync(flushZip));
      } catch (flushErr) {
        const message = flushErr instanceof Error ? flushErr.message : String(flushErr);
        if (message.startsWith("DOCX_INTEGRITY")) {
          console.error(
            `[generate-document] DOCX integrity check failed AFTER RE851D post-render passes for template ${templateId}: ${message}`,
          );
          result.error = `Generated document failed integrity check (${message.replace(/^DOCX_INTEGRITY:\s*/, "")}). Please review the template for unbalanced tags or invalid placeholders.`;
          return result;
        }
        console.error(
          `[generate-document] RE851D post-render flush failed:`,
          message,
        );
      }
    }

    if (isTemplate851D) {
      try {
        const renderedZip = fflate.unzipSync(processedDocx);
        const decoder = new TextDecoder("utf-8");
        const unresolved: string[] = [];
        for (const [name, bytes] of Object.entries(renderedZip)) {
          if (!(name === "word/document.xml" || name.startsWith("word/header") || name.startsWith("word/footer") || name.startsWith("word/footnotes") || name.startsWith("word/endnotes"))) continue;
          const xml = decoder.decode(bytes as Uint8Array);
          const hits = xml.match(/\{\{\s*pr_li_rem_[^{}<]*(?:\{N\}|\{S\}|\{P\})[^{}<]*\}\}|pr_li_rem_[A-Za-z]+_(?:\{N\}_\{S\}|\{P\}_\{S\}|\(N\)_\(S\)|\(P\)_\(S\)|N_S)/g) || [];
          hits.slice(0, 10).forEach((h) => unresolved.push(`${name}:${h}`));
          const vestingHits = xml.match(/(?:\{+\s*)?ld_p_vestin(?:g)?(?:\s*\}+)?/g) || [];
          vestingHits.slice(0, 10).forEach((h) => unresolved.push(`${name}:${h}`));
        }
        if (unresolved.length > 0) {
          console.warn(`[generate-document] RE851D unresolved Remaining placeholders before upload/PDF: ${unresolved.slice(0, 30).join(" | ")}`);
        } else {
          console.log("[generate-document] RE851D unresolved Remaining placeholders before upload/PDF: none");
        }
      } catch (scanErr) {
        console.warn("[generate-document] RE851D unresolved Remaining scan skipped:", scanErr instanceof Error ? scanErr.message : String(scanErr));
      }
    }

    // 6. Calculate version number
    const { data: existingDocs } = await supabase
      .from("generated_documents")
      .select("version_number")
      .eq("deal_id", dealId)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .limit(1);

    const versionNumber = existingDocs && existingDocs.length > 0 ? existingDocs[0].version_number + 1 : 1;

    // 7. Upload generated document to storage
    const tFileExportStart = performance.now();
    const timestamp = Date.now();
    const outputFileName = `${dealId}/${templateId}_v${versionNumber}_${timestamp}.docx`;

    const { error: uploadError } = await supabase.storage
      .from("generated-docs")
      .upload(outputFileName, processedDocx, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });

    if (uploadError) {
      console.error(`[generate-document] Upload error:`, uploadError);
      result.error = "Failed to save generated document";
      return result;
    }
    if (isTemplate885) {
      debugLog(`[RE885] File Export: ${Math.round(performance.now() - tFileExportStart)} ms`);
      debugLog(`[RE885] Total CPU Time: ${Math.round(performance.now() - t885Total)} ms`);
    }

    debugLog(`[generate-document] Uploaded to generated-docs: ${outputFileName}`);

    // 8. Handle PDF conversion using CloudConvert
    let pdfPath: string | null = null;
    if (outputType === "docx_and_pdf") {
      pdfPath = await convertToPdf(supabase, processedDocx, dealId, templateId, versionNumber, timestamp);
    }

    // 9. Create generated_documents record
    const isRegeneration = versionNumber > 1;
    const { data: generatedDoc, error: insertError } = await supabase
      .from("generated_documents")
      .insert({
        deal_id: dealId,
        template_id: templateId,
        packet_id: packetId,
        template_name: result.templateName,
        packet_name: packetName,
        generation_batch_id: generationBatchId,
        output_docx_path: outputFileName,
        output_pdf_path: pdfPath,
        output_type: outputType,
        version_number: versionNumber,
        created_by: userId,
        generation_status: "success",
        error_message: null,
      })
      .select()
      .single();

    if (insertError) {
      result.error = "Failed to create document record";
      return result;
    }

    debugLog(`[generate-document] Created document record: ${generatedDoc.id}`);

    // 10. Log activity
    const actionType = isRegeneration ? "DocumentRegenerated" : "DocumentGenerated";
    await supabase.from("activity_log").insert({
      deal_id: dealId,
      actor_user_id: userId,
      action_type: actionType,
      action_details: {
        templateId,
        templateName: result.templateName,
        versionNumber,
        documentId: generatedDoc.id,
        outputType,
      },
    });

    debugLog(`[generate-document] Logged activity: ${actionType}`);

    result.success = true;
    result.documentId = generatedDoc.id;
    result.versionNumber = versionNumber;
    result.outputPath = outputFileName;

    return result;
  } catch (error: any) {
    console.error(`[generate-document] Error processing ${result.templateName}:`, error);
    result.error = error.message || "Unknown error";
    return result;
  }
}

// ============================================
// PDF Conversion
// ============================================

async function convertToPdf(
  supabase: any,
  docxBuffer: Uint8Array,
  dealId: string,
  templateId: string,
  versionNumber: number,
  timestamp: number
): Promise<string | null> {
  const cloudConvertApiKey = Deno.env.get("CLOUDCONVERT_API_KEY");
  
  if (!cloudConvertApiKey) {
    debugLog(`[generate-document] PDF conversion requested but CLOUDCONVERT_API_KEY not set`);
    return null;
  }

  try {
    debugLog(`[generate-document] Starting PDF conversion via CloudConvert...`);
    
    const jobResponse = await fetch("https://api.cloudconvert.com/v2/jobs", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cloudConvertApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tasks: {
          "import-docx": {
            operation: "import/base64",
            file: btoa(String.fromCharCode(...docxBuffer)),
            filename: `document.docx`,
          },
          "convert-pdf": {
            operation: "convert",
            input: ["import-docx"],
            output_format: "pdf",
          },
          "export-pdf": {
            operation: "export/url",
            input: ["convert-pdf"],
          },
        },
      }),
    });

    if (!jobResponse.ok) {
      const errorText = await jobResponse.text();
      console.error(`[generate-document] CloudConvert job creation failed: ${errorText}`);
      return null;
    }

    const jobData = await jobResponse.json();
    const jobId = jobData.data.id;
    debugLog(`[generate-document] CloudConvert job created: ${jobId}`);

    // Poll for job completion using bounded exponential backoff.
    // Total worst-case wait ≈ 45s (vs. previous 60s flat × 30 polls), with
    // faster early polls so quick jobs return in 1–2s instead of always 2s.
    const pollDelaysMs = [1000, 1000, 2000, 2000, 3000, 3000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000]; // sum ≈ 45s
    let exportUrl: string | null = null;

    for (const delay of pollDelaysMs) {
      await new Promise(resolve => setTimeout(resolve, delay));

      const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: {
          "Authorization": `Bearer ${cloudConvertApiKey}`,
        },
      });

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json();
      const job = statusData.data;

      if (job.status === "finished") {
        const exportTask = job.tasks.find((t: any) => t.name === "export-pdf");
        if (exportTask?.result?.files?.[0]?.url) {
          exportUrl = exportTask.result.files[0].url;
        }
        break;
      } else if (job.status === "error") {
        console.error(`[generate-document] CloudConvert job failed:`, job);
        break;
      }
    }

    if (exportUrl) {
      // Download the PDF
      const pdfResponse = await fetch(exportUrl);
      if (pdfResponse.ok) {
        const pdfBlob = await pdfResponse.blob();
        const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());

        const pdfFileName = `${dealId}/${templateId}_v${versionNumber}_${timestamp}.pdf`;
        const { error: pdfUploadError } = await supabase.storage
          .from("generated-docs")
          .upload(pdfFileName, pdfBuffer, {
            contentType: "application/pdf",
            upsert: false,
          });

        if (!pdfUploadError) {
          debugLog(`[generate-document] PDF uploaded: ${pdfFileName}`);
          return pdfFileName;
        } else {
          console.error(`[generate-document] PDF upload failed:`, pdfUploadError);
        }
      }
    }
  } catch (pdfError: any) {
    console.error(`[generate-document] PDF conversion error:`, pdfError);
  }

  return null;
}

// ============================================
// Main Handler
// ============================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for all data operations (bypasses RLS)
    // and for token validation
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "").trim();
    let userId: string | null = null;

    // Preferred path: validate JWT claims directly (doesn't depend on an active auth session row)
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (!claimsError && claimsData?.claims?.sub) {
      userId = claimsData.claims.sub;
    } else {
      // Fallback path: fetch user from token
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData?.user) {
        console.error("[generate-document] Auth error:", claimsError?.message || userError?.message);
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    debugLog(`[generate-document] User: ${userId}`);

    // Parse request
    const { dealId, templateId, packetId, outputType = "docx_only" }: GenerateDocumentRequest = await req.json();

    if (!dealId) {
      return new Response(JSON.stringify({ error: "dealId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!templateId && !packetId) {
      return new Response(JSON.stringify({ error: "Either templateId or packetId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestType: RequestType = templateId ? "single_doc" : "packet";
    debugLog(`[generate-document] Request type: ${requestType}, deal: ${dealId}`);

    // Verify deal exists and is in ready/generated status
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id, deal_number, status, packet_id")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: "Deal not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deal.status !== "ready" && deal.status !== "generated") {
      return new Response(
        JSON.stringify({ error: "Deal must be in Ready or Generated status" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Pre-insert stale-job sweep: mark any prior "running" jobs for this deal
    // older than 120 seconds as failed. Required so a CPU-killed prior run
    // (which never reached its own status update) does not leave the UI
    // stuck on "Running" forever.
    const staleThreshold = new Date(Date.now() - 120_000).toISOString();
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Generation timed out (CPU limit exceeded)",
      })
      .eq("deal_id", dealId)
      .eq("status", "running")
      .lt("started_at", staleThreshold);

    // Concurrent-job guard: if a non-stale "running" job already exists for the
    // same deal+template (or deal+packet), reuse it instead of starting another.
    // Prevents duplicate triggers from racing on the same RE851D template.
    const concurrencyQuery = supabase
      .from("generation_jobs")
      .select("id, started_at, request_type")
      .eq("deal_id", dealId)
      .eq("status", "running")
      .gte("started_at", staleThreshold)
      .order("started_at", { ascending: false })
      .limit(1);

    if (templateId) {
      concurrencyQuery.eq("template_id", templateId);
    } else if (packetId || deal.packet_id) {
      concurrencyQuery.eq("packet_id", packetId || deal.packet_id);
    }

    const { data: existingRunning } = await concurrencyQuery;
    if (existingRunning && existingRunning.length > 0) {
      const existing = existingRunning[0];
      debugLog(`[generate-document] Reusing in-flight job ${existing.id}, refusing duplicate trigger`);
      const reuseResponse: JobResult = {
        jobId: existing.id,
        dealId,
        requestType,
        status: "running",
        results: [],
        successCount: 0,
        failCount: 0,
        startedAt: (existing as any).started_at,
      };
      return new Response(JSON.stringify(reuseResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create GenerationJob record (with retry for transient Cloudflare/origin errors)
    let job: any = null;
    let jobError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await supabase
        .from("generation_jobs")
        .insert({
          deal_id: dealId,
          requested_by: userId,
          request_type: requestType,
          packet_id: packetId || deal.packet_id,
          template_id: templateId || null,
          output_type: outputType,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      job = result.data;
      jobError = result.error;
      if (!jobError && job) break;
      const status = (jobError as any)?.status ?? (jobError as any)?.code;
      const isTransient =
        status === 520 || status === 521 || status === 522 || status === 523 ||
        status === 524 || status === 502 || status === 503 || status === 504 ||
        (typeof status === "string" && /^(520|521|522|523|524|502|503|504)$/.test(status));
      if (!isTransient) break;
      console.warn(`[generate-document] Transient error creating job (attempt ${attempt + 1}/3):`, status);
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }

    if (jobError || !job) {
      console.error("[generate-document] Failed to create job:", jobError);
      return new Response(
        JSON.stringify({
          error: "Failed to create generation job",
          detail: (jobError as any)?.message || "Backend temporarily unavailable. Please retry.",
          retryable: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    debugLog(`[generate-document] Created job: ${job.id}`);

    // Return immediately with "running" status — process in background
    const immediateResponse: JobResult = {
      jobId: job.id,
      dealId,
      requestType,
      status: "running",
      results: [],
      successCount: 0,
      failCount: 0,
      startedAt: job.started_at,
    };

    // Background processing via EdgeRuntime.waitUntil
    const backgroundTask = (async () => {
      const jobResult: JobResult = { ...immediateResponse };

      try {
        if (requestType === "single_doc" && templateId) {
          // Single document generation
          const result = await generateSingleDocument(
            supabase,
            dealId,
            templateId,
            deal.packet_id,
            null,
            outputType,
            userId,
            null
          );
          jobResult.results.push(result);
          
          if (result.success) {
            jobResult.successCount++;
          } else {
            jobResult.failCount++;
          }
        } else if (packetId || deal.packet_id) {
          // Packet generation - iterate all templates in order
          const effectivePacketId = packetId || deal.packet_id;
          
          // Fetch packet name for denormalization
          const { data: packetRecord } = await supabase
            .from("packets")
            .select("name")
            .eq("id", effectivePacketId)
            .single();
          const effectivePacketName = packetRecord?.name || null;

          // Generate a unique batch ID for this packet generation run
          const batchId = crypto.randomUUID();

          const { data: packetTemplates, error: ptError } = await supabase
            .from("packet_templates")
            .select("template_id, templates(id, name, file_path)")
            .eq("packet_id", effectivePacketId)
            .order("display_order");

          if (ptError) {
            throw new Error("Failed to fetch packet templates");
          }

          debugLog(`[generate-document] Processing ${packetTemplates?.length || 0} templates in packet (batch: ${batchId})`);

          for (const pt of (packetTemplates || [])) {
            const template = (pt as any).templates as Template;
            
            if (!template?.file_path) {
              jobResult.results.push({
                templateId: pt.template_id,
                templateName: template?.name || "Unknown",
                success: false,
                error: "Template has no DOCX file",
              });
              jobResult.failCount++;
              continue;
            }

            const result = await generateSingleDocument(
              supabase,
              dealId,
              pt.template_id,
              effectivePacketId,
              effectivePacketName,
              outputType,
              userId,
              batchId
            );
            
            jobResult.results.push(result);
            
            if (result.success) {
              jobResult.successCount++;
            } else {
              jobResult.failCount++;
            }
          }
        }

        // Determine final job status
        const completedAt = new Date().toISOString();
        let finalStatus: GenerationStatus;
        let errorMessage: string | null = null;

        if (jobResult.failCount === 0 && jobResult.successCount > 0) {
          finalStatus = "success";
        } else if (jobResult.successCount === 0 && jobResult.failCount > 0) {
          finalStatus = "failed";
          const failures = jobResult.results.filter(r => !r.success);
          errorMessage = failures.map(f => `${f.templateName}: ${f.error}`).join("; ");
        } else {
          finalStatus = "success";
          const failures = jobResult.results.filter(r => !r.success);
          errorMessage = `Partial: ${failures.length} failed - ${failures.map(f => f.templateName).join(", ")}`;
        }

        // Update job record
        await supabase
          .from("generation_jobs")
          .update({
            status: finalStatus,
            completed_at: completedAt,
            error_message: errorMessage,
          })
          .eq("id", job.id);

        // Update deal status to generated if successful
        if (jobResult.successCount > 0 && deal.status === "ready") {
          await supabase.from("deals").update({ status: "generated" }).eq("id", dealId);
          debugLog(`[generate-document] Updated deal status to generated`);
        }

        debugLog(`[generate-document] Job ${job.id} completed: ${jobResult.successCount} success, ${jobResult.failCount} failed`);

      } catch (error: any) {
        // Mark job as failed
        const completedAt = new Date().toISOString();
        await supabase
          .from("generation_jobs")
          .update({
            status: "failed",
            completed_at: completedAt,
            error_message: error.message || "Unknown error",
          })
          .eq("id", job.id);

        console.error("[generate-document] Job failed:", error);
      }
    })();

    // Use EdgeRuntime.waitUntil if available (Deno Deploy / Supabase Edge Functions)
    // This allows the response to be sent immediately while processing continues
    if (typeof (globalThis as any).EdgeRuntime !== "undefined" && typeof (globalThis as any).EdgeRuntime.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
      debugLog(`[generate-document] Background processing started via EdgeRuntime.waitUntil`);
    } else {
      // Fallback: await the task directly (local dev / environments without waitUntil)
      await backgroundTask;
      debugLog(`[generate-document] Processing completed synchronously (no EdgeRuntime.waitUntil)`);
    }

    return new Response(JSON.stringify(immediateResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[generate-document] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

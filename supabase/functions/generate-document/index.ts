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
import { processDocx } from "../_shared/docx-processor.ts";
import { normalizeWordXml, escapeXmlValue } from "../_shared/tag-parser.ts";
import { formatByDataType } from "../_shared/formatting.ts";

const DOC_GEN_DEBUG = Deno.env.get("DOC_GEN_DEBUG") === "true";
const debugLog = (...args: unknown[]) => {
  if (DOC_GEN_DEBUG) {
    console.log(...args);
  }
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
    const t885Total = performance.now();
    const tDataFetchStart = performance.now();
    const tDataMappingStart = performance.now();

    if (!template.file_path) {
      result.error = "Template has no DOCX file";
      return result;
    }

    debugLog(`[generate-document] Processing template: ${template.name}`);

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

    // ── Participant-based contact lookup ──
    // Fetch participants from deal_participants, then resolve their contact records
    {
      const { data: participants, error: partError } = await supabase
        .from("deal_participants")
        .select("role, contact_id, name, email, phone")
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
      const primaryLender = lenderParticipants[0];
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
    const debugFields = ["ln_p_loanAmount", "of_fe_801LenderLoanOrigin", "pr_p_street", "br_p_fullName", "of_re_interestRate", "of_re_impoundHazardIns", "of_re_subtotalDeductions", "origination_esc.estimated_closing", "of_re_estimatedClosing"];
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

        const isPayable = canonical === "Payable to you";
        const isMustPay = canonical === "You Must Pay";

        fieldValues.set("re885_cash_payable_to_you", { rawValue: isPayable ? "true" : "false", dataType: "boolean" });
        fieldValues.set("re885_cash_you_must_pay",   { rawValue: isMustPay ? "true" : "false", dataType: "boolean" });

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
      // Per-property candidate strings: full address + street/city/zip components
      // so the bridge can match labels that wrap or strip the address.
      type PropCandidate = { idx: number; full: string; street: string; city: string; zip: string };
      const propCandidates: PropCandidate[] = [];
      const addressToPropIndex = new Map<string, number>();
      for (const pi of sortedPropIndices) {
        const full = normAddr(String(fieldValues.get(`property${pi}.address`)?.rawValue || ""));
        const street = normAddr(String(fieldValues.get(`property${pi}.street`)?.rawValue || ""));
        const city = normAddr(String(fieldValues.get(`property${pi}.city`)?.rawValue || ""));
        const zip = normAddr(String(fieldValues.get(`property${pi}.zip`)?.rawValue || ""));
        propCandidates.push({ idx: pi, full, street, city, zip });
        if (full && !addressToPropIndex.has(full)) addressToPropIndex.set(full, pi);
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
        const srcIndices = new Set<number>();
        for (const [k] of fieldValues.entries()) {
          const m = k.match(/^propertytax(\d+)\./);
          if (m) srcIndices.add(parseInt(m[1], 10));
        }
        const bridgeLog: string[] = [];
        const unmatchedLog: string[] = [];
        const sortedCandidates = [...propCandidates].sort((a, b) => a.idx - b.idx);
        for (const srcIdx of srcIndices) {
          const propAddrRaw = String(fieldValues.get(`propertytax${srcIdx}.property`)?.rawValue || "");
          if (!propAddrRaw) continue;
          const taxNorm = normAddr(propAddrRaw);

          let destIdx: number | undefined = addressToPropIndex.get(taxNorm);
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

      for (const idx of sortedPropIndices) {
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
      // ── RE851D: per-property INCOME publisher ──
      // Source: property{idx}.net_monthly_income (already bridged above).
      // Derived per-index aliases (no cross-property fallback):
      //   pr_p_netMonthlyIncome_{N} → numeric monthly value
      //   pr_p_incomeGenerating_{N} → "Yes" if net>0 else "No" (plain text)
      //   pr_p_grossAnnualIncome_{N} → net * 12 (numeric, unformatted)
      for (const idx of sortedPropIndices) {
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
      for (const idx of sortedPropIndices) {
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
    // Formula: Loan Amount / Estimate of Value (pr_p_appraiseValue)
    // Renders blank when Estimate is missing or 0 (no divide-by-zero).
    const existingLoanDivEstimate = fieldValues.get("ln_p_loanAmountDivByEstimateValue");
    if (!existingLoanDivEstimate || !existingLoanDivEstimate.rawValue) {
      const loanAmountVal2 = fieldValues.get("ln_p_loanAmount")?.rawValue || fieldValues.get("loan_terms.loan_amount")?.rawValue;
      const estimateVal = fieldValues.get("pr_p_appraiseValue")?.rawValue || fieldValues.get("property1.appraise_value")?.rawValue;
      const loanNum2 = parseFloat(String(loanAmountVal2 || "").replace(/[^0-9.-]/g, ""));
      const estimateNum = parseFloat(String(estimateVal || "").replace(/[^0-9.-]/g, ""));
      if (!isNaN(loanNum2) && !isNaN(estimateNum) && estimateNum > 0) {
        const ratio = loanNum2 / estimateNum;
        const ratioStr = ratio.toFixed(4);
        const pctStr = (ratio * 100).toFixed(2);
        fieldValues.set("ln_p_loanAmountDivByEstimateValue", { rawValue: ratioStr, dataType: "number" });
        fieldValues.set("ln_p_loanAmountDivByEstimateValue_pct", { rawValue: pctStr, dataType: "percentage" });
        debugLog(`[generate-document] Auto-computed ln_p_loanAmountDivByEstimateValue = ${ratioStr} (pct=${pctStr}%)`);
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

    // Bridge ld_fd_fundingAmount from lender funding data or loan amount if not set
    const existingFundingAmt = fieldValues.get("ld_fd_fundingAmount");
    if (!existingFundingAmt || !existingFundingAmt.rawValue) {
      const lenderFunding = fieldValues.get("lender.funding.amount")?.rawValue;
      const loanAmount = fieldValues.get("ln_p_loanAmount")?.rawValue || fieldValues.get("loan_terms.loan_amount")?.rawValue;
      const fundingVal = lenderFunding || loanAmount;
      if (fundingVal) {
        fieldValues.set("ld_fd_fundingAmount", { rawValue: String(fundingVal), dataType: "currency" });
        debugLog(`[generate-document] Auto-bridged ld_fd_fundingAmount = ${fundingVal}`);
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
    const brkBorrowerRaw = (
      fieldValues.get("or_p_isBrokerAlsoBorrower_yes")?.rawValue ??
      fieldValues.get("origination_app.doc.is_broker_also_borrower_yes")?.rawValue ??
      fieldValues.get("or_p_isBrkBorrower")?.rawValue ??
      fieldValues.get("origination.is_broker_also_a_borrower")?.rawValue ??
      ""
    ).toString().trim().toLowerCase();
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
        "priority": "ln_p_lienPositi",
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
        const aggregated = dedupedEntries.map(e => e.value).join("\n");
        const dataType = (field === "current_balance" || field === "original_balance" || 
                          field === "regular_payment" || field === "balance_after" ||
                          field === "anticipated_amount" || field === "existing_paydown_amount" ||
                          field === "existing_payoff_amount") ? "currency" : "text";

        // Set pr_li_* key with aggregated value
        const prLiKey = lienFieldToPrLi[field];
        if (prLiKey) {
          fieldValues.set(prLiKey, { rawValue: aggregated, dataType });
          debugLog(`[generate-document] Multi-lien bridged ${field} -> ${prLiKey} (${entries.length} liens)`);
        }

        // Also publish pr_p_currentBalanc alias (template tag for Property -> Liens Current Balance)
        if (field === "current_balance") {
          fieldValues.set("pr_p_currentBalanc", { rawValue: aggregated, dataType: "currency" });
          debugLog(`[generate-document] Published pr_p_currentBalanc (${entries.length} liens)`);
        }

        // Set li_* key with aggregated value
        const liKey = lienFieldToLiKeys[field];
        if (liKey) {
          fieldValues.set(liKey, { rawValue: aggregated, dataType });
          debugLog(`[generate-document] Multi-lien li bridged ${field} -> ${liKey} (${entries.length} liens)`);
        }

        // Set alt key (pr_li_lienPrioriNow, pr_li_lienPrioriAfter, li_bp_balanceAfter)
        const altKey = lienFieldToAltKeys[field];
        if (altKey) {
          fieldValues.set(altKey, { rawValue: aggregated, dataType });
          debugLog(`[generate-document] Multi-lien alt bridged ${field} -> ${altKey} (${entries.length} liens)`);
        }
      }
      debugLog(`[generate-document] Lien field bridging complete`);

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

        // Sum across all liens (lien1.current_balance, lien2.current_balance, …)
        let lienBalSum = 0;
        let antAmtSum = 0;
        let lienBalCount = 0;
        let antAmtCount = 0;
        for (const [key, val] of fieldValues.entries()) {
          const m = key.match(/^lien(\d*)\.(.+)$/);
          if (!m) continue;
          const field = m[2];
          if (field === "current_balance") {
            lienBalSum += toNum(val.rawValue);
            lienBalCount++;
          } else if (field === "anticipated_amount") {
            antAmtSum += toNum(val.rawValue);
            antAmtCount++;
          }
        }

        const estimateNum = toNum(estimateRaw);
        const loanAmtNum = toNum(loanAmtRaw);
        const netVal = estimateNum - loanAmtNum - lienBalSum - antAmtSum;

        fieldValues.set("pr_netPropertyValue", { rawValue: netVal.toFixed(2), dataType: "currency" });

        debugLog(`[generate-document] pr_netPropertyValue calc:`);
        debugLog(`  pr_pd_estimateValue: ${estimateRaw ?? "(null)"} -> ${estimateNum}`);
        debugLog(`  ln_p_loanAmount: ${loanAmtRaw ?? "(null)"} -> ${loanAmtNum}`);
        debugLog(`  pr_li_lienCurrenBalanc (sum of ${lienBalCount} liens): ${lienBalSum}`);
        debugLog(`  li_lt_anticipatedAmount (sum of ${antAmtCount} liens): ${antAmtSum}`);
        debugLog(`  pr_netPropertyValue: ${netVal.toFixed(2)}`);
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
          const currentDelinq = Number.isFinite(remBalNum) && remBalNum > 0;
          // Spec: Q1 = paid_off (slt_paid_off checkbox)
          const paidOff = truthy(getLienVal(prefix, "slt_paid_off", "sltPaidOff"));
          const source = getLienVal(prefix, "source_of_payment", "sourceOfPayment").trim();
          debugLog(`[generate-document] RE851D lien delinquency src ${prefix}: paidByLoan="${paidByLoanRaw}" howMany="${howManyRaw}" remBal="${remBalRaw}" paidOff=${paidOff} has60=${has60} currentDelinq=${currentDelinq} source="${source}" (Q1 uses anyPaidOff per property)`);

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
              perProp[pIdx] = { paidByLoan: false, delinq60: false, howMany: 0, currentDelinq: false, source: [], hasLien: false, allPaidOff: true, anyPaidOff: false, sourceInfoFirst: "", sourceInfoFirstLienIdx: null, sourceOfInfoText: "", sourceOfInfoPriorityFound: false };
            }
            const b = perProp[pIdx];
            b.hasLien = true;
            if (!paidOff) b.allPaidOff = false;
            if (paidOff) b.anyPaidOff = true;
            if (paidByLoan) b.paidByLoan = true;
            if (has60) b.delinq60 = true;
            if (currentDelinq) b.currentDelinq = true;
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
                  ["balloonAmount", firstNonEmpty("balloon_amount", "balloonAmount"), "currency"],
                ];

                const fieldAliases: Record<string, string[]> = {
                  interestRate: ["interest_rate", "intRate"],
                  beneficiary: ["lienHolder", "holder"],
                  maturityDate: ["maturity_date", "matDate"],
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
              const amt = parseAmt2(fieldValues.get(`${lp}.original_balance`)?.rawValue);
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
            // Amount of Equity = Market Value − Remaining Senior Encumbrances.
            // Source market value is the per-property appraise/estimate value.
            // Skip emission when market value is missing so the cell renders blank.
            const mvRaw =
              fieldValues.get(`pr_p_appraiseValue_${pi}`)?.rawValue ??
              fieldValues.get(`property${pi}.appraise_value`)?.rawValue;
            let equityStr = "";
            if (mvRaw !== null && mvRaw !== undefined && String(mvRaw).trim() !== "") {
              const mv = parseAmt2(mvRaw);
              const equity = mv - rem;
              equityStr = equity.toFixed(2);
              fieldValues.set(`ln_p_amountOfEquity_${pi}`, { rawValue: equityStr, dataType: "currency" });
            }
            debugLog(
              `[generate-document] RE851D Part1 rollup property${pi}: liens=[${matchedLog[pi].join(",")}], ` +
              `remaining=${rem.toFixed(2)}, expected=${exp.toFixed(2)}, total=${tot.toFixed(2)}, equity=${equityStr || "∅"}`
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
    const isTemplate851A = /851a/i.test(template.name || "");
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
    const isTemplate851D = /851d/i.test(template.name || "");
    const effectiveLabelMap = isTemplate851D
      ? {}
      : { ...labelMap, ...re851aLabelAdditions };

    let templateBuffer = new Uint8Array(await fileData.arrayBuffer());

    // ── RE851D: expand literal "_N" placeholders into per-occurrence "_1", "_2", ... ──
    // Some authored RE851D templates leave generic placeholders (e.g.
    // {{pr_p_address_N}}) inside each PROPERTY block instead of the resolved
    // indexed form. Without this preprocessing, the merge-tag resolver treats
    // "_N" as a literal field key and prints nothing, so all PROPERTY blocks
    // remain blank. We rewrite each occurrence by document order, capped at 5
    // (the spec's maximum properties per RE851D). Strictly scoped to known
    // RE851D placeholder families — no other tags are touched.
    if (/851d/i.test(template.name || "")) {
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
          "ln_p_totalEncumbrance_N", "ln_p_totalWithLoan_N", "ln_p_amountOfEquity_N", "property_number_N",
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
          // Per-property "Performed By" — both canonical and legacy-misspelled
          // aliases so PROPERTY #K blocks rewrite _N → _K and each property
          // renders its own appraisal_performed_by value.
          "pr_p_performedBy_N", "pr_p_performeBy_N",
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
          if (!xml.includes("_N")) {
            out[filename] = bytes;
            continue;
          }
          // Normalize fragmented Word runs BEFORE scanning for `_N` placeholders.
          // Word frequently splits "{{property_type_sfr_owner_N}}" across multiple
          // <w:r> runs, which prevents the plain-regex rewriter below from matching
          // those occurrences. Running normalizeWordXml first joins the runs so
          // every `_N` placeholder becomes a contiguous string. This is idempotent
          // — the later processDocx() call will re-normalize as a no-op fast-path.
          try {
            xml = normalizeWordXml(xml, template.name || "");
          } catch (_normErr) {
            // If normalization fails for any reason, fall back to the raw XML
            // (preserves previous behavior — partial rewrites are still better
            // than failing the whole document).
          }
          // Normalize parenthesized index syntax used by some authored RE851D
          // templates: pr_li_(rem|ant)_<field>_(N)_(S) -> _N_S, _(N) -> _N.
          // Strictly scoped to encumbrance families so other prose with
          // literal parens is never touched.
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
          if (regions.props.length > 0) {
            const encFields = [
              "priority", "interestRate", "interest_rate", "intRate",
              "beneficiary", "lienHolder", "holder",
              "originalAmount", "principalBalance",
              "monthlyPayment", "maturityDate", "maturity_date", "matDate",
              "balloonAmount",
              "balloonYes", "balloonNo", "balloonUnknown",
            ];
            const encTagRe = new RegExp(
              "\\bpr_li_(rem|ant)_(" + encFields.join("|") + ")(?:_N(?:_S)?)?(?![A-Za-z0-9_])",
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
              const region = resolveRegion(start);
              if (region.forcedIndex === null) continue;
              const pIdx = region.forcedIndex;
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
                  rendered = formatByDataType(v.rawValue, v.dataType);
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
              const yesAlias = fieldValues.get(`pr_li_currentDelinqu_${pIdx}_yes`);
              const bareAlias = fieldValues.get(`pr_li_currentDelinqu_${pIdx}`);
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
    if (/851d/i.test(template.name || "")) {
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
    const __xmlSet = (filename: string, xml: string): Uint8Array => {
      __xmlStrCache[filename] = xml;
      __xmlDirty.add(filename);
      // Drop any cached visible-text projection for this part — pass N+1
      // must rebuild from the freshly mutated XML.
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
    // Memory-optimized projection. The previous implementation allocated a
    // per-character `map: number[]` of length txt.length — on a ~4 MB
    // word/document.xml that array alone consumed 30+ MB of JS heap, which
    // was the dominant cause of the "Memory limit exceeded" crash on
    // 5-property RE851D documents. Replace with a compact segment table
    // (Int32Array) and a binary-search-based txt-index → xml-index resolver.
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
      // Materialize a dense Int32Array map: txt-index -> xml-index. Uses
      // sequential per-segment fill (O(N) total) instead of the previous
      // O(log n) Proxy lookup per access. The 6 RE851D safety passes do
      // many millions of map[i] accesses on 4.8 MB documents — Proxy traps
      // and binary searches were the dominant CPU sink that pushed the
      // function past the edge runtime CPU limit. A typed array of ~3M
      // int32 entries is ~12 MB of heap, well within the function memory
      // budget and orders of magnitude faster on access.
      const denseMap = new Int32Array(txt.length + 1);
      for (let si = 0; si < segN; si++) {
        const ts = txtStart[si];
        const xs = xmlStart[si];
        const sl = segLen[si];
        if (sl === 0) {
          // Synthetic space — single txt position maps to the '<' offset.
          denseMap[ts] = xs;
        } else {
          for (let k = 0; k < sl; k++) denseMap[ts + k] = xs + k;
        }
      }
      denseMap[txt.length] = xml.length;
      const map = denseMap as unknown as { length: number; [i: number]: number };
      const propAnchorsRaw: number[] = [];
      const propRe = /\bPROPERTY\s+INFORMATION\b/gi;
      let m: RegExpExecArray | null;
      while ((m = propRe.exec(txt)) !== null) {
        propAnchorsRaw.push(denseMap[m.index]);
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

    // ── RE851D POST-RENDER OWNER OCCUPIED safety pass ──
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
          const yesAlias = fieldValues.get(`pr_li_currentDelinqu_${k}_yes`);
          const bareAlias = fieldValues.get(`pr_li_currentDelinqu_${k}`);
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
    if (/851d/i.test(template.name || "")) {
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
            while ((am = anchorReTxt.exec(txtAEA)) !== null) {
              scanned++;
              const aStartXml = projAEA.map[am.index];
              const region = propRanges.find((p) => aStartXml >= p.start && aStartXml < p.end);
              const propK = region ? region.k : 1;
              const winStartXml = Math.max(region ? region.start : 0, aStartXml - 600);
              const winEndXml   = Math.min(region ? region.end : xml.length, aStartXml + 1500);

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

            const renderLienLines = (lp: string): string => {
              const beneficiary = getLien(lp, "lien_holder", "lienHolder", "holder", "beneficiary");
              const priority    = getLien(lp, "lien_priority_now", "priority", "lien_priority_after");
              const orig        = getLien(lp, "original_balance", "originalBalance");
              const cur         = getLien(lp, "current_balance", "currentBalance", "new_remaining_balance");
              const rate        = getLien(lp, "interest_rate", "intRate");
              const pmt         = getLien(lp, "regular_payment", "regularPayment");
              const mat         = getLien(lp, "maturity_date", "matDate");
              const lines: string[] = [];
              if (priority)    lines.push(`Priority: ${priority}`);
              if (beneficiary) lines.push(`Beneficiary: ${beneficiary}`);
              if (orig)        lines.push(`Original Amount: ${fmtCurrencyA(orig)}`);
              if (cur)         lines.push(`Approximate Principal Balance: ${fmtCurrencyA(cur)}`);
              if (pmt)         lines.push(`Monthly Payment: ${fmtCurrencyA(pmt)}`);
              if (rate)        lines.push(`Interest Rate: ${rate}${/%\s*$/.test(rate) ? "" : "%"}`);
              if (mat)         lines.push(`Maturity Date: ${mat}`);
              if (lines.length === 0) return para("(no details)");
              return lines.map(l => para(l)).join("");
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
          let r = formatByDataType(v.rawValue, v.dataType);
          // Cells already contain leading "$" / trailing "%" glyphs — strip ours so we
          // don't duplicate them.
          if (v.dataType === "currency" && r.startsWith("$")) r = r.substring(1).trim();
          if (v.dataType === "percent" && r.endsWith("%")) r = r.slice(0, -1).trim();
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
          { rx: /\bBENEFICIARY\b/i, suffix: "beneficiary" },
          { rx: /\bORIGINAL\s+AMOUNT\b/i, suffix: "originalAmount" },
          { rx: /\bAPPROXIMATE\s+PRINCIPAL\s+BALANCE\b/i, suffix: "principalBalance" },
          { rx: /\bMONTHLY\s+PAYMENT\b/i, suffix: "monthlyPayment" },
          { rx: /\bMATURITY\s+DATE\b/i, suffix: "maturityDate" },
          { rx: /\bIF\s+YES,\s*AMOUNT\b/i, suffix: "balloonAmount" },
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
                const states = [isYes, isNo, isUnk];
                // Find the next 3 checkbox controls within window in raw xml order.
                // Templates may use either glyph runs (☐/☑/☒) OR image-based runs
                // (a <w:r> containing a <w:drawing>). Match either.
                const slice = xml.slice(rawWinStart, rawWinEnd);
                const glyphRunRe = /(<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>)([\u2610\u2611\u2612])(<\/w:t>\s*<\/w:r>)/g;
                const drawingRunRe = /<w:r\b[^>]*>(?:\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:drawing\b[\s\S]*?<\/w:drawing>\s*<\/w:r>/g;
                type Hit = { idx: number; len: number; kind: "glyph" | "drawing"; cur?: string; pre?: string; post?: string };
                const hits: Hit[] = [];
                let gm: RegExpExecArray | null;
                while ((gm = glyphRunRe.exec(slice)) !== null) {
                  hits.push({ idx: gm.index, len: gm[0].length, kind: "glyph", pre: gm[1], cur: gm[2], post: gm[3] });
                }
                let dm: RegExpExecArray | null;
                while ((dm = drawingRunRe.exec(slice)) !== null) {
                  hits.push({ idx: dm.index, len: dm[0].length, kind: "drawing" });
                }
                hits.sort((a, b) => a.idx - b.idx);
                const labels = ["YES", "NO", "Unknown"];
                let labelsInjected = 0;
                for (let gIdx = 0; gIdx < Math.min(3, hits.length); gIdx++) {
                  const h = hits[gIdx];
                  const want = states[gIdx] ? "\u2611" : "\u2610";
                  const start = rawWinStart + h.idx;
                  const end = start + h.len;
                  let needReplace = false;
                  let replacement = "";
                  if (h.kind === "glyph") {
                    if (h.cur !== want) {
                      needReplace = true;
                      replacement = `${h.pre}${want}${h.post}`;
                    }
                  } else {
                    // Always swap drawing → glyph run so the rendered state matches.
                    needReplace = true;
                    replacement = `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${want}</w:t></w:r>`;
                  }
                  if (needReplace) {
                    inserts.push({ at: -end, html: `${replacement}|||REPLACE|||${start}` });
                  }
                  const tailEndCap = Math.min(xml.length, end + 400);
                  const pEnd = xml.indexOf("</w:p>", end);
                  const tailEnd = pEnd > 0 ? Math.min(pEnd, tailEndCap) : tailEndCap;
                  const tail = xml.slice(end, tailEnd).replace(/<[^>]+>/g, "").toUpperCase();
                  const lbl = labels[gIdx];
                  if (!tail.includes(lbl.toUpperCase())) {
                    const labelRun =
                      `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
                      `<w:t xml:space="preserve"> ${xmlEsc(lbl)}   </w:t></w:r>`;
                    inserts.push({ at: end, html: labelRun });
                    labelsInjected += 1;
                  }
                }
                debugLog(
                  `[generate-document] RE851D enc post-render P${region.k} ${tagPrefix === "pr_li_ant" ? "ANT" : "REM"} S${bSlot}: balloon=${isYes ? "YES" : isNo ? "NO" : "UNK"} labelsInjected=${labelsInjected}`,
                );
              }
            }
          }

          if (inserts.length === 0) {
            rezip[filename] = [bytes, { level: 0 }];
            continue;
          }
          // Apply: split into pure inserts (at >= 0) and replacements (at < 0 with marker)
          const pureInserts = inserts.filter(x => x.at >= 0).sort((a, b) => b.at - a.at);
          for (const ins of pureInserts) {
            xml = xml.slice(0, ins.at) + ins.html + xml.slice(ins.at);
          }
          const replacements = inserts
            .filter(x => x.at < 0)
            .map(x => {
              const [body, tail] = x.html.split("|||REPLACE|||");
              const start = parseInt(tail, 10);
              const end = -x.at;
              return { start, end, body };
            })
            .sort((a, b) => b.start - a.start);
          for (const r of replacements) {
            xml = xml.slice(0, r.start) + r.body + xml.slice(r.end);
          }
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
    // If any RE851D safety pass mutated the in-memory cache, rezip exactly
    // once now (instead of once per pass) before upload.
    if (__re851dPassCache) {
      try {
        const flushZip: fflate.Zippable = {};
        const flushEncoder = new TextEncoder();
        for (const [k, v] of Object.entries(__re851dPassCache)) {
          if (__xmlDirty.has(k)) {
            // Re-encode the cached mutated string exactly once.
            flushZip[k] = [flushEncoder.encode(__xmlStrCache[k]), { level: 0 }];
          } else {
            flushZip[k] = [v, { level: 0 }];
          }
        }
        processedDocx = new Uint8Array(fflate.zipSync(flushZip));
      } catch (flushErr) {
        console.error(
          `[generate-document] RE851D post-render flush failed:`,
          flushErr instanceof Error ? flushErr.message : String(flushErr),
        );
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

    // Create GenerationJob record
    const { data: job, error: jobError } = await supabase
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

    if (jobError) {
      console.error("[generate-document] Failed to create job:", jobError);
      return new Response(JSON.stringify({ error: "Failed to create generation job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    debugLog(`[generate-document] Created job: ${job.id}`);

    // Clean up stale jobs: mark any "running" jobs older than 120 seconds as "failed"
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
      .lt("started_at", staleThreshold)
      .neq("id", job.id);

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

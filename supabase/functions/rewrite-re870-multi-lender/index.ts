// One-shot admin function: rewrites the RE870 Investor Questionnaire
// template(s) so the Investor portion is wrapped in a {{#each lenders}}
// block and each name/type/entity field uses the multi-lender Handlebars
// helpers published by generate-document.
//
// Transforms (applied to word/document.xml of every targeted template):
//   1. {{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}
//        →  {{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}
//      (covers INVESTOR NAME + NAME OF PERSON COMPLETING THIS QUESTIONNAIRE)
//   2. NAME OF ENTITY: {{ld_p_vesting}}
//        →  NAME OF ENTITY: {{#if isIndividual}}-{{else}}{{vesting}}{{/if}}
//   3. {{ld_p_lenderType}}  →  {{type}}
//   4. Insert {{#each lenders}} marker paragraph BEFORE the paragraph
//      containing "INVESTOR NAME:".
//   5. Insert a page-break paragraph + {{/each}} marker paragraph BEFORE
//      the "BROKER ACKNOWLEDGEMENT" paragraph (broker block stays OUTSIDE
//      the loop and renders once).
//
// Idempotent: detects already-rewritten templates (presence of
// "{{#each lenders}}") and skips.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The 3 known RE870 template rows (looked up via DB).
const TEMPLATE_IDS = [
  "d25cc037-2657-4ae4-b6d3-65cd858d07f6", // "Investor Questionnaire"
  "c1bbc2ff-e2f4-433a-9e69-c4cf08217c61", // "re870"
  "9edf8c77-4f7f-47c7-945c-79b365462f12", // "test"
];

const EACH_OPEN_PARA =
  `<w:p><w:r><w:t xml:space="preserve">{{#each lenders}}</w:t></w:r></w:p>`;
const EACH_CLOSE_PARA =
  `<w:p><w:r><w:t xml:space="preserve">{{/each}}</w:t></w:r></w:p>`;
const PAGE_BREAK_PARA =
  `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

function rewriteDocumentXml(xml: string): { xml: string; changed: boolean; notes: string[] } {
  const notes: string[] = [];

  if (xml.includes("{{#each lenders}}")) {
    return { xml, changed: false, notes: ["already-rewritten (skipped)"] };
  }

  let out = xml;

  // 1. Combined name tags → isIndividual conditional.
  const nameTagLiteral =
    "{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}";
  const nameReplacement =
    "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}";
  let nameHits = 0;
  while (out.includes(nameTagLiteral)) {
    out = out.replace(nameTagLiteral, nameReplacement);
    nameHits++;
    if (nameHits > 10) break;
  }
  notes.push(`name-tag replacements: ${nameHits}`);

  // 2. NAME OF ENTITY vesting → conditional.
  const vestingLiteral = "{{ld_p_vesting}}";
  const vestingReplacement =
    "{{#if isIndividual}}-{{else}}{{vesting}}{{/if}}";
  let vestingHits = 0;
  while (out.includes(vestingLiteral)) {
    out = out.replace(vestingLiteral, vestingReplacement);
    vestingHits++;
    if (vestingHits > 10) break;
  }
  notes.push(`vesting-tag replacements: ${vestingHits}`);

  // 3. Lender type → {{type}} (so it resolves per-iteration).
  const typeLiteral = "{{ld_p_lenderType}}";
  let typeHits = 0;
  while (out.includes(typeLiteral)) {
    out = out.replace(typeLiteral, "{{type}}");
    typeHits++;
    if (typeHits > 10) break;
  }
  notes.push(`type-tag replacements: ${typeHits}`);

  // 4. Wrap investor block: insert {{#each lenders}} BEFORE paragraph
  //    containing "INVESTOR NAME:", and page break + {{/each}} BEFORE
  //    paragraph containing "BROKER ACKNOWLEDGEMENT".
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const matches: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(out)) !== null) {
    const inner = m[0];
    const text = (inner.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
      .join("");
    matches.push({ start: m.index, end: m.index + m[0].length, text });
  }

  const startIdx = matches.findIndex((p) => p.text.includes("INVESTOR NAME:"));
  const endIdx = matches.findIndex((p) =>
    p.text.includes("BROKER ACKNOWLEDGEMENT")
  );

  if (startIdx === -1) {
    notes.push("WARN: INVESTOR NAME paragraph not found — wrapper NOT inserted");
    return { xml: out, changed: true, notes };
  }
  if (endIdx === -1) {
    notes.push("WARN: BROKER ACKNOWLEDGEMENT paragraph not found — wrapper NOT inserted");
    return { xml: out, changed: true, notes };
  }
  if (endIdx <= startIdx) {
    notes.push("WARN: BROKER paragraph before INVESTOR paragraph — wrapper NOT inserted");
    return { xml: out, changed: true, notes };
  }

  // Insert close markers BEFORE broker paragraph, then open marker BEFORE
  // investor paragraph. Apply end-side insertion first to keep indices valid.
  const brokerStart = matches[endIdx].start;
  out =
    out.slice(0, brokerStart) +
    PAGE_BREAK_PARA +
    EACH_CLOSE_PARA +
    out.slice(brokerStart);

  const investorStart = matches[startIdx].start;
  out =
    out.slice(0, investorStart) +
    EACH_OPEN_PARA +
    out.slice(investorStart);

  notes.push(
    `wrapped paragraphs ${startIdx}..${endIdx - 1} in {{#each lenders}}`,
  );

  return { xml: out, changed: true, notes };
}

async function processTemplate(
  supabase: ReturnType<typeof createClient>,
  templateId: string,
) {
  const { data: tpl, error: tErr } = await supabase
    .from("templates")
    .select("id, name, file_path")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr) return { templateId, ok: false, error: tErr.message };
  if (!tpl) return { templateId, ok: false, error: "template not found" };
  if (!tpl.file_path) {
    return { templateId, ok: false, error: "template has no file_path" };
  }

  const { data: blob, error: dErr } = await supabase.storage
    .from("templates")
    .download(tpl.file_path);
  if (dErr || !blob) {
    return { templateId, ok: false, error: dErr?.message || "download failed" };
  }

  const buf = new Uint8Array(await blob.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = fflate.unzipSync(buf);
  } catch (e) {
    return { templateId, ok: false, error: `unzip failed: ${(e as Error).message}` };
  }

  const docKey = "word/document.xml";
  const docBytes = unzipped[docKey];
  if (!docBytes) {
    return { templateId, ok: false, error: "word/document.xml missing" };
  }
  const docXml = new TextDecoder().decode(docBytes);
  const { xml: newXml, changed, notes } = rewriteDocumentXml(docXml);

  if (!changed) {
    return {
      templateId,
      name: tpl.name,
      file_path: tpl.file_path,
      ok: true,
      skipped: true,
      notes,
    };
  }

  unzipped[docKey] = new TextEncoder().encode(newXml);
  let rezipped: Uint8Array;
  try {
    rezipped = fflate.zipSync(unzipped, { level: 6 });
  } catch (e) {
    return { templateId, ok: false, error: `zip failed: ${(e as Error).message}` };
  }

  const { error: upErr } = await supabase.storage
    .from("templates")
    .upload(tpl.file_path, rezipped, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
  if (upErr) {
    return { templateId, ok: false, error: `upload failed: ${upErr.message}` };
  }

  await supabase
    .from("templates")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", templateId);

  return {
    templateId,
    name: tpl.name,
    file_path: tpl.file_path,
    ok: true,
    skipped: false,
    bytes_before: buf.length,
    bytes_after: rezipped.length,
    notes,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let targetIds = TEMPLATE_IDS;
    try {
      const body = await req.json();
      if (body && Array.isArray(body.templateIds) && body.templateIds.length) {
        targetIds = body.templateIds;
      }
    } catch (_) {
      // no body — use defaults
    }

    const results = [];
    for (const id of targetIds) {
      results.push(await processTemplate(supabase, id));
    }

    return new Response(
      JSON.stringify({ ok: true, results }, null, 2),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

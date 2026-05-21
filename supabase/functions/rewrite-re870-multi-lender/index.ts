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
// Page break is emitted between iterations only — wrapped in an
// {{#unless @last}}…{{/unless}} block evaluated per-iteration by tag-parser.
const EACH_CLOSE_BLOCK =
  `<w:p><w:r><w:t xml:space="preserve">{{#unless @last}}</w:t></w:r></w:p>` +
  `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
  `<w:p><w:r><w:t xml:space="preserve">{{/unless}}</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t xml:space="preserve">{{/each}}</w:t></w:r></w:p>`;

/**
 * Walk top-level children of <w:body> (<w:p>, <w:tbl>, <w:sectPr>) and
 * return their absolute offsets in the source XML.
 */
function walkBodyChildren(
  xml: string,
): { kind: "p" | "tbl" | "sect"; start: number; end: number }[] {
  const bodyOpen = xml.indexOf("<w:body>");
  if (bodyOpen === -1) return [];
  const bodyStart = bodyOpen + "<w:body>".length;
  const bodyEnd = xml.lastIndexOf("</w:body>");
  if (bodyEnd === -1 || bodyEnd <= bodyStart) return [];
  const body = xml.substring(bodyStart, bodyEnd);
  const out: { kind: "p" | "tbl" | "sect"; start: number; end: number }[] = [];
  let i = 0;
  while (i < body.length) {
    if (
      body.startsWith("<w:p", i) &&
      (body[i + 4] === ">" || body[i + 4] === " " || body[i + 4] === "/")
    ) {
      if (body[i + 4] === "/" || body.startsWith("<w:p/>", i)) {
        const e = body.indexOf(">", i) + 1;
        out.push({ kind: "p", start: bodyStart + i, end: bodyStart + e });
        i = e;
        continue;
      }
      const e = body.indexOf("</w:p>", i);
      if (e === -1) break;
      const end = e + "</w:p>".length;
      out.push({ kind: "p", start: bodyStart + i, end: bodyStart + end });
      i = end;
    } else if (
      body.startsWith("<w:tbl", i) &&
      (body[i + 6] === ">" || body[i + 6] === " ")
    ) {
      const e = body.indexOf("</w:tbl>", i);
      if (e === -1) break;
      const end = e + "</w:tbl>".length;
      out.push({ kind: "tbl", start: bodyStart + i, end: bodyStart + end });
      i = end;
    } else if (body.startsWith("<w:sectPr", i)) {
      const e = body.indexOf("</w:sectPr>", i);
      if (e === -1) break;
      const end = e + "</w:sectPr>".length;
      out.push({ kind: "sect", start: bodyStart + i, end: bodyStart + end });
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

function extractText(xml: string): string {
  return (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
    .join(" ");
}

function rewriteDocumentXml(xml: string): { xml: string; changed: boolean; notes: string[] } {
  const notes: string[] = [];

  if (xml.includes("{{#each lenders}}")) {
    return { xml, changed: false, notes: ["already-rewritten (skipped)"] };
  }

  let out = xml;

  // 1. Combined name tags → isIndividual conditional (legacy literal form).
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

  // 2. NAME OF ENTITY vesting → conditional (legacy literal form).
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

  // 3. Lender type → {{type}} (resolves per-iteration inside {{#each}}).
  const typeLiteral = "{{ld_p_lenderType}}";
  let typeHits = 0;
  while (out.includes(typeLiteral)) {
    out = out.replace(typeLiteral, "{{type}}");
    typeHits++;
    if (typeHits > 10) break;
  }
  notes.push(`type-tag replacements: ${typeHits}`);

  // 4. Wrap the entire per-lender RE870 form in {{#each lenders}} …
  //    {{/each}}. Insertion is anchored to top-level <w:body> children
  //    so the markers are always between paragraphs/tables — never
  //    inside a run, cell, or paragraph. The loop spans every body
  //    child from index 0 (RE870 header) up to (but not including) the
  //    body child whose visible text contains BROKER ACKNOWLEDGEMENT;
  //    that signature table therefore stays outside the loop and is
  //    rendered exactly once at the bottom of the output.
  const children = walkBodyChildren(out);
  if (children.length === 0) {
    notes.push("WARN: could not parse <w:body> children — wrapper NOT inserted");
    return { xml: out, changed: true, notes };
  }
  const brokerIdx = children.findIndex(
    (c) =>
      c.kind === "tbl" &&
      extractText(out.substring(c.start, c.end))
        .toUpperCase()
        .includes("BROKER ACKNOWLEDGEMENT"),
  );
  if (brokerIdx === -1 || brokerIdx === 0) {
    notes.push("WARN: BROKER ACKNOWLEDGEMENT table not found — wrapper NOT inserted");
    return { xml: out, changed: true, notes };
  }

  // End-side insertion first so the start-side offset stays valid.
  const closeAt = children[brokerIdx].start;
  out = out.substring(0, closeAt) + EACH_CLOSE_BLOCK + out.substring(closeAt);

  const openAt = children[0].start;
  out = out.substring(0, openAt) + EACH_OPEN_PARA + out.substring(openAt);

  notes.push(
    `wrapped body children 0..${brokerIdx - 1} (incl. RE870 header) in {{#each lenders}}; broker section kept outside`,
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

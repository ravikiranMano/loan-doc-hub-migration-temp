// One-shot admin function: rewrites the "Note Purchaser Qualification Checklist"
// template so the body "Lender Name:" Handlebars block uses a {{#each lenders}}
// repeater (this.displayName) instead of bare primary-only ld_p_* keys.
//
// Per spec Step 1/Path A: collapse
//   {{#if (eq ld_p_lenderType "Individual")}}
//     {{ld_p_firstIfEntityUse}} {{ld_p_middle}} {{ld_p_last}}
//   {{else}}
//     {{ld_p_vesting}}
//   {{/if}}
// to:
//   {{#each lenders}}{{this.displayName}}
//   {{/each}}
//
// Detection strategy:
//   1. Stream <w:p> paragraphs in word/document.xml.
//   2. Locate the first paragraph whose visible text contains either
//      `ld_p_lenderType` and `Individual`, or `ld_p_firstIfEntityUse`, or
//      `ld_p_vesting` together with `{{#if`/`{{else}}`/`{{/if}}` markers.
//      Continue greedily into following paragraphs (within the same <w:tc>
//      cell, if any) until a matching `{{/if}}` is found — Word frequently
//      splits Handlebars blocks across paragraphs.
//   3. Replace the captured paragraph range with a single paragraph holding
//      a single run with the loop, preserving the original first paragraph's
//      <w:pPr> (so indentation/font of the "Lender Name:" line is kept).
//
// Idempotent — skips if the loop literal already exists in the body.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_ID = "680299de-f1eb-4a63-9b31-4b7b70c66948";
const MARKER = "<!-- note-purchaser-lender-loop:v1 -->";
const LOOP_LITERAL =
  "{{#each lenders}}{{this.displayName}}{{/each}}";

function visibleText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

function rewriteDocumentXml(
  xml: string,
): { xml: string; replaced: number; note: string } {
  if (xml.includes(MARKER)) {
    return { xml, replaced: 0, note: "already rewritten (marker found)" };
  }
  if (xml.includes(LOOP_LITERAL)) {
    return { xml, replaced: 0, note: "loop literal already present" };
  }

  // Collect all <w:p> spans with their visible text.
  const pRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  type Para = { start: number; end: number; xml: string; text: string };
  const paras: Para[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    paras.push({
      start: m.index,
      end: m.index + m[0].length,
      xml: m[0],
      text: visibleText(m[0]),
    });
  }

  // Find start paragraph: first one mentioning ld_p_lenderType OR
  // ld_p_firstIfEntityUse OR ld_p_vesting AND containing a `{{#if`.
  const startIdx = paras.findIndex((p) => {
    const t = p.text;
    if (!t.includes("{{#if")) return false;
    return (
      t.includes("ld_p_lenderType") ||
      t.includes("ld_p_firstIfEntityUse") ||
      t.includes("ld_p_vesting")
    );
  });
  if (startIdx === -1) {
    return { xml, replaced: 0, note: "no matching Handlebars block found" };
  }

  // Find end paragraph: the one (>= startIdx) whose accumulated visible text
  // contains a balanced {{/if}}. Cap the search at 12 paragraphs to avoid
  // unbounded growth on a malformed template.
  let endIdx = -1;
  let acc = "";
  for (let i = startIdx; i < Math.min(paras.length, startIdx + 12); i++) {
    acc += paras[i].text;
    const opens = (acc.match(/\{\{#if/g) || []).length;
    const closes = (acc.match(/\{\{\/if\}\}/g) || []).length;
    if (closes >= opens && closes > 0) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return {
      xml,
      replaced: 0,
      note: "could not locate balanced {{/if}} for the lender-name block",
    };
  }

  // Capture the original pPr from the start paragraph (preserve indent/font).
  const startP = paras[startIdx].xml;
  const pPrMatch = startP.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";

  // Build the replacement: a single paragraph containing one run with the
  // loop literal. The engine expands {{#each}} into one rendered line per
  // lender (see tag-parser.re870-investor-name.test.ts for analogous use).
  const replacement =
    `<w:p>${pPr}<w:r><w:t xml:space="preserve">${LOOP_LITERAL}</w:t></w:r></w:p>`;

  const before = xml.substring(0, paras[startIdx].start);
  const after = xml.substring(paras[endIdx].end);
  const out = before + replacement + after;

  // Inject marker comment just before </w:body> so re-runs are idempotent.
  const withMarker = out.replace(/<\/w:body>/, `${MARKER}</w:body>`);

  return {
    xml: withMarker,
    replaced: endIdx - startIdx + 1,
    note: `replaced paragraphs ${startIdx}..${endIdx}`,
  };
}

async function rewriteTemplate(
  supabase: ReturnType<typeof createClient>,
  templateId: string,
  force: boolean,
): Promise<Record<string, unknown>> {
  const { data: row, error: rowErr } = await supabase
    .from("templates")
    .select("id, name, file_path")
    .eq("id", templateId)
    .maybeSingle();
  if (rowErr) throw new Error(`templates lookup failed: ${rowErr.message}`);
  if (!row) return { templateId, skipped: "template row not found" };
  if (!row.file_path) return { templateId, skipped: "no file_path on template" };

  const { data: blob, error: dlErr } = await supabase.storage
    .from("templates")
    .download(row.file_path);
  if (dlErr || !blob) {
    throw new Error(`download failed: ${dlErr?.message || "no blob"}`);
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  const unzipped = fflate.unzipSync(buf);
  const docPath = "word/document.xml";
  if (!unzipped[docPath]) {
    return { templateId, skipped: "no word/document.xml" };
  }
  const docXml = new TextDecoder().decode(unzipped[docPath]);

  if (!force && docXml.includes(MARKER)) {
    return { templateId, name: row.name, skipped: "already marked" };
  }

  const { xml: nextXml, replaced, note } = rewriteDocumentXml(docXml);
  if (replaced === 0) {
    return { templateId, name: row.name, replaced: 0, note };
  }

  unzipped[docPath] = new TextEncoder().encode(nextXml);
  const rezipped = fflate.zipSync(unzipped, { level: 6 });

  const { error: upErr } = await supabase.storage
    .from("templates")
    .upload(row.file_path, rezipped, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);

  return {
    templateId,
    name: row.name,
    file_path: row.file_path,
    replaced,
    note,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let body: { templateId?: string; force?: boolean } = {};
    try {
      body = await req.json();
    } catch (_) {
      // empty body is fine
    }

    const targets = body.templateId ? [body.templateId] : [TEMPLATE_ID];
    const force = body.force === true;
    const results: unknown[] = [];
    for (const id of targets) {
      try {
        results.push(await rewriteTemplate(supabase, id, force));
      } catch (e) {
        results.push({ templateId: id, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

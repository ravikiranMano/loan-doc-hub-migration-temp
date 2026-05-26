// One-shot admin function: collapses excessive whitespace bleed inside the
// INVESTOR NAME and NAME OF PERSON COMPLETING THIS QUESTIONNAIRE cells of the
// Investor Questionnaire template.
//
// Symptom: each lender displayName ends up separated from the next by 4 blank
// visual lines, because the template authored the {{#each lenders}} loop with
// multiple soft line breaks ("for readability") between {{displayName}} and
// {{/each}}. docx preserves every <w:br/> verbatim, so each iteration emits
// the lender name followed by ~5 empty <w:br/><w:t/> pairs.
//
// Strategy: scope changes STRICTLY to the two target cells. Within each cell,
// drop empty self-closing <w:t/> elements and collapse runs of consecutive
// <w:br/> elements to a single <w:br/>. This leaves real label text + real
// name text + exactly one break between iterations.
//
// WARNING (per project memory: do NOT inject hardcoded rFonts/sz/spacing/tbl
// wrappers). This function only deletes empty markup; it never invents new
// runs, paragraph properties, or fonts. Formatting is therefore inherited
// verbatim from whatever the template author already set on the cell.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_ID = "d25cc037-2657-4ae4-b6d3-65cd858d07f6";
const MARKER_V1 = "<!-- investor-questionnaire-lender-loop:v1 -->";

const CELL_LABELS = [
  /INVESTOR\s+NAME\s*:/i,
  /NAME\s+OF\s+PERSON\s+COMPLETING\s+THIS\s+QUESTIONNAIRE/i,
];

function visibleText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

/**
 * Collapse whitespace bleed inside a single target cell's XML.
 *
 * The template authored the {{#each lenders}}...{{/each}} block with a
 * <w:br/> sitting inside almost every run that carries a Handlebars tag —
 * one before {{#if}}, one before {{firstName}}, one before {{else}}, one
 * before {{vesting}}, one before {{/if}}, one before {{/each}}. That's 5–6
 * soft line breaks per loop iteration, which is exactly why each rendered
 * lender name is separated by 4 blank visual lines.
 *
 * Fix: scope to runs that carry Handlebars syntax (text contains "{{").
 * Strip every <w:br/> from those runs. Then re-introduce exactly ONE
 * <w:br/> immediately before the {{/each}} run's text, so that each loop
 * iteration still emits a single line break between lender names.
 *
 * We do NOT touch the label run ("INVESTOR NAME:" / "NAME OF PERSON
 * COMPLETING THIS QUESTIONNAIRE") nor the single <w:br/> the template
 * author placed between the label and the loop — those carry no "{{".
 */
function tidyCellXml(cellXml: string): { xml: string; changed: boolean } {
  const before = cellXml;
  const rRe = /<w:r\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:r>)/g;
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = rRe.exec(cellXml)) !== null) {
    out += cellXml.substring(cursor, m.index);
    cursor = m.index + m[0].length;
    let runXml = m[0];
    const text = (runXml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
      .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
      .join("");
    if (text.includes("{{")) {
      // Strip every <w:br/> inside this Handlebars-carrying run.
      runXml = runXml.replace(/<w:br\s*\/>/g, "");
      // If this run carries the {{/each}} closer, re-introduce ONE <w:br/>
      // immediately before its first <w:t> so iteration N -> N+1 still
      // produces a single visual line break.
      if (/\{\{\s*\/each\s*\}\}/.test(text)) {
        runXml = runXml.replace(
          /(<w:t(?:\s[^>]*)?>)/,
          "<w:br/>$1",
        );
      }
    }
    out += runXml;
  }
  out += cellXml.substring(cursor);
  return { xml: out, changed: out !== before };
}

function rewriteDocumentXml(
  xml: string,
): { xml: string; replaced: number; note: string } {
  // Walk every <w:tc> cell. If its visible text matches a target label, tidy
  // it in-place. We do NOT touch any other cell.
  const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  let replaced = 0;
  const notes: string[] = [];
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = tcRe.exec(xml)) !== null) {
    const cellXml = m[0];
    const text = visibleText(cellXml);
    const matchedLabel = CELL_LABELS.find((re) => re.test(text));
    out += xml.substring(cursor, m.index);
    if (matchedLabel) {
      const { xml: nextCell, changed } = tidyCellXml(cellXml);
      if (changed) {
        replaced++;
        notes.push(`tidied cell @${m.index} (${matchedLabel.source})`);
      }
      out += nextCell;
    } else {
      out += cellXml;
    }
    cursor = m.index + cellXml.length;
  }
  out += xml.substring(cursor);

  if (replaced > 0 && !out.includes(MARKER_V1)) {
    out = out.replace(/<\/w:body>/, `${MARKER_V1}</w:body>`);
  }

  return { xml: out, replaced, note: notes.join("; ") || "no target cells changed" };
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
    .download(row.file_path as string);
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

  if (!force && docXml.includes(MARKER_V1)) {
    return { templateId, name: row.name, skipped: "already at v1" };
  }

  const { xml: nextXml, replaced, note } = rewriteDocumentXml(docXml);
  if (replaced === 0 && nextXml === docXml) {
    return { templateId, name: row.name, replaced: 0, note };
  }

  unzipped[docPath] = new TextEncoder().encode(nextXml);
  const rezipped = fflate.zipSync(unzipped, { level: 6 });

  const { error: upErr } = await supabase.storage
    .from("templates")
    .upload(row.file_path as string, rezipped, {
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

    let body: { templateId?: string; force?: boolean; debug?: boolean } = {};
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
        if (body.debug) {
          const { data: row } = await supabase.from("templates").select("file_path").eq("id", id).maybeSingle();
          const fp = row?.file_path as string | undefined;
          if (!fp) { results.push({ id, err: "no file_path" }); continue; }
          const { data: blob } = await supabase.storage.from("templates").download(fp);
          if (!blob) { results.push({ id, err: "no blob" }); continue; }
          const buf = new Uint8Array(await blob.arrayBuffer());
          const u = fflate.unzipSync(buf);
          const x = new TextDecoder().decode(u["word/document.xml"]);
          const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
          const cells: Array<{ idx: number; text: string; hasBr: number; hasEmptyT: number; xmlSnippet?: string }> = [];
          let mm: RegExpExecArray | null; let i = 0;
          while ((mm = tcRe.exec(x)) !== null) {
            const t = visibleText(mm[0]);
            if (/INVESTOR|QUESTIONNAIRE|PERSON|COMPLETING|lender|each/i.test(t) || mm[0].includes("{{")) {
              cells.push({
                idx: i,
                text: t.slice(0, 200),
                hasBr: (mm[0].match(/<w:br\s*\/>/g) || []).length,
                hasEmptyT: (mm[0].match(/<w:t(?:\s[^>]*)?\/>/g) || []).length,
                xmlSnippet: mm[0].length < 4000 ? mm[0] : mm[0].slice(0, 4000),
              });
            }
            i++;
          }
          results.push({ id, totalCells: i, interesting: cells });
        } else {
          results.push(await rewriteTemplate(supabase, id, force));
        }
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

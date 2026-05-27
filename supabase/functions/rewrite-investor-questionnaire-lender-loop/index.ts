// One-shot admin function: rebuilds the INVESTOR NAME and NAME OF PERSON
// COMPLETING THIS QUESTIONNAIRE cells in the RE870 Investor Questionnaire
// template so that:
//
//   1. The label ("INVESTOR NAME:" / "NAME OF PERSON ...") is in its own
//      <w:p> paragraph.
//   2. A blank <w:p> paragraph sits between the label and the value.
//   3. The value paragraph contains the {{#each lenders}}...{{/each}} loop
//      with a <w:br/> per iteration so each lender prints on its own line.
//
// Scope is STRICTLY limited to those two cells. All other content - including
// table structure, sibling cells, fonts, indentation, run properties, and
// paragraph properties - is preserved verbatim from the template.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Default to the RE870 template id (per templates table lookup).
const TEMPLATE_ID = "c1bbc2ff-e2f4-433a-9e69-c4cf08217c61";
const MARKER_V2 = "<!-- investor-questionnaire-lender-loop:v2 -->";

const LENDER_LOOP_BODY =
  "{{#each lenders}}{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}";

function visibleText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

function extractPPr(pXml: string): string {
  const m = pXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : "";
}

function extractFirstRPr(runXml: string): string {
  const m = runXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
  return m ? m[0] : "";
}

function findRunWithText(pXml: string, needle: string): string | null {
  const rRe = /<w:r\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:r>)/g;
  let m: RegExpExecArray | null;
  while ((m = rRe.exec(pXml)) !== null) {
    const text = (m[0].match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
      .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
      .join("");
    if (text.includes(needle)) return m[0];
  }
  return null;
}

/**
 * Rebuild the INVESTOR NAME cell. Returns updated cell XML, or null if the
 * cell doesn't match the expected shape.
 */
function rebuildInvestorNameCell(cellXml: string): string | null {
  // Find the (single) paragraph that carries both the label and the loop.
  const pRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  let target: { match: string; start: number; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(cellXml)) !== null) {
    const txt = visibleText(m[0]);
    if (/INVESTOR\s+NAME\s*:/i.test(txt) && txt.includes("{{#each lenders}}")) {
      target = { match: m[0], start: m.index, end: m.index + m[0].length };
      break;
    }
  }
  if (!target) return null;

  const pPr = extractPPr(target.match);
  const labelRun = findRunWithText(target.match, "INVESTOR NAME");
  const loopRun = findRunWithText(target.match, "{{#each lenders}}");
  if (!labelRun || !loopRun) return null;

  const labelRPr = extractFirstRPr(labelRun);
  const loopRPr = extractFirstRPr(loopRun);

  const labelPara =
    `<w:p>${pPr}<w:r>${labelRPr}<w:t xml:space="preserve">INVESTOR NAME:</w:t></w:r></w:p>`;
  const blankPara = `<w:p>${pPr}</w:p>`;
  const loopPara =
    `<w:p>${pPr}` +
    `<w:r>${loopRPr}<w:t xml:space="preserve">${LENDER_LOOP_BODY}</w:t></w:r>` +
    `<w:r>${loopRPr}<w:br/></w:r>` +
    `<w:r>${loopRPr}<w:t xml:space="preserve">{{/each}}</w:t></w:r>` +
    `</w:p>`;

  const next =
    cellXml.substring(0, target.start) +
    labelPara + blankPara + loopPara +
    cellXml.substring(target.end);
  return next;
}

/**
 * For the NAME OF PERSON COMPLETING THIS QUESTIONNAIRE cell: the template
 * already keeps the label and value in separate paragraphs. We only need to
 * insert one blank paragraph between them so the visual separation matches
 * the INVESTOR NAME cell.
 */
function rebuildNameOfPersonCell(cellXml: string): string | null {
  const pRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  const paragraphs: Array<{ match: string; start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(cellXml)) !== null) {
    paragraphs.push({
      match: m[0],
      start: m.index,
      end: m.index + m[0].length,
      text: visibleText(m[0]),
    });
  }
  const labelIdx = paragraphs.findIndex((p) =>
    /NAME\s+OF\s+PERSON\s+COMPLETING\s+THIS\s+QUESTIONNAIRE/i.test(p.text)
  );
  if (labelIdx < 0) return null;
  const valueIdx = labelIdx + 1;
  if (valueIdx >= paragraphs.length) return null;

  // If a blank paragraph is already there, do nothing.
  if (paragraphs[valueIdx].text.trim() === "" &&
      !/NAME\s+OF\s+PERSON/i.test(paragraphs[valueIdx].text)) {
    // Already has a blank paragraph; nothing to do.
    return null;
  }

  const pPr = extractPPr(paragraphs[labelIdx].match);
  const blankPara = `<w:p>${pPr}</w:p>`;
  const insertAt = paragraphs[labelIdx].end;
  return cellXml.substring(0, insertAt) + blankPara + cellXml.substring(insertAt);
}

function rewriteDocumentXml(
  xml: string,
): { xml: string; replaced: number; notes: string[] } {
  const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  let replaced = 0;
  const notes: string[] = [];
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = tcRe.exec(xml)) !== null) {
    const cellXml = m[0];
    const text = visibleText(cellXml);
    out += xml.substring(cursor, m.index);
    let nextCell: string | null = null;
    if (/INVESTOR\s+NAME\s*:/i.test(text) && text.includes("{{#each lenders}}")) {
      nextCell = rebuildInvestorNameCell(cellXml);
      if (nextCell) {
        replaced++;
        notes.push(`rebuilt INVESTOR NAME cell @${m.index}`);
      }
    } else if (/NAME\s+OF\s+PERSON\s+COMPLETING\s+THIS\s+QUESTIONNAIRE/i.test(text)) {
      nextCell = rebuildNameOfPersonCell(cellXml);
      if (nextCell) {
        replaced++;
        notes.push(`inserted blank paragraph in NAME OF PERSON cell @${m.index}`);
      }
    }
    out += nextCell ?? cellXml;
    cursor = m.index + cellXml.length;
  }
  out += xml.substring(cursor);

  if (replaced > 0 && !out.includes(MARKER_V2)) {
    out = out.replace(/<\/w:body>/, `${MARKER_V2}</w:body>`);
  }
  return { xml: out, replaced, notes };
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

  if (!force && docXml.includes(MARKER_V2)) {
    return { templateId, name: row.name, skipped: "already at v2" };
  }

  const { xml: nextXml, replaced, notes } = rewriteDocumentXml(docXml);
  if (replaced === 0 && nextXml === docXml) {
    return { templateId, name: row.name, replaced: 0, notes };
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
    notes,
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
    try { body = await req.json(); } catch (_) { /* empty body */ }

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
          const cells: Array<{ idx: number; text: string; xml: string }> = [];
          let mm: RegExpExecArray | null; let i = 0;
          while ((mm = tcRe.exec(x)) !== null) {
            const t = visibleText(mm[0]);
            if (/INVESTOR\s+NAME\s*:|NAME\s+OF\s+PERSON/i.test(t)) {
              cells.push({ idx: i, text: t.slice(0, 300), xml: mm[0] });
            }
            i++;
          }
          results.push({ id, hasV2: x.includes(MARKER_V2), cells });
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

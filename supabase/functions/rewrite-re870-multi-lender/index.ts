// One-shot admin function: rewrites the RE870 Investor Questionnaire
// template(s) so ONLY the INVESTOR NAME cell loops over every lender,
// while the rest of the form remains a single instance bound to the
// primary lender.
//
// v2 transforms (applied to word/document.xml of every targeted template):
//   1. UNDO v1: remove the standalone {{#each lenders}} marker paragraph
//      and the matching close block ({{#unless @last}}…page break…
//      {{/unless}}{{/each}}) that v1 injected to wrap the entire form.
//   2. Ensure the legacy combined-name tag is rewritten to the
//      isIndividual conditional (covers both INVESTOR NAME and NAME OF
//      PERSON COMPLETING THIS QUESTIONNAIRE occurrences).
//   3. Ensure NAME OF ENTITY uses the isIndividual conditional.
//   4. Ensure {{ld_p_lenderType}} → {{type}} (resolves per-iteration).
//   5. In the <w:tc> table cell that contains "INVESTOR NAME", split the
//      label and the conditional into separate paragraphs (if not already
//      split) and wrap ONLY the conditional paragraph in marker
//      paragraphs: {{#each lenders}} … {{/each}}. Each lender then
//      renders as its own paragraph (stacked lines) inside that single
//      cell.
//
// Idempotent: detects the v2 marker comment <!-- re870-rewrite:v2 -->
// near <w:body> and skips. Pass { force: true } in the request body to
// bypass the skip (required to migrate v1-wrapped templates).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The 3 known RE870 template rows.
const TEMPLATE_IDS = [
  "d25cc037-2657-4ae4-b6d3-65cd858d07f6", // "Investor Questionnaire"
  "c1bbc2ff-e2f4-433a-9e69-c4cf08217c61", // "re870"
  "9edf8c77-4f7f-47c7-945c-79b365462f12", // "test"
];

const V2_MARKER = "<!-- re870-rewrite:v2 -->";

// Marker paragraphs for the INVESTOR NAME inner loop.
const EACH_OPEN_PARA =
  `<w:p><w:r><w:t xml:space="preserve">{{#each lenders}}</w:t></w:r></w:p>`;
const EACH_CLOSE_PARA =
  `<w:p><w:r><w:t xml:space="preserve">{{/each}}</w:t></w:r></w:p>`;

// ────────────────────────────────────────────────────────────────────────────
// Pass A — undo v1 full-form wrapper paragraphs
// ────────────────────────────────────────────────────────────────────────────
function stripV1Wrappers(xml: string): { xml: string; removed: number } {
  let removed = 0;
  let out = xml;

  // Match any standalone <w:p> whose only visible text is exactly
  // "{{#each lenders}}", "{{/each}}", "{{#unless @last}}", or
  // "{{/unless}}". Also match the page-break paragraph that v1 emitted
  // between iterations: a <w:p> containing only <w:br w:type="page"/>.
  const standaloneTagP =
    /<w:p\b[^>]*>(?:(?!<\/w:p>).)*?<w:t[^>]*>\s*\{\{\s*(?:#each\s+lenders|\/each|#unless\s+@last|\/unless)\s*\}\}\s*<\/w:t>(?:(?!<\/w:p>).)*?<\/w:p>/gs;
  out = out.replace(standaloneTagP, () => {
    removed++;
    return "";
  });

  const pageBreakP =
    /<w:p\b[^>]*>\s*<w:r\b[^>]*>\s*<w:br\s+w:type="page"\s*\/>\s*<\/w:r>\s*<\/w:p>/g;
  out = out.replace(pageBreakP, () => {
    removed++;
    return "";
  });

  return { xml: out, removed };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — search/replace literal patterns
// ────────────────────────────────────────────────────────────────────────────
function replaceLiteral(xml: string, find: string, replace: string): { xml: string; hits: number } {
  let hits = 0;
  let out = xml;
  while (out.includes(find)) {
    out = out.replace(find, replace);
    hits++;
    if (hits > 20) break;
  }
  return { xml: out, hits };
}

// Strip all visible text from a chunk of XML (used to test cell contents).
function visibleText(xml: string): string {
  return (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

// ────────────────────────────────────────────────────────────────────────────
// Pass B — wrap the INVESTOR NAME cell's conditional paragraph in
//          {{#each lenders}} … {{/each}}
// ────────────────────────────────────────────────────────────────────────────
function wrapInvestorNameCell(xml: string): { xml: string; note: string } {
  // Find the <w:tc> that contains the literal "INVESTOR NAME" in its text.
  const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  let m: RegExpExecArray | null;
  let targetStart = -1;
  let targetEnd = -1;
  while ((m = tcRe.exec(xml)) !== null) {
    const tc = m[0];
    const text = visibleText(tc).toUpperCase().replace(/\s+/g, " ");
    if (text.includes("INVESTOR NAME")) {
      targetStart = m.index;
      targetEnd = m.index + tc.length;
      break;
    }
  }
  if (targetStart === -1) {
    return { xml, note: "WARN: INVESTOR NAME <w:tc> not found" };
  }

  const cellXml = xml.substring(targetStart, targetEnd);

  // Already wrapped (idempotency within the cell)
  if (cellXml.includes("{{#each lenders}}")) {
    return { xml, note: "INVESTOR NAME cell already wraps {{#each lenders}}" };
  }

  // Find the <w:p> paragraph inside the cell that contains the
  // {{#if isIndividual}} conditional. We split the cell into its
  // top-level paragraphs and rebuild.
  const paraRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  const paragraphs: string[] = [];
  let lastIdx = 0;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(cellXml)) !== null) {
    paragraphs.push(cellXml.substring(lastIdx, pm.index)); // gap
    paragraphs.push(pm[0]); // paragraph
    lastIdx = pm.index + pm[0].length;
  }
  paragraphs.push(cellXml.substring(lastIdx));

  // Find the FIRST paragraph that contains {{#if isIndividual}} (or, as
  // a fallback, the legacy {{ld_p_firstIfEntityUse}} tag if substitution
  // hasn't run yet).
  let condParaIdx = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p.startsWith("<w:p")) continue;
    if (
      p.includes("{{#if isIndividual}}") ||
      p.includes("{{ld_p_firstIfEntityUse}}")
    ) {
      condParaIdx = i;
      break;
    }
  }
  if (condParaIdx === -1) {
    return {
      xml,
      note: "WARN: INVESTOR NAME cell found but no conditional paragraph located",
    };
  }

  let condPara = paragraphs[condParaIdx];

  // If the conditional paragraph also contains the literal text
  // "INVESTOR NAME" (label and value share a paragraph), split it.
  // Strategy: remove the "INVESTOR NAME:" substring from the conditional
  // paragraph (it stays in the visual text of the cell as a separate
  // paragraph we synthesize and prepend).
  let labelPara = "";
  const paraText = visibleText(condPara).toUpperCase();
  if (paraText.includes("INVESTOR NAME")) {
    // Build a clone paragraph that keeps the run formatting but only
    // shows the label, by copying the first run's <w:rPr> if present.
    const firstRpr = (condPara.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
    labelPara = `<w:p><w:r>${firstRpr}<w:t xml:space="preserve">INVESTOR NAME:</w:t></w:r></w:p>`;
    // Strip the label text from every <w:t> in the conditional paragraph.
    condPara = condPara.replace(
      /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g,
      (full, attrs, text) => {
        // Remove "INVESTOR NAME:" (and stray trailing whitespace) — case
        // insensitive — but keep the rest of the text untouched.
        const cleaned = text.replace(/INVESTOR\s+NAME\s*:?\s*/i, "");
        return `<w:t${attrs}>${cleaned}</w:t>`;
      },
    );
  }

  // Build the replacement sequence:
  //   [optional label paragraph] + EACH_OPEN_PARA + conditional paragraph + EACH_CLOSE_PARA
  const newSequence =
    labelPara + EACH_OPEN_PARA + condPara + EACH_CLOSE_PARA;
  paragraphs[condParaIdx] = newSequence;

  const newCellXml = paragraphs.join("");
  const newXml =
    xml.substring(0, targetStart) + newCellXml + xml.substring(targetEnd);

  return {
    xml: newXml,
    note: labelPara
      ? "INVESTOR NAME label split into its own paragraph; conditional wrapped in {{#each lenders}}"
      : "INVESTOR NAME conditional paragraph wrapped in {{#each lenders}}",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level rewrite
// ────────────────────────────────────────────────────────────────────────────
function rewriteDocumentXml(
  xml: string,
  force: boolean,
): { xml: string; changed: boolean; notes: string[] } {
  const notes: string[] = [];

  if (!force && xml.includes(V2_MARKER)) {
    return { xml, changed: false, notes: ["already-rewritten v2 (skipped)"] };
  }

  let out = xml;

  // (a) Undo v1 full-form wrapper paragraphs (idempotent — removes 0 if
  //     never wrapped).
  const stripped = stripV1Wrappers(out);
  out = stripped.xml;
  notes.push(`v1 wrapper paragraphs removed: ${stripped.removed}`);

  // Remove any prior v2 marker before re-injecting (force re-run safety).
  out = out.split(V2_MARKER).join("");

  // (b) Tag substitutions — legacy combined-name + entity + type.
  const nameRepl = replaceLiteral(
    out,
    "{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}",
    "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}",
  );
  out = nameRepl.xml;
  notes.push(`name-tag replacements: ${nameRepl.hits}`);

  const vestRepl = replaceLiteral(
    out,
    "{{ld_p_vesting}}",
    "{{#if isIndividual}}-{{else}}{{vesting}}{{/if}}",
  );
  out = vestRepl.xml;
  notes.push(`vesting-tag replacements: ${vestRepl.hits}`);

  const typeRepl = replaceLiteral(out, "{{ld_p_lenderType}}", "{{type}}");
  out = typeRepl.xml;
  notes.push(`type-tag replacements: ${typeRepl.hits}`);

  // (c) Wrap the INVESTOR NAME cell's conditional paragraph.
  const wrapped = wrapInvestorNameCell(out);
  out = wrapped.xml;
  notes.push(wrapped.note);

  // (d) Inject the v2 marker so subsequent runs short-circuit (unless force).
  const bodyIdx = out.indexOf("<w:body>");
  if (bodyIdx !== -1) {
    const insertAt = bodyIdx + "<w:body>".length;
    out = out.substring(0, insertAt) + V2_MARKER + out.substring(insertAt);
  }

  return { xml: out, changed: out !== xml, notes };
}

async function processTemplate(
  supabase: ReturnType<typeof createClient>,
  templateId: string,
  force: boolean,
  debug: boolean,
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
  const { xml: newXml, changed, notes } = rewriteDocumentXml(docXml, force);

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
    let force = false;
    try {
      const body = await req.json();
      if (body && Array.isArray(body.templateIds) && body.templateIds.length) {
        targetIds = body.templateIds;
      }
      if (body && body.force === true) force = true;
    } catch (_) {
      // no body — use defaults
    }

    const results = [];
    for (const id of targetIds) {
      results.push(await processTemplate(supabase, id, force));
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

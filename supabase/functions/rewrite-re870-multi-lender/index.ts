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
const V3_MARKER = "<!-- re870-rewrite:v3 -->";
const V4_MARKER = "<!-- re870-rewrite:v4 -->";
const V5_MARKER = "<!-- re870-rewrite:v5 -->";

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
  return (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

function isInvestorNameCellText(text: string): boolean {
  const normalized = text.toUpperCase().replace(/\s+/g, " ").trim();
  return (normalized === "INVESTOR" || /\bINVESTOR NAME\b/.test(normalized)) && !/\bCO[-\s]?INVESTOR NAME\b/.test(normalized);
}

// ────────────────────────────────────────────────────────────────────────────
// Pass B — wrap the INVESTOR NAME cell's conditional paragraph in
//          {{#each lenders}} … {{/each}}
//
// The template stores the three legacy field tags as fragmented runs:
//   {{ld + _p_firstIfEntityUse + }}{{ + ld_p_middle + }}{{ + ld_p_last + }}
// so a literal find/replace cannot match. Instead we rewrite the whole
// paragraph: split it into a label paragraph ("INVESTOR NAME:") and a
// conditional paragraph that contains a single run holding the
// isIndividual if/else block. The conditional paragraph is then wrapped
// in {{#each lenders}} / {{/each}} marker paragraphs so each lender
// renders as its own line inside the cell.
// ────────────────────────────────────────────────────────────────────────────
function wrapInvestorNameCell(xml: string): { xml: string; note: string } {
  // Find the <w:tc> that contains the literal "INVESTOR NAME" in its text,
  // excluding the "CO-INVESTOR NAME" cell which appears earlier in the form.
  const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  let m: RegExpExecArray | null;
  let targetStart = -1;
  let targetEnd = -1;
  let fallbackStart = -1;
  let fallbackEnd = -1;
  while ((m = tcRe.exec(xml)) !== null) {
    const tc = m[0];
    if (isInvestorNameCellText(visibleText(tc))) {
      targetStart = m.index;
      targetEnd = m.index + tc.length;
      break;
    }
    if (fallbackStart === -1 && (tc.includes("firstIfEntityUse") || tc.includes("ld_p_middle") || tc.includes("ld_p_last"))) {
      fallbackStart = m.index;
      fallbackEnd = m.index + tc.length;
    }
  }

  if (targetStart === -1 && fallbackStart !== -1) {
    targetStart = fallbackStart;
    targetEnd = fallbackEnd;
  }

  if (targetStart === -1) {
    return { xml, note: "WARN: INVESTOR NAME <w:tc> not found" };
  }

  const cellXml = xml.substring(targetStart, targetEnd);

  // Split the cell into its top-level paragraphs.
  const paraRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  const parts: string[] = [];
  let lastIdx = 0;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(cellXml)) !== null) {
    parts.push(cellXml.substring(lastIdx, pm.index));
    parts.push(pm[0]);
    lastIdx = pm.index + pm[0].length;
  }
  parts.push(cellXml.substring(lastIdx));

  const firstParaIdx = parts.findIndex((p) => p.startsWith("<w:p"));
  if (firstParaIdx !== -1) {
    const origPara = parts[firstParaIdx];
    const pPrMatch = origPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const rPrMatch = origPara.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? (rPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0] : "";
    const conditional =
      "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}";
    // Two-paragraph layout:
    //   P1: "INVESTOR NAME:" label
    //   P2: single text run containing {{#each lenders}}<cond>{{/each}}
    // The tag-parser's processEachBlocks detects that the each-block lives
    // inside a <w:t> run (no paragraphs in the expanded block) and inserts
    // </w:t><w:br/><w:t xml:space="preserve"> between iterations, giving
    // each lender its own visual line inside the same paragraph.
    parts[firstParaIdx] =
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">INVESTOR NAME:</w:t></w:r></w:p>` +
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">{{#each lenders}}${conditional}{{/each}}</w:t></w:r></w:p>`;
    for (let i = firstParaIdx + 1; i < parts.length; i++) {
      if (parts[i].startsWith("<w:p")) parts[i] = "";
    }
    const newCellXml = parts.join("");
    return {
      xml: xml.substring(0, targetStart) + newCellXml + xml.substring(targetEnd),
      note: "INVESTOR NAME cell rebuilt: label paragraph + single-paragraph {{#each lenders}}<br>-separated loop",
    };
  }

  // Find the paragraph that contains either of the legacy tag fragments
  // OR an already-substituted `{{#if isIndividual}}` block. The template
  // stores tags fragmented across runs (e.g. "{{ld" + "_p_firstIfEntityUse"
  // + "}}…"), so we look for the unfragmented substring "firstIfEntityUse"
  // which is guaranteed to be inside a single <w:t> element.
  const isTagPara = (p: string) =>
    p.startsWith("<w:p") &&
    (p.includes("firstIfEntityUse") ||
      p.includes("ld_p_middle") ||
      p.includes("ld_p_last") ||
      p.includes("{{#if isIndividual}}"));


  const condIdx = parts.findIndex(isTagPara);
  if (condIdx === -1) {
    const firstParaIdx = parts.findIndex((p) => p.startsWith("<w:p"));
    if (firstParaIdx === -1) {
      return { xml, note: "WARN: INVESTOR NAME cell found but no paragraph located" };
    }
    const origPara = parts[firstParaIdx];
    const pPrMatch = origPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const rPrMatch = origPara.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? (rPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0] : "";
    const conditional = "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}";
    parts[firstParaIdx] =
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">INVESTOR NAME: </w:t></w:r></w:p>` +
      EACH_OPEN_PARA +
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${conditional}</w:t></w:r></w:p>` +
      EACH_CLOSE_PARA;
    const newCellXml = parts.join("");
    return {
      xml: xml.substring(0, targetStart) + newCellXml + xml.substring(targetEnd),
      note: "INVESTOR header cell rebuilt as INVESTOR NAME + {{#each lenders}} loop",
    };
  }

  const origPara = parts[condIdx];

  // Extract the paragraph's <w:pPr> (formatting) so the rebuilt paragraphs
  // keep indentation/styling.
  const pPrMatch = origPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";

  // Extract the first run's <w:rPr> so the label/conditional runs keep
  // the same font/size.
  const rPrMatch = origPara.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch
    ? (rPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]
    : "";

  // Build:
  //   <w:p>{pPr}<w:r>{rPr}<w:t>INVESTOR NAME:</w:t></w:r></w:p>
  //   EACH_OPEN_PARA
  //   <w:p>{pPr}<w:r>{rPr}<w:t>{{#if isIndividual}}…{{else}}{{vesting}}{{/if}}</w:t></w:r></w:p>
  //   EACH_CLOSE_PARA
  const labelPara =
    `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">INVESTOR NAME: </w:t></w:r></w:p>`;
  const conditional =
    "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}";
  const condPara =
    `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${conditional}</w:t></w:r></w:p>`;

  parts[condIdx] = labelPara + EACH_OPEN_PARA + condPara + EACH_CLOSE_PARA;

  const newCellXml = parts.join("");
  const newXml =
    xml.substring(0, targetStart) + newCellXml + xml.substring(targetEnd);

  return {
    xml: newXml,
    note:
      "INVESTOR NAME cell rebuilt: label + {{#each lenders}}…{{/each}} around conditional",
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

  if (!force && xml.includes(V5_MARKER)) {
    return { xml, changed: false, notes: ["already-rewritten v4 (skipped)"] };
  }

  let out = xml;

  // (a) Undo v1 full-form wrapper paragraphs (idempotent — removes 0 if
  //     never wrapped).
  const stripped = stripV1Wrappers(out);
  out = stripped.xml;
  notes.push(`v1 wrapper paragraphs removed: ${stripped.removed}`);

  // Remove any prior v2/v3/v4 markers before re-injecting (force re-run safety).
  out = out.split(V2_MARKER).join("");
  out = out.split(V3_MARKER).join("");
  out = out.split(V4_MARKER).join("");
  out = out.split(V5_MARKER).join("");

  // (b) REVERT prior v2 global substitutions back to {{ld_p_*}} tags.
  //     v2 used to do this globally, which broke NAME OF ENTITY / TYPE OF
  //     ORGANIZATION / NAME OF PERSON COMPLETING cells (those cells lived
  //     OUTSIDE the {{#each lenders}} block, so the bare {{vesting}} /
  //     {{type}} / {{firstName}} tags resolved to nothing). The proper
  //     scoping (bare → lendersN.*) only happens inside the each block,
  //     which Pass C wraps explicitly around the INVESTOR NAME cell.
  //
  //     These reverts are SAFE because they happen BEFORE Pass C runs:
  //     Pass C writes its own paragraph containing the bare conditional
  //     INSIDE the {{#each lenders}} marker, so it doesn't get reverted.
  const nameRevert = replaceLiteral(
    out,
    "{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}",
    "{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}",
  );
  out = nameRevert.xml;
  notes.push(`name-tag reverts: ${nameRevert.hits}`);

  const vestRevert = replaceLiteral(
    out,
    "{{#if isIndividual}}-{{else}}{{vesting}}{{/if}}",
    "{{ld_p_vesting}}",
  );
  out = vestRevert.xml;
  notes.push(`vesting-tag reverts: ${vestRevert.hits}`);

  const typeRevert = replaceLiteral(out, "{{type}}", "{{ld_p_lenderType}}");
  out = typeRevert.xml;
  notes.push(`type-tag reverts: ${typeRevert.hits}`);

  // (c) Wrap the INVESTOR NAME cell's conditional paragraph.
  const wrapped = wrapInvestorNameCell(out);
  out = wrapped.xml;
  notes.push(wrapped.note);

  // (d) Inject the v4 marker so subsequent runs short-circuit (unless force).
  const bodyIdx = out.indexOf("<w:body>");
  if (bodyIdx !== -1) {
    const insertAt = bodyIdx + "<w:body>".length;
    out = out.substring(0, insertAt) + V4_MARKER + out.substring(insertAt);
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

  if (debug) {
    // Return raw XML around INVESTOR-related cells/snippets so we can inspect run/text fragmentation.
    const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    let m: RegExpExecArray | null;
    let cellXml = "";
    const candidateCells: Array<{ text: string; xml: string }> = [];
    while ((m = tcRe.exec(docXml)) !== null) {
      const t = (m[0].match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
        .map((s) => s.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
        .join("");
      if (t.toUpperCase().includes("INVESTOR")) {
        candidateCells.push({ text: t, xml: m[0].substring(0, 3000) });
      }
      if (isInvestorNameCellText(t)) { cellXml = m[0]; break; }
    }
    const visibleDocText = visibleText(docXml);
    const investorSnippets: string[] = [];
    const invRe = /investor/gi;
    let im: RegExpExecArray | null;
    while ((im = invRe.exec(visibleDocText)) !== null && investorSnippets.length < 20) {
      investorSnippets.push(visibleDocText.substring(Math.max(0, im.index - 80), im.index + 220));
    }
    const tagSnippets: string[] = [];
    for (const needle of ["firstName", "middle", "last", "isIndividual", "firstIfEntityUse", "ld_p_middle", "ld_p_last", "ld_p_first", "ld_p_vesting"]) {
      const idx = docXml.indexOf(needle);
      if (idx !== -1) tagSnippets.push(docXml.substring(Math.max(0, idx - 1200), idx + 1600));
    }
    const curlyTags = [...new Set([...docXml.matchAll(/\{\{[\s\S]{0,120}?\}\}/g)].map((x) => x[0]))].slice(0, 80);
    const chevronTags = [...new Set([...docXml.matchAll(/«[^»]{0,120}»/g)].map((x) => x[0]))].slice(0, 80);
    return {
      templateId,
      name: tpl.name,
      file_path: tpl.file_path,
      ok: true,
      debug: true,
      cellLength: cellXml.length,
      cellXml: cellXml.substring(0, 8000),
      candidateCells,
      investorSnippets,
      tagSnippets,
      curlyTags,
      chevronTags,
    };
  }

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
    let debug = false;
    try {
      const body = await req.json();
      if (body && Array.isArray(body.templateIds) && body.templateIds.length) {
        targetIds = body.templateIds;
      }
      if (body && body.force === true) force = true;
      if (body && body.debug === true) debug = true;
    } catch (_) {
      // no body — use defaults
    }

    const results = [];
    for (const id of targetIds) {
      results.push(await processTemplate(supabase, id, force, debug));
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

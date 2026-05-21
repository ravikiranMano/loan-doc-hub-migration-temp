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
//      precomputed displayName value (covers INVESTOR NAME without nested
//      conditionals that can corrupt Word XML after loop expansion).
//   3. Ensure NAME OF ENTITY stays bound to the primary lender.
//   4. Leave all non-INVESTOR NAME fields untouched.
//   5. In the <w:tc> table cell that contains "INVESTOR NAME", split the
//      label and the lender display-name loop into separate paragraphs. Each
//      lender renders as its own line inside that single cell.
//
// Idempotent: detects the v6 marker comment <!-- re870-rewrite:v6 -->
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
const V6_MARKER = "<!-- re870-rewrite:v6 -->";
const V7_MARKER = "<!-- re870-rewrite:v7 -->";
const V8_MARKER = "<!-- re870-rewrite:v8 -->";
const V9_MARKER = "<!-- re870-rewrite:v9 -->";

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
  if (/\bCO[-\s]?INVESTOR\b/.test(normalized)) return false;
  // Only the real INVESTOR NAME label cell — must contain "INVESTOR NAME"
  // (with or without colon). Do NOT match the centered "INVESTOR" header cell.
  return /\bINVESTOR NAME\b/.test(normalized);
}

function isInvestorHeaderOnlyCellText(text: string): boolean {
  const normalized = text.toUpperCase().replace(/\s+/g, " ").trim();
  return normalized === "INVESTOR";
}

function isNamePersonCompletingCellText(text: string): boolean {
  const normalized = text.toUpperCase().replace(/\s+/g, " ").trim();
  return /NAME OF PERSON COMPLETING/.test(normalized);
}

// ────────────────────────────────────────────────────────────────────────────
// Pass B — replace the INVESTOR NAME cell content with a safe displayName loop.
//
// The template stores the three legacy field tags as fragmented runs:
//   {{ld + _p_firstIfEntityUse + }}{{ + ld_p_middle + }}{{ + ld_p_last + }}
// so a literal find/replace cannot match. Instead we rewrite the whole
// paragraph: split it into a label paragraph ("INVESTOR NAME:") and a
// displayName paragraph that contains a single run holding
// {{#each lenders}}{{displayName}}{{/each}}. Avoid nested conditionals here:
// the RE870 failure mode was orphaned </w:t> tags caused by nested {{#if}}
// blocks being evaluated after the loop expanded.
// ────────────────────────────────────────────────────────────────────────────
const INVESTOR_LOOP_LITERAL = "{{#each lenders}}{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}{{/each}}";
const LEGACY_INVESTOR_LOOP_LITERAL = "{{#each lenders}}{{displayName}}{{/each}}";

interface CellHit {
  start: number;
  end: number;
  xml: string;
  visText: string;
  hasLoop: boolean;
}

function findCells(xml: string, predicate: (visText: string, tc: string) => boolean): CellHit[] {
  const tcRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  const out: CellHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = tcRe.exec(xml)) !== null) {
    const tc = m[0];
    const v = visibleText(tc);
    if (predicate(v, tc)) {
      out.push({
        start: m.index,
        end: m.index + tc.length,
        xml: tc,
        visText: v,
        hasLoop: tc.includes(INVESTOR_LOOP_LITERAL) || tc.includes(LEGACY_INVESTOR_LOOP_LITERAL),
      });
    }
  }
  return out;
}

function normalizeInvestorParagraphPr(pPr: string): string {
  const base = pPr || "<w:pPr></w:pPr>";
  const withoutCenter = /<w:jc\b[^>]*\/>/.test(base)
    ? base.replace(/<w:jc\b[^>]*\/>/g, '<w:jc w:val="left"/>')
    : base.replace("</w:pPr>", '<w:jc w:val="left"/></w:pPr>');
  return withoutCenter;
}

function normalizeInvestorNameCellGeometry(cellXml: string, preferredWidth?: string): string {
  let out = cellXml
    // The broken live template has the INVESTOR NAME cell spanning into the
    // adjacent centered INVESTOR column. Removing the span makes the value
    // render from the true left cell instead of the visual center area.
    .replace(/<w:gridSpan\b[^>]*\/>/g, "");
  if (preferredWidth) {
    out = out.replace(/<w:tcW\b[^>]*w:w="[^"]*"([^>]*)\/>/, (m) =>
      /w:type=/.test(m)
        ? m.replace(/w:w="[^"]*"/, `w:w="${preferredWidth}"`)
        : `<w:tcW w:w="${preferredWidth}" w:type="dxa"/>`,
    );
  }
  return out;
}

function firstGridColumnWidthForCell(xml: string, cellStart: number): string | undefined {
  const tableStart = xml.lastIndexOf("<w:tbl", cellStart);
  if (tableStart === -1) return undefined;
  const tableEnd = xml.indexOf("</w:tbl>", cellStart);
  if (tableEnd === -1) return undefined;
  const tableHead = xml.substring(tableStart, Math.min(tableEnd, cellStart));
  const gridMatch = tableHead.match(/<w:tblGrid>[\s\S]*?<w:gridCol\b[^>]*w:w="([0-9]+)"[^>]*\/>/);
  return gridMatch?.[1];
}

// Remove paragraphs from a <w:tc> whose only visible text matches `predicate`.
function stripParagraphsByText(cellXml: string, predicate: (txt: string) => boolean): string {
  const paraRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  return cellXml.replace(paraRe, (p) => {
    const v = visibleText(p).trim();
    return predicate(v) ? "" : p;
  });
}

// Pass D — clean up a misplaced loop that v6 injected into the wrong cell
// (the centered "INVESTOR" header). Returns the cleaned xml + a note.
function cleanMisplacedInvestorLoop(xml: string, keepCellStart: number): { xml: string; note: string } {
  const cells = findCells(xml, (_v, tc) => tc.includes(INVESTOR_LOOP_LITERAL) || tc.includes(LEGACY_INVESTOR_LOOP_LITERAL));
  if (cells.length === 0) return { xml, note: "no misplaced loop found" };

  // Process from end → start so substring offsets stay valid.
  let out = xml;
  let cleaned = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (c.start === keepCellStart) continue;

    // Strip our two injected paragraphs (label + loop). Keep anything else.
    let cleanedCell = stripParagraphsByText(c.xml, (t) =>
      t === INVESTOR_LOOP_LITERAL ||
      t === LEGACY_INVESTOR_LOOP_LITERAL ||
      t === "INVESTOR NAME:" ||
      t === "INVESTOR NAME: " ||
      t === "INVESTOR NAME:".trim(),
    );

    // If the cell is now empty of paragraphs, restore the "INVESTOR" header.
    if (!/\bINVESTOR\b/.test(visibleText(cleanedCell))) {
      // Pull the cell open tag.
      const openMatch = cleanedCell.match(/^<w:tc\b[^>]*>/);
      const closeIdx = cleanedCell.lastIndexOf("</w:tc>");
      if (openMatch && closeIdx !== -1) {
        const open = openMatch[0];
        const between = cleanedCell.substring(open.length, closeIdx);
        // Try to reuse a tcPr if present.
        const tcPrMatch = between.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
        const tcPr = tcPrMatch ? tcPrMatch[0] : "";
        cleanedCell = `${open}${tcPr}<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">INVESTOR</w:t></w:r></w:p></w:tc>`;
      }
    }

    out = out.substring(0, c.start) + cleanedCell + out.substring(c.end);
    cleaned++;
  }
  return { xml: out, note: `misplaced-loop cells cleaned: ${cleaned}` };
}

// ────────────────────────────────────────────────────────────────────────────
// Pass B — replace the INVESTOR NAME cell content with a safe displayName loop.
// ────────────────────────────────────────────────────────────────────────────
function wrapInvestorNameCell(xml: string): { xml: string; note: string; targetStart: number } {
  // Collect every <w:tc> whose visible text matches the real INVESTOR NAME
  // label cell (requires "INVESTOR NAME", excludes "CO-INVESTOR").
  const candidates = findCells(xml, (v) => isInvestorNameCellText(v));

  // Prefer a cell that does NOT already contain our loop literal (the
  // un-touched real label cell). Fall back to the first one otherwise.
  let target: CellHit | undefined =
    candidates.find((c) => !c.hasLoop) || candidates[0];

  // Last-resort fallback: legacy tag fragments live in a non-INVESTOR-NAME cell.
  if (!target) {
    const legacy = findCells(xml, (_v, tc) =>
      tc.includes("firstIfEntityUse") || tc.includes("ld_p_middle") || tc.includes("ld_p_last"),
    );
    target = legacy[0];
  }

  if (!target) {
    return { xml, note: "WARN: INVESTOR NAME <w:tc> not found", targetStart: -1 };
  }

  const cellXml = target.xml;

  // Split the cell into top-level paragraphs.
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
  if (firstParaIdx === -1) {
    return { xml, note: "WARN: INVESTOR NAME cell found but no paragraph located", targetStart: target.start };
  }

  const origPara = parts[firstParaIdx];
  const pPrMatch = origPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = normalizeInvestorParagraphPr(pPrMatch ? pPrMatch[0] : "");
  const rPrMatch = origPara.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? (rPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0] : "";
  const investorNameLoop = INVESTOR_LOOP_LITERAL;

  parts[firstParaIdx] =
    `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">INVESTOR NAME:</w:t></w:r></w:p>` +
    `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${investorNameLoop}</w:t></w:r></w:p>`;
  for (let i = firstParaIdx + 1; i < parts.length; i++) {
    if (parts[i].startsWith("<w:p")) parts[i] = "";
  }

  const preferredWidth = firstGridColumnWidthForCell(xml, target.start);
  const newCellXml = normalizeInvestorNameCellGeometry(parts.join(""), preferredWidth);
  return {
    xml: xml.substring(0, target.start) + newCellXml + xml.substring(target.end),
    note: `INVESTOR NAME cell rebuilt (start=${target.start}, hadLoop=${target.hasLoop}, width=${preferredWidth || "kept"})`,
    targetStart: target.start,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pass E — fix NAME OF PERSON COMPLETING THIS QUESTIONNAIRE cell.
// Replace the conditional value run with the precomputed {{ld_p_displayName}}
// alias so we never get a "Lender" prefix on Joint/entity lenders.
// ────────────────────────────────────────────────────────────────────────────
function fixNamePersonCompletingCell(xml: string): { xml: string; note: string } {
  const cells = findCells(xml, (v) => isNamePersonCompletingCellText(v));
  if (cells.length === 0) return { xml, note: "NAME OF PERSON COMPLETING cell not found" };

  let out = xml;
  let touched = 0;
  // Process from end → start so offsets stay valid.
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    let cellXml = c.xml;

    // Split into paragraphs.
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

    // Find the label paragraph (contains "NAME OF PERSON COMPLETING") and
    // capture its pPr/rPr for re-use on the value paragraph.
    let labelIdx = -1;
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j];
      if (p.startsWith("<w:p") && /NAME OF PERSON COMPLETING/.test(visibleText(p))) {
        labelIdx = j;
        break;
      }
    }
    if (labelIdx === -1) continue;

    const labelPara = parts[labelIdx];
    const pPrMatch = labelPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const rPrMatch = labelPara.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? (rPrMatch[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0] : "";

    // Rewrite the label paragraph: keep label text only, no inline value/tags.
    parts[labelIdx] = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">NAME OF PERSON COMPLETING THIS QUESTIONNAIRE</w:t></w:r></w:p>` +
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">{{ld_p_displayName}}</w:t></w:r></w:p>`;

    // Strip any subsequent paragraphs that contain stale value tags.
    for (let j = labelIdx + 1; j < parts.length; j++) {
      const p = parts[j];
      if (!p.startsWith("<w:p")) continue;
      if (
        /\{\{#if\s+isIndividual/.test(p) ||
        /\{\{firstName\}\}/.test(p) ||
        /\{\{middle\}\}/.test(p) ||
        /\{\{last\}\}/.test(p) ||
        /\{\{vesting\}\}/.test(p) ||
        /\{\{ld_p_firstIfEntityUse\}\}/.test(p) ||
        /\{\{ld_p_middle\}\}/.test(p) ||
        /\{\{ld_p_last\}\}/.test(p) ||
        /\{\{ld_p_displayName\}\}/.test(p)
      ) {
        parts[j] = "";
      }
    }

    cellXml = parts.join("");
    out = out.substring(0, c.start) + cellXml + out.substring(c.end);
    touched++;
  }
  return { xml: out, note: `NAME OF PERSON COMPLETING cells rebuilt: ${touched}` };
}


// ────────────────────────────────────────────────────────────────────────────
// Top-level rewrite
// ────────────────────────────────────────────────────────────────────────────
function rewriteDocumentXml(
  xml: string,
  force: boolean,
): { xml: string; changed: boolean; notes: string[] } {
  const notes: string[] = [];

  if (!force && xml.includes(V9_MARKER)) {
    return { xml, changed: false, notes: ["already-rewritten v8 (skipped)"] };
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
  out = out.split(V6_MARKER).join("");
  out = out.split(V7_MARKER).join("");
  out = out.split(V8_MARKER).join("");
  out = out.split(V9_MARKER).join("");

  // (b) REVERT prior v2 global substitutions back to {{ld_p_*}} tags.
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

  // (c) Wrap the real INVESTOR NAME cell with label + displayName loop.
  const wrapped = wrapInvestorNameCell(out);
  out = wrapped.xml;
  notes.push(wrapped.note);

  // (d) Clean up any OTHER cell that v6 wrongly stuffed the loop into
  //     (e.g. the centered "INVESTOR" header cell). Restore it to header text.
  const cleaned = cleanMisplacedInvestorLoop(out, wrapped.targetStart);
  out = cleaned.xml;
  notes.push(cleaned.note);

  // (e) Rewrite NAME OF PERSON COMPLETING THIS QUESTIONNAIRE → {{ld_p_displayName}}
  const personFix = fixNamePersonCompletingCell(out);
  out = personFix.xml;
  notes.push(personFix.note);

  // (f) Inject the v8 marker so subsequent runs short-circuit (unless force).
  const bodyIdx = out.indexOf("<w:body>");
  if (bodyIdx !== -1) {
    const insertAt = bodyIdx + "<w:body>".length;
    out = out.substring(0, insertAt) + V8_MARKER + out.substring(insertAt);
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

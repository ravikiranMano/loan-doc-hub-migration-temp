// One-shot admin function: rewrites the RE851D template's PROPERTY TYPE
// tables so all 5 property sections render identically and match the
// expected layout (Image 2 in the spec):
//
//   LEFT cell (3 paragraphs):
//     {{property_type_sfr_owner_N}}     SINGLE-FAMILY RESIDENCE (owner occupied)
//     {{property_type_sfr_non_owner_N}} SINGLE-FAMILY RESIDENCE (not owner occupied)
//     {{property_type_sfr_zoned_N}}     SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)
//
//   RIGHT cell (4 paragraphs — OTHER on its own row):
//     {{property_type_commercial_N}}    COMMERCIAL & INCOME-PRODUCING
//     {{property_type_land_zoned_N}}    LAND (zoned commercial/residential)
//     {{property_type_land_income_N}}   LAND (income-producing)
//     {{property_type_other_N}}         OTHER: {{property_type_other_text_N}}
//
// Each table is rebuilt with:
//   - <w:tblLayout w:type="fixed"/> (FIXED, never auto)
//   - <w:tblW w:w="5000" w:type="pct"/> (100% page width)
//   - Two equal-width columns (50% / 50%) preserving the original DXA total
//   - Left-aligned paragraphs, no tabs, no <w:br/>
//
// Also strips a redundant hardcoded `%` after {{ln_p_loanToValueRatio_N}}
// (the resolved percentage value already includes the `%` symbol, causing
// `10.64%%` in current output).
//
// Idempotent. Safe to re-run.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778746922135_RE851D-V12.1.docx";

// ─────────────────────────────────────────────────────────────────────────────
// Tag-stripped index helpers (also used by sibling rewriters)
// ─────────────────────────────────────────────────────────────────────────────

function buildStrippedIndex(xml: string): { text: string; map: number[] } {
  const text: string[] = [];
  const map: number[] = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const ch = xml[i];
    if (ch === "<") {
      const close = xml.indexOf(">", i);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    text.push(ch);
    map.push(i);
    i++;
  }
  return { text: text.join(""), map };
}

// ─────────────────────────────────────────────────────────────────────────────
// Table-rebuild
// ─────────────────────────────────────────────────────────────────────────────

/** Sum DXA values found in a <w:tblGrid>...</w:tblGrid> block. */
function sumGridDxa(tblXml: string): number {
  const gridMatch = tblXml.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
  if (!gridMatch) return 0;
  let total = 0;
  const re = /<w:gridCol\b[^>]*\bw:w="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gridMatch[0])) !== null) {
    total += parseInt(m[1], 10) || 0;
  }
  return total;
}

/** Extract `<w:tblBorders>...</w:tblBorders>` from a table, if present. */
function extractTblBorders(tblXml: string): string {
  const m = tblXml.match(/<w:tblBorders\b[\s\S]*?<\/w:tblBorders>/);
  return m ? m[0] : "";
}

/** Extract `<w:tblCellMar>...</w:tblCellMar>` from a table, if present. */
function extractTblCellMar(tblXml: string): string {
  const m = tblXml.match(/<w:tblCellMar\b[\s\S]*?<\/w:tblCellMar>/);
  return m ? m[0] : "";
}

/**
 * Detect the property index N by reading any property_type_*_<digit>
 * placeholder inside the table. Returns "N" (literal) when none is present
 * (blank template instance).
 */
function detectPropertyIndex(tblStripped: string): string {
  const m = tblStripped.match(/property_type_(?:sfr_owner|sfr_non_owner|sfr_zoned|commercial|land_zoned|land_income|other)_(\d+|N)\b/);
  if (m) return m[1];
  return "N";
}

function buildParagraph(tag: string, label: string): string {
  // tag = full placeholder like {{property_type_sfr_owner_1}}
  // label = visible label text (already & encoded if needed)
  // Single left-aligned paragraph, glyph from merge tag + single space + label.
  return (
    `<w:p>` +
    `<w:pPr><w:jc w:val="left"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${tag} ${label}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildOtherParagraph(idx: string): string {
  return (
    `<w:p>` +
    `<w:pPr><w:jc w:val="left"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">{{property_type_other_${idx}}} OTHER: {{property_type_other_text_${idx}}}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildRebuiltTable(originalTbl: string): string {
  const stripped = originalTbl.replace(/<[^>]+>/g, "");
  const idx = detectPropertyIndex(stripped);

  const gridTotal = sumGridDxa(originalTbl) || 9360;
  const half = Math.floor(gridTotal / 2);
  const halfR = gridTotal - half;

  const borders = extractTblBorders(originalTbl);
  const cellMar = extractTblCellMar(originalTbl);

  const tblPr =
    `<w:tblPr>` +
      `<w:tblW w:w="5000" w:type="pct"/>` +
      `<w:tblLayout w:type="fixed"/>` +
      borders +
      cellMar +
    `</w:tblPr>`;

  const tblGrid =
    `<w:tblGrid>` +
      `<w:gridCol w:w="${half}"/>` +
      `<w:gridCol w:w="${halfR}"/>` +
    `</w:tblGrid>`;

  const leftCellContent =
    buildParagraph(
      `{{property_type_sfr_owner_${idx}}}`,
      `SINGLE-FAMILY RESIDENCE (owner occupied)`,
    ) +
    buildParagraph(
      `{{property_type_sfr_non_owner_${idx}}}`,
      `SINGLE-FAMILY RESIDENCE (not owner occupied)`,
    ) +
    buildParagraph(
      `{{property_type_sfr_zoned_${idx}}}`,
      `SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)`,
    );

  const rightCellContent =
    buildParagraph(
      `{{property_type_commercial_${idx}}}`,
      `COMMERCIAL &amp; INCOME-PRODUCING`,
    ) +
    buildParagraph(
      `{{property_type_land_zoned_${idx}}}`,
      `LAND (zoned commercial/residential)`,
    ) +
    buildParagraph(
      `{{property_type_land_income_${idx}}}`,
      `LAND (income-producing)`,
    ) +
    buildOtherParagraph(idx);

  const leftCell =
    `<w:tc>` +
      `<w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>` +
      leftCellContent +
    `</w:tc>`;

  const rightCell =
    `<w:tc>` +
      `<w:tcPr><w:tcW w:w="${halfR}" w:type="dxa"/></w:tcPr>` +
      rightCellContent +
    `</w:tc>`;

  const row = `<w:tr>${leftCell}${rightCell}</w:tr>`;

  return `<w:tbl>${tblPr}${tblGrid}${row}</w:tbl>`;
}

/** Find every <w:tbl>...</w:tbl> block that is a PROPERTY TYPE table. */
function findPropertyTypeTables(
  xml: string,
): Array<{ start: number; end: number; original: string }> {
  const out: Array<{ start: number; end: number; original: string }> = [];
  const re = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tbl = m[0];
    const stripped = tbl.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (
      /SINGLE-FAMILY RESIDENCE \(owner/i.test(stripped) &&
      /COMMERCIAL/i.test(stripped) &&
      /LAND/i.test(stripped)
    ) {
      out.push({ start: m.index, end: m.index + tbl.length, original: tbl });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// LTV double-% strip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find runs of `{{ln_p_loanToValueRatio_<N>}}%` (where the trailing `%` is a
 * literal character in the visible text — possibly entity-encoded or split
 * across <w:t> runs) and remove the trailing `%`.
 *
 * Uses the tag-stripped index to locate the matches in original XML
 * coordinates, then walks forward to find and remove the first literal `%`
 * that appears AFTER the placeholder's closing `}}` in the stripped text.
 *
 * Returns: { newXml, stripped } where `stripped` is the count of `%` removed.
 */
function stripLtvDoublePercent(xml: string): { newXml: string; stripped: number } {
  const { text, map } = buildStrippedIndex(xml);
  // Match placeholder + any whitespace + literal `%`
  const re = /\{\{\s*ln_p_loanToValueRatio_(?:\d+|N)\s*\}\}\s*%/g;
  const removeAt: number[] = []; // original XML offsets of `%` chars to drop

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Position of `%` in stripped text = match end - 1
    const pctStripped = m.index + m[0].length - 1;
    if (pctStripped >= map.length) continue;
    const pctXmlOffset = map[pctStripped];
    if (xml[pctXmlOffset] !== "%") continue; // sanity
    removeAt.push(pctXmlOffset);
  }

  if (removeAt.length === 0) return { newXml: xml, stripped: 0 };

  // Remove characters in descending order so offsets stay valid.
  removeAt.sort((a, b) => b - a);
  let out = xml;
  for (const off of removeAt) {
    out = out.slice(0, off) + out.slice(off + 1);
  }
  return { newXml: out, stripped: removeAt.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply rewrites
// ─────────────────────────────────────────────────────────────────────────────

function rewriteDocumentXml(xml: string): {
  newXml: string;
  rewrittenTables: number;
  ltvPercentsStripped: number;
} {
  // 1. Find and rebuild PROPERTY TYPE tables (process in reverse order so
  //    offsets remain valid).
  const tables = findPropertyTypeTables(xml);
  let working = xml;
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    const rebuilt = buildRebuiltTable(t.original);
    working = working.slice(0, t.start) + rebuilt + working.slice(t.end);
  }

  // 2. Strip LTV double-% (run after table rewrite — the LTV cell is OUTSIDE
  //    the PROPERTY TYPE tables, so it survives the rebuild untouched).
  const { newXml, stripped } = stripLtvDoublePercent(working);

  return {
    newXml,
    rewrittenTables: tables.length,
    ltvPercentsStripped: stripped,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge function entry point
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let templatePath = DEFAULT_TEMPLATE_PATH;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.templatePath === "string" && body.templatePath.trim()) {
        templatePath = body.templatePath.trim();
      }
    } catch (_) { /* default */ }

    // 1) Download template
    const dl = await supabase.storage.from("templates").download(templatePath);
    if (dl.error || !dl.data) {
      return new Response(
        JSON.stringify({
          error: `download failed: ${dl.error?.message || "no data"}`,
          templatePath,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const inputBytes = new Uint8Array(await dl.data.arrayBuffer());

    // 2) Unzip
    const decompressed = fflate.unzipSync(inputBytes);
    const docXmlBytes = decompressed["word/document.xml"];
    if (!docXmlBytes) {
      return new Response(
        JSON.stringify({ error: "word/document.xml missing from template" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    const originalXml = decoder.decode(docXmlBytes);

    // 3) Compute rewrites
    const { newXml, rewrittenTables, ltvPercentsStripped } =
      rewriteDocumentXml(originalXml);

    if (newXml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          rewrittenTables: 0,
          ltvPercentsStripped: 0,
          message: "Template already clean — no changes written.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    decompressed["word/document.xml"] = encoder.encode(newXml);

    // 4) Repack
    const repacked = fflate.zipSync(decompressed as fflate.Zippable);

    // 5) Upload back to same path
    const up = await supabase.storage
      .from("templates")
      .upload(templatePath, repacked, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (up.error) {
      return new Response(
        JSON.stringify({ error: `upload failed: ${up.error.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        templatePath,
        rewrittenTables,
        ltvPercentsStripped,
        originalSize: inputBytes.length,
        newSize: repacked.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

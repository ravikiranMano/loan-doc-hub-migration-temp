// One-shot admin function: rewrites the RE851D template stored in the
// `templates` storage bucket so that Section 2 PROPERTY TYPE for each of the
// 5 per-property blocks renders as a fixed-layout 2-column borderless table.
//
// The placeholders themselves (`{{property_type_*_N}}`) are NOT renamed —
// only the surrounding Word layout is replaced so the long placeholder text
// no longer collapses the column widths.
//
// Idempotent. Safe to re-run.
//
// POST body: { templatePath?: string, debug?: boolean, force?: boolean }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778746922135_RE851D-V12.1.docx";

// Bumped V1 → V2 so previously-rewritten templates get re-normalized with
// the new font / spacing / keep-with-next directives.
const SENTINEL_CURRENT = "PT_LAYOUT_V2";
const SENTINEL_LEGACY = ["PT_LAYOUT_V1"];

const FIELDS = [
  "property_type_sfr_owner",
  "property_type_sfr_non_owner",
  "property_type_sfr_zoned",
  "property_type_commercial",
  "property_type_land_zoned",
  "property_type_land_income",
  "property_type_other",
  "property_type_other_text",
] as const;

/** Build a tag-stripped view of XML plus a per-char map back to XML offsets. */
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

/**
 * Recursively walk every <w:p> and <w:tbl> in the document body (including
 * those nested inside table cells and SDT content controls). Returns a flat
 * list of element offset ranges. Used to find the innermost block (paragraph
 * or table) that contains a placeholder, so we replace exactly that block —
 * not a parent table.
 */
function findAllBlocks(
  xml: string,
): Array<{ start: number; end: number; tag: "w:p" | "w:tbl" }> {
  const blocks: Array<{ start: number; end: number; tag: "w:p" | "w:tbl" }> = [];

  const walk = (tag: "w:p" | "w:tbl"): void => {
    const openRe = new RegExp(`<${tag}\\b[^>]*?(\\/?>)`, "g");
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(xml)) !== null) {
      const selfClosing = m[1] === "/>";
      if (selfClosing) {
        blocks.push({ start: m.index, end: m.index + m[0].length, tag });
        continue;
      }
      // Find matching close at depth 0 by scanning character-by-character
      // through nested opens/closes of THIS tag only.
      const openMarker = `<${tag}`;
      const closeMarker = `</${tag}>`;
      let depth = 1;
      let cursor = m.index + m[0].length;
      while (cursor < xml.length && depth > 0) {
        const nextOpen = xml.indexOf(openMarker, cursor);
        const nextClose = xml.indexOf(closeMarker, cursor);
        if (nextClose < 0) break;
        if (nextOpen >= 0 && nextOpen < nextClose) {
          // Confirm this is a real opener for THIS tag (not e.g. <w:pPr>).
          const after = xml.charAt(nextOpen + openMarker.length);
          if (after === " " || after === ">" || after === "/") {
            depth++;
            cursor = nextOpen + openMarker.length;
            continue;
          }
          cursor = nextOpen + openMarker.length;
          continue;
        }
        depth--;
        cursor = nextClose + closeMarker.length;
        if (depth === 0) {
          blocks.push({ start: m.index, end: cursor, tag });
        }
      }
    }
  };

  walk("w:p");
  walk("w:tbl");
  return blocks;
}

/** Build the canonical PROPERTY TYPE table XML for property index N. */
function buildCanonicalTable(n: number): string {
  // Template uses literal `_N` (replaced at runtime per property).
  const tag = (k: (typeof FIELDS)[number]) => `{{${k}_N}}`;

  // Arial 10pt (sz=20) — matches the surrounding PROPERTY OWNER / ADDRESS
  // rows in the original template. Roomier paragraph spacing so each row
  // reads clearly. `keepLines` keeps every paragraph as a single visual line.
  const RPR = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
  const PPR_BASE =
    `<w:spacing w:before="100" w:after="100" w:line="276" w:lineRule="auto"/><w:keepLines/>`;

  const para = (
    parts: Array<{ text: string; preserve?: boolean }>,
    opts?: { keepNext?: boolean },
  ): string => {
    const runs = parts
      .map(
        (p) =>
          `<w:r>${RPR}<w:t${
            p.preserve ? ' xml:space="preserve"' : ""
          }>${p.text}</w:t></w:r>`,
      )
      .join("");
    const keep = opts?.keepNext ? `<w:keepNext/>` : "";
    return `<w:p><w:pPr>${PPR_BASE}${keep}${RPR}</w:pPr>${runs}</w:p>`;
  };

  const leftParas = [
    para(
      [
        { text: tag("property_type_sfr_owner") },
        { text: " SINGLE-FAMILY RESIDENCE (owner occupied)", preserve: true },
      ],
      { keepNext: true },
    ),
    para(
      [
        { text: tag("property_type_sfr_non_owner") },
        {
          text: " SINGLE-FAMILY RESIDENCE (not owner occupied)",
          preserve: true,
        },
      ],
      { keepNext: true },
    ),
    para([
      { text: tag("property_type_sfr_zoned") },
      {
        text: " SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)",
        preserve: true,
      },
    ]),
  ].join("");

  const rightParas = [
    para(
      [
        { text: tag("property_type_commercial") },
        { text: " COMMERCIAL & INCOME-PRODUCING", preserve: true },
      ],
      { keepNext: true },
    ),
    para(
      [
        { text: tag("property_type_land_zoned") },
        { text: " LAND (zoned commercial/residential)", preserve: true },
      ],
      { keepNext: true },
    ),
    para(
      [
        { text: tag("property_type_land_income") },
        { text: " LAND (income-producing)", preserve: true },
      ],
      // keepNext on land_income so it can never visually pair with OTHER —
      // the next paragraph starts on its own line.
      { keepNext: true },
    ),
    para([
      { text: tag("property_type_other") },
      { text: " OTHER: ", preserve: true },
      { text: tag("property_type_other_text") },
    ]),
  ].join("");

  // Hidden sentinel marker so re-runs are no-ops.
  const sentinelPara =
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:vanish/><w:sz w:val="2"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:vanish/><w:sz w:val="2"/></w:rPr><w:t>${SENTINEL_CURRENT}_${n}</w:t></w:r></w:p>`;

  const nilBorders = `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>`;
  const tcBorders = `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;

  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>${nilBorders}<w:tblLook w:val="04A0"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
    `<w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/>${tcBorders}<w:vAlign w:val="top"/></w:tcPr>${sentinelPara}${leftParas}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/>${tcBorders}<w:vAlign w:val="top"/></w:tcPr>${rightParas}</w:tc>` +
    `</w:tr>` +
    `</w:tbl>`
  );
}

interface RewritePlan {
  start: number;
  end: number;
  replacement: string;
  n: number;
}

function planRewrites(
  xml: string,
  force: boolean,
): {
  plans: RewritePlan[];
  skipped: number[];
  notFound: number[];
  blockDebug: Array<{ n: number; start: number; end: number; sample: string }>;
} {
  const { text, map } = buildStrippedIndex(xml);
  const blocks = findAllBlocks(xml);

  // Sort blocks by start asc; for offset lookup prefer the SMALLEST enclosing
  // block (deepest nesting).
  const sortedBlocks = blocks
    .slice()
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));

  const blockForOffset = (off: number): number => {
    // Return index in `blocks` of the smallest block containing off.
    for (const b of sortedBlocks) {
      if (off >= b.start && off < b.end) {
        return blocks.indexOf(b);
      }
    }
    return -1;
  };

  const plans: RewritePlan[] = [];
  const skipped: number[] = [];
  const notFound: number[] = [];
  const blockDebug: Array<{ n: number; start: number; end: number; sample: string }> = [];

  const anchor = `{{${FIELDS[0]}_N}}`;
  const anchorPositions: number[] = [];
  let scanFrom = 0;
  while (true) {
    const idx = text.indexOf(anchor, scanFrom);
    if (idx < 0) break;
    anchorPositions.push(idx);
    scanFrom = idx + anchor.length;
  }

  for (let occ = 0; occ < anchorPositions.length; occ++) {
    const startTxt = anchorPositions[occ];
    const limitTxt =
      occ + 1 < anchorPositions.length ? anchorPositions[occ + 1] : text.length;

    const offsetsInRange: number[] = [];
    let allFound = true;
    for (const f of FIELDS) {
      const needle = `{{${f}_N}}`;
      const idx = text.indexOf(needle, startTxt);
      if (idx < 0 || idx >= limitTxt) {
        allFound = false;
        break;
      }
      offsetsInRange.push(map[idx]);
    }
    if (!allFound) {
      notFound.push(occ + 1);
      continue;
    }

    const blockIdxs = offsetsInRange.map(blockForOffset);
    if (blockIdxs.some((i) => i < 0)) {
      notFound.push(occ + 1);
      continue;
    }

    // Compute the span [minStart, maxEnd] covering all 8 placeholder blocks.
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const bi of blockIdxs) {
      const b = blocks[bi];
      if (b.start < minStart) minStart = b.start;
      if (b.end > maxEnd) maxEnd = b.end;
    }

    // Idempotency: skip if already normalized with current sentinel.
    const span = xml.slice(minStart, maxEnd);
    if (!force && span.includes(SENTINEL_CURRENT)) {
      skipped.push(occ + 1);
      continue;
    }

    blockDebug.push({
      n: occ + 1,
      start: minStart,
      end: maxEnd,
      sample: span.slice(0, 400),
    });

    plans.push({
      start: minStart,
      end: maxEnd,
      replacement: buildCanonicalTable(occ + 1),
      n: occ + 1,
    });
  }

  // Sort + ensure non-overlapping (drop later plans that overlap earlier).
  plans.sort((a, b) => a.start - b.start);
  const cleaned: RewritePlan[] = [];
  let last = -1;
  for (const p of plans) {
    if (p.start < last) continue;
    cleaned.push(p);
    last = p.end;
  }

  return { plans: cleaned, skipped, notFound, blockDebug };
}

function applyPlans(xml: string, plans: RewritePlan[]): string {
  if (plans.length === 0) return xml;
  const out: string[] = [];
  let cursor = 0;
  for (const p of plans) {
    out.push(xml.slice(cursor, p.start));
    out.push(p.replacement);
    cursor = p.end;
  }
  out.push(xml.slice(cursor));
  return out.join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let templatePath = DEFAULT_TEMPLATE_PATH;
    let debug = false;
    let force = false;
    let dumpBlocks = false;
    try {
      const body = await req.json().catch(() => ({}));
      if (
        body &&
        typeof body.templatePath === "string" &&
        body.templatePath.trim()
      ) {
        templatePath = body.templatePath.trim();
      }
      if (body && body.debug) debug = true;
      if (body && body.force) force = true;
      if (body && body.dumpBlocks) dumpBlocks = true;
    } catch (_) { /* default */ }

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

    if (debug || dumpBlocks) {
      const { plans, skipped, notFound, blockDebug } = planRewrites(
        originalXml,
        true, // force=true so we get the spans even if already normalized
      );
      const sentinelHits = (
        originalXml.match(new RegExp(SENTINEL_CURRENT, "g")) || []
      ).length;
      const legacyHits = SENTINEL_LEGACY.map((s) => ({
        s,
        n: (originalXml.match(new RegExp(s, "g")) || []).length,
      }));
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          plannedRewrites: plans.length,
          skipped,
          notFound,
          sentinelHits,
          legacyHits,
          blocks: blockDebug,
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { plans, skipped, notFound } = planRewrites(originalXml, force);

    if (plans.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          propertiesRewritten: 0,
          propertiesSkipped: skipped,
          propertiesNotFound: notFound,
          message:
            skipped.length > 0
              ? "Template already normalized — no changes written."
              : "No matching PROPERTY TYPE placeholders found.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newXml = applyPlans(originalXml, plans);
    decompressed["word/document.xml"] = encoder.encode(newXml);
    const repacked = fflate.zipSync(decompressed as fflate.Zippable);

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
        propertiesRewritten: plans.map((p) => p.n),
        propertiesSkipped: skipped,
        propertiesNotFound: notFound,
        originalSize: inputBytes.length,
        newSize: repacked.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

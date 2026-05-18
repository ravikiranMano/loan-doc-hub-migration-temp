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
// POST body: { templatePath?: string }
//   templatePath defaults to "1778746922135_RE851D-V12.1.docx".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778746922135_RE851D-V12.1.docx";

// Marker we inject inside the new canonical table so we can detect on a
// later run that this property is already normalized.
const SENTINEL = "PT_LAYOUT_V1";

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
 * For a given XML char offset that lies inside a top-level <w:p> or <w:tbl>
 * element (i.e., a direct child of <w:body>), return the [start, end] offsets
 * of that enclosing top-level block. We do this by scanning forward from
 * `<w:body>` and tracking a depth-1 element boundary.
 */
function findTopLevelBlocks(
  xml: string,
): Array<{ start: number; end: number; tag: "w:p" | "w:tbl" | "w:sectPr" }> {
  const bodyOpen = xml.search(/<w:body\b[^>]*>/);
  const bodyClose = xml.lastIndexOf("</w:body>");
  if (bodyOpen < 0 || bodyClose < 0) return [];
  const bodyOpenEnd = xml.indexOf(">", bodyOpen) + 1;

  const out: Array<{ start: number; end: number; tag: "w:p" | "w:tbl" | "w:sectPr" }> = [];
  const re = /<(w:p|w:tbl|w:sectPr)\b[^>]*?(\/>|>)/g;
  re.lastIndex = bodyOpenEnd;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= bodyClose) break;
    const tag = m[1] as "w:p" | "w:tbl" | "w:sectPr";
    const selfClosing = m[2] === "/>";
    if (selfClosing) {
      out.push({ start: m.index, end: m.index + m[0].length, tag });
      continue;
    }
    // Find matching close tag at depth 0 (for THIS top-level element).
    const closeTag = `</${tag}>`;
    const openRe = new RegExp(`<${tag}\\b[^>]*?>`, "g");
    const closeRe = new RegExp(`</${tag}>`, "g");
    openRe.lastIndex = m.index + m[0].length;
    closeRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let cursor = m.index + m[0].length;
    while (depth > 0) {
      openRe.lastIndex = cursor;
      closeRe.lastIndex = cursor;
      const o = openRe.exec(xml);
      const c = closeRe.exec(xml);
      if (!c) break;
      if (o && o.index < c.index) {
        depth++;
        cursor = o.index + o[0].length;
      } else {
        depth--;
        cursor = c.index + c[0].length;
        if (depth === 0) {
          out.push({ start: m.index, end: cursor, tag });
          re.lastIndex = cursor;
        }
      }
    }
  }
  return out;
}

/** Build the canonical PROPERTY TYPE table XML for property index N. */
function buildCanonicalTable(n: number): string {
  const tag = (k: (typeof FIELDS)[number]) => `{{${k}_${n}}}`;

  const para = (parts: Array<{ text: string; preserve?: boolean }>) => {
    const runs = parts
      .map(
        (p) =>
          `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t${
            p.preserve ? ' xml:space="preserve"' : ""
          }>${p.text}</w:t></w:r>`,
      )
      .join("");
    return `<w:p><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr>${runs}</w:p>`;
  };

  const leftParas = [
    para([
      { text: tag("property_type_sfr_owner") },
      { text: " SINGLE-FAMILY RESIDENCE (owner occupied)", preserve: true },
    ]),
    para([
      { text: tag("property_type_sfr_non_owner") },
      {
        text: " SINGLE-FAMILY RESIDENCE (not owner occupied)",
        preserve: true,
      },
    ]),
    para([
      { text: tag("property_type_sfr_zoned") },
      {
        text: " SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)",
        preserve: true,
      },
    ]),
  ].join("");

  const rightParas = [
    para([
      { text: tag("property_type_commercial") },
      { text: " COMMERCIAL & INCOME-PRODUCING", preserve: true },
    ]),
    para([
      { text: tag("property_type_land_zoned") },
      { text: " LAND (zoned commercial/residential)", preserve: true },
    ]),
    para([
      { text: tag("property_type_land_income") },
      { text: " LAND (income-producing)", preserve: true },
    ]),
    para([
      { text: tag("property_type_other") },
      { text: " OTHER: ", preserve: true },
      { text: tag("property_type_other_text") },
    ]),
  ].join("");

  // Sentinel paragraph (zero-size hidden marker so we can detect prior runs).
  const sentinelPara = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:vanish/><w:sz w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:vanish/><w:sz w:val="2"/></w:rPr><w:t>${SENTINEL}_${n}</w:t></w:r></w:p>`;

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

function planRewrites(xml: string): {
  plans: RewritePlan[];
  skipped: number[];
  notFound: number[];
} {
  const { text, map } = buildStrippedIndex(xml);
  const blocks = findTopLevelBlocks(xml);

  const blockForOffset = (off: number) => {
    // Binary search would be nicer, but linear is fine for a one-shot.
    for (let i = 0; i < blocks.length; i++) {
      if (off >= blocks[i].start && off < blocks[i].end) return i;
    }
    return -1;
  };

  const plans: RewritePlan[] = [];
  const skipped: number[] = [];
  const notFound: number[] = [];

  for (let n = 1; n <= 5; n++) {
    const placeholderXmlOffsets: number[] = [];
    let missing = false;
    for (const f of FIELDS) {
      const needle = `{{${f}_${n}}}`;
      const idx = text.indexOf(needle);
      if (idx < 0) {
        missing = true;
        break;
      }
      placeholderXmlOffsets.push(map[idx]);
    }
    if (missing) {
      // Try sentinel detection — if every field is missing but the sentinel
      // is present, the template was already rewritten.
      if (text.includes(`${SENTINEL}_${n}`)) {
        skipped.push(n);
      } else {
        notFound.push(n);
      }
      continue;
    }

    // Idempotency: if all 8 placeholders are inside a single block that also
    // contains our sentinel for this N, skip.
    const blockIdxs = placeholderXmlOffsets.map(blockForOffset);
    const minBlock = Math.min(...blockIdxs);
    const maxBlock = Math.max(...blockIdxs);
    if (minBlock === maxBlock && minBlock >= 0) {
      const b = blocks[minBlock];
      const blockXml = xml.slice(b.start, b.end);
      if (blockXml.includes(`${SENTINEL}_${n}`)) {
        skipped.push(n);
        continue;
      }
    }

    if (minBlock < 0 || maxBlock < 0) {
      notFound.push(n);
      continue;
    }

    plans.push({
      start: blocks[minBlock].start,
      end: blocks[maxBlock].end,
      replacement: buildCanonicalTable(n),
      n,
    });
  }

  // Sort + ensure non-overlapping.
  plans.sort((a, b) => a.start - b.start);
  const cleaned: RewritePlan[] = [];
  let last = -1;
  for (const p of plans) {
    if (p.start < last) continue;
    cleaned.push(p);
    last = p.end;
  }

  return { plans: cleaned, skipped, notFound };
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
    try {
      const body = await req.json().catch(() => ({}));
      if (
        body &&
        typeof body.templatePath === "string" &&
        body.templatePath.trim()
      ) {
        templatePath = body.templatePath.trim();
      }
    } catch (_) {
      /* default */
    }

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

    const { plans, skipped, notFound } = planRewrites(originalXml);

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

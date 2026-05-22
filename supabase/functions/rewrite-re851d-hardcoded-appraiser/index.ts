// One-shot admin function: rewrites the RE851D template stored in the
// `templates` storage bucket to replace the HARDCODED appraiser cell text
// ("BPO Performed by Broker" and "N/A") with per-property merge tags
// `{{pr_p_appraiserName_K}}` and `{{pr_p_appraiserAddress_K}}` (K = 1..K
// in document order).
//
// The publisher in supabase/functions/_shared/tag-parser.ts already emits
// these tags with the correct per-property value based on the UI
// `Performed By` dropdown, so once the template carries the merge tags
// each property will resolve independently.
//
// Strictly scoped:
//   - Only rewrites a value cell whose visible text is EXACTLY
//     "BPO Performed by Broker" (for the name cell) or "N/A" (for the
//     address cell), and only when that cell is the very next <w:tc>
//     following a label cell containing "NAME OF APPRAISER" or
//     "ADDRESS OF APPRAISER" respectively. All other content is left
//     untouched.
//   - Idempotent. Re-running returns 0 rewrites.
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

/** Extract visible text from a slice of XML (strip all tags + decode entities). */
function visibleText(xml: string): string {
  const stripped = xml.replace(/<[^>]+>/g, "");
  return stripped
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find every `<w:tc>...</w:tc>` block in document order. */
function findCells(xml: string): Array<{ start: number; end: number }> {
  const cells: Array<{ start: number; end: number }> = [];
  const openRe = /<w:tc(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    const openStart = m.index;
    // Find the matching </w:tc> accounting for potential nesting (rare but
    // possible with nested tables). Walk forward counting opens vs closes.
    let depth = 1;
    const scanRe = /<w:tc(?:\s[^>]*)?>|<\/w:tc>/g;
    scanRe.lastIndex = openRe.lastIndex;
    let s: RegExpExecArray | null;
    let endIdx = -1;
    while ((s = scanRe.exec(xml)) !== null) {
      if (s[0].startsWith("</")) {
        depth--;
        if (depth === 0) {
          endIdx = s.index + s[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    if (endIdx === -1) break;
    cells.push({ start: openStart, end: endIdx });
    // Advance the outer iterator past this cell's interior to avoid
    // re-entering nested cells as top-level matches.
    openRe.lastIndex = endIdx;
  }
  return cells;
}

/**
 * Rewrite cell contents: keep <w:tcPr> intact, replace the rest of the
 * cell's body with a single paragraph containing the merge tag.
 */
function buildReplacementCell(originalCellXml: string, mergeTag: string): string {
  // Capture <w:tcPr>...</w:tcPr> if present (cell formatting).
  const tcPrMatch = originalCellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  const tcPr = tcPrMatch ? tcPrMatch[0] : "";

  // Capture the opening tag of <w:tc ...> verbatim (it may carry attrs).
  const openMatch = originalCellXml.match(/^<w:tc(?:\s[^>]*)?>/);
  const openTag = openMatch ? openMatch[0] : "<w:tc>";

  // Try to preserve the first paragraph's <w:pPr> so alignment/styles stay
  // consistent with the original cell. Fall back to a bare paragraph.
  const firstParaMatch = originalCellXml.match(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/);
  let pPr = "";
  if (firstParaMatch) {
    const pPrMatch = firstParaMatch[1].match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    if (pPrMatch) pPr = pPrMatch[0];
  }

  const paragraph =
    `<w:p>${pPr}<w:r><w:t xml:space="preserve">${mergeTag}</w:t></w:r></w:p>`;

  return `${openTag}${tcPr}${paragraph}</w:tc>`;
}

interface Rewrite {
  start: number;
  end: number;
  replacement: string;
  kind: "name" | "addr";
  index: number;
}

function computeRewrites(xml: string): {
  rewrites: Rewrite[];
  nameLabelsSeen: number;
  addrLabelsSeen: number;
} {
  const cells = findCells(xml);
  const rewrites: Rewrite[] = [];
  let nameCounter = 0;
  let addrCounter = 0;
  let nameLabelsSeen = 0;
  let addrLabelsSeen = 0;

  for (let i = 0; i < cells.length - 1; i++) {
    const labelCell = cells[i];
    const labelXml = xml.slice(labelCell.start, labelCell.end);
    const labelText = visibleText(labelXml).toUpperCase();

    let kind: "name" | "addr" | null = null;
    if (labelText === "NAME OF APPRAISER") kind = "name";
    else if (labelText === "ADDRESS OF APPRAISER") kind = "addr";
    if (kind === null) continue;

    if (kind === "name") nameLabelsSeen++;
    else addrLabelsSeen++;

    // The value cell is the very next <w:tc>.
    const valueCell = cells[i + 1];
    const valueXml = xml.slice(valueCell.start, valueCell.end);
    const valueText = visibleText(valueXml);

    const expected = kind === "name" ? "BPO Performed by Broker" : "N/A";
    // Case-insensitive, whitespace-normalized exact match.
    if (valueText.toLowerCase() !== expected.toLowerCase()) {
      // Already a merge tag or unexpected content — leave alone.
      continue;
    }

    const idx = kind === "name" ? ++nameCounter : ++addrCounter;
    const tagName = kind === "name"
      ? `pr_p_appraiserName_${idx}`
      : `pr_p_appraiserAddress_${idx}`;

    rewrites.push({
      start: valueCell.start,
      end: valueCell.end,
      replacement: buildReplacementCell(valueXml, `{{${tagName}}}`),
      kind,
      index: idx,
    });
  }

  return { rewrites, nameLabelsSeen, addrLabelsSeen };
}

function applyRewrites(xml: string, rewrites: Rewrite[]): string {
  if (rewrites.length === 0) return xml;
  const sorted = [...rewrites].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue;
    out.push(xml.slice(cursor, r.start));
    out.push(r.replacement);
    cursor = r.end;
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
        body && typeof body.templatePath === "string" &&
        body.templatePath.trim()
      ) {
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
    const { rewrites, nameLabelsSeen, addrLabelsSeen } = computeRewrites(
      originalXml,
    );
    const rewrittenNameCells = rewrites.filter((r) => r.kind === "name").length;
    const rewrittenAddressCells =
      rewrites.filter((r) => r.kind === "addr").length;

    if (rewrites.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          rewrittenNameCells: 0,
          rewrittenAddressCells: 0,
          nameLabelsSeen,
          addrLabelsSeen,
          message:
            "No hardcoded appraiser cells matched — template already clean or label/value structure changed.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newXml = applyRewrites(originalXml, rewrites);
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
        rewrittenNameCells,
        rewrittenAddressCells,
        nameLabelsSeen,
        addrLabelsSeen,
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

// One-shot admin function: rewrites the RE851D template stored in the
// `templates` storage bucket to replace the legacy
// `{{#if (eq pr_p_perform(e|ed)By_N "Broker")}}…{{/if}}` blocks with plain
// `{{pr_p_appraiserName_N}}` / `{{pr_p_appraiserAddress_N}}` merge tags.
//
// Idempotent. Safe to re-run — returns 0 rewrites if the template is already
// clean. Strictly scoped: only matches blocks whose payload (after stripping
// XML tags) is exactly "BPO Performed by Broker" or "N/A". All other
// `{{#if}}` constructs are left untouched.
//
// POST body: { templatePath?: string }
//   templatePath defaults to "1778746922135_RE851D-V12.1.docx".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778746922135_RE851D-V12.1.docx";

/**
 * Build a "tag-stripped" view of an XML string that maps every plain-text
 * character back to its origin offset in the original XML. This lets us
 * match merge-tag patterns that have been split across multiple <w:r>
 * runs in the DOCX.
 */
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

/** Decode the most common XML entities so we can recognise `"`, <, etc. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Find every appraiser-conditional block in `xml` (tolerating run splits and
 * smart quotes) and return rewrite ranges [start, end, replacement] that
 * collapse the block to a single merge tag in the SAME XML position. Ranges
 * are returned in document order with no overlaps.
 */
function rewriteAppraiserBlocks(xml: string): {
  ranges: Array<{ start: number; end: number; replacement: string }>;
  rewritten: number;
  remainingIfBlocks: number;
} {
  const { text, map } = buildStrippedIndex(xml);
  const decoded = decodeEntities(text);

  // Decoded-vs-stripped offsets are equal until we hit `&xxx;`. To keep
  // mapping back to the original XML simple, we run the regex against the
  // tag-stripped (but entity-encoded) text and just normalise quotes inside
  // the regex itself.
  //
  // Pattern intentionally tolerant:
  //   {{ #if ( eq pr_p_perform(e|ed)By_N "Broker" ) }} PAYLOAD {{ /if }}
  // - whitespace anywhere
  // - smart or straight quotes
  // - either `_N` literal or `_1`..`_5`
  const blockRe =
    /\{\{\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(N|[1-5])\s*(?:"|&quot;|\u201C|\u201D)\s*Broker\s*(?:"|&quot;|\u201C|\u201D)\s*\)\s*\}\}([\s\S]*?)\{\{\s*\/\s*if\s*\}\}/g;

  const ranges: Array<{ start: number; end: number; replacement: string }> = [];
  // Track per-(kind) occurrence so we can fall back to slot N when the
  // raw `_N` literal is still in the template (which is the common case
  // for V12 RE851D — every property block references `_N`, not a real
  // index). For five properties × two fields, that's 10 blocks total.
  const counter: Record<"name" | "addr", number> = { name: 0, addr: 0 };

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const matchStartStripped = m.index;
    const matchEndStripped = matchStartStripped + m[0].length;
    if (matchStartStripped >= map.length) break;

    // Map back to the original XML character offsets. We replace from the
    // first character of the opening `{` up to AND INCLUDING the closing
    // `}` of `{{/if}}`.
    const xmlStart = map[matchStartStripped];
    // The end-mapped index points to the LAST consumed char; the rewrite
    // range is exclusive of `xmlEnd`, so add 1.
    const lastStrippedIdx = matchEndStripped - 1;
    const xmlEnd = map[lastStrippedIdx] + 1;

    const rawIndex = m[1];
    const payloadDecoded = decodeEntities(String(m[2] || "")).trim();

    let kind: "name" | "addr" | null = null;
    if (/^BPO Performed by Broker$/i.test(payloadDecoded)) kind = "name";
    else if (/^N\/A$/i.test(payloadDecoded)) kind = "addr";
    if (kind === null) continue; // strictly scoped — leave unrelated blocks alone

    let pIdx: number;
    if (rawIndex === "N") {
      counter[kind] += 1;
      pIdx = Math.min(Math.max(counter[kind], 1), 5);
    } else {
      pIdx = parseInt(rawIndex, 10);
    }

    const tagBase = kind === "name" ? "pr_p_appraiserName" : "pr_p_appraiserAddress";
    ranges.push({
      start: xmlStart,
      end: xmlEnd,
      replacement: `{{${tagBase}_${pIdx}}}`,
    });
  }

  // Sort + dedupe (regex never overlaps but be defensive).
  ranges.sort((a, b) => a.start - b.start);
  const cleaned: typeof ranges = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start < lastEnd) continue;
    cleaned.push(r);
    lastEnd = r.end;
  }

  // Count residual `{{#if (eq pr_p_perform...` openers in stripped text
  // AFTER our rewrites would apply. Since we'd remove every match, the
  // residual count of openers we did NOT match is what matters.
  const openerRe = /\{\{\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_/g;
  const allOpeners = (text.match(openerRe) || []).length;
  const remainingIfBlocks = Math.max(0, allOpeners - cleaned.length);

  return { ranges: cleaned, rewritten: cleaned.length, remainingIfBlocks };
}

function applyRanges(
  xml: string,
  ranges: Array<{ start: number; end: number; replacement: string }>,
): string {
  if (ranges.length === 0) return xml;
  const out: string[] = [];
  let cursor = 0;
  for (const r of ranges) {
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
      if (body && typeof body.templatePath === "string" && body.templatePath.trim()) {
        templatePath = body.templatePath.trim();
      }
    } catch (_) { /* default */ }

    // 1) Download template
    const dl = await supabase.storage.from("templates").download(templatePath);
    if (dl.error || !dl.data) {
      return new Response(
        JSON.stringify({ error: `download failed: ${dl.error?.message || "no data"}`, templatePath }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const inputBytes = new Uint8Array(await dl.data.arrayBuffer());

    // 2) Unzip
    const decompressed = fflate.unzipSync(inputBytes);
    const docXmlBytes = decompressed["word/document.xml"];
    if (!docXmlBytes) {
      return new Response(
        JSON.stringify({ error: "word/document.xml missing from template" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    const originalXml = decoder.decode(docXmlBytes);

    // 3) Compute rewrites
    const { ranges, rewritten, remainingIfBlocks } = rewriteAppraiserBlocks(originalXml);

    if (rewritten === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          rewrittenBlocks: 0,
          remainingIfBlocks,
          message: "Template already clean — no changes written.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newXml = applyRanges(originalXml, ranges);
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        templatePath,
        rewrittenBlocks: rewritten,
        remainingIfBlocks,
        originalSize: inputBytes.length,
        newSize: repacked.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

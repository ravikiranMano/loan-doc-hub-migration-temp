// One-shot template rewrite for the RE885 (HUD-1) Description column.
//
// Problem: each Items-Payable row currently packs the item label AND the
//   {{of_NNN_desc}} merge tag into the SAME paragraph, separated only by a
//   long whitespace-only run that fakes a column. That makes long labels
//   (e.g. 806 "Mortgage Broker Commission/Fee") wrap awkwardly and pushes
//   the description out of alignment with the rest of the column.
//
// Fix: for every paragraph that contains a `{{of_NNN_desc}}` merge tag
//   AND has visible item-label text BEFORE it, split the paragraph in two
//   at the run that begins the `{{` marker. Drop any whitespace-only runs
//   that immediately precede that split (the inline padding). Re-emit the
//   trailing piece as its own paragraph with a CLONE of the original
//   `<w:pPr>` so the description sits directly below the item label, fully
//   left-aligned and with the same `before="12"` spacing every row.
//
// Strictly scoped: only paragraphs whose stripped text contains
// `{{of_<code>_desc}}` for one of the known HUD-1 codes are touched.
// All other paragraphs, runs, fields, and tags are left exactly as-is.
// Idempotent — safe to re-run.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778766453217_re885.docx";

const DESC_CODES = [
  "801","802","803","804","805","806","808","809","810","811","812",
  "901","902","903","904","905",
  "1001","1002","1004",
  "1101","1105","1106","1108",
  "1201","1202","1302",
];

// --- XML helpers ----------------------------------------------------------

interface Para { start: number; end: number; xml: string; }

function splitParagraphs(xml: string): Para[] {
  const out: Para[] = [];
  const re = /<w:p\b[^>]*?>[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  }
  return out;
}

function strippedText(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

/** Extract <w:pPr>...</w:pPr> from a paragraph or return "". */
function extractPPr(pXml: string): string {
  const m = pXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/);
  return m ? m[0] : "";
}

/** Return the substring AFTER the opening <w:p ...> tag, before </w:p>. */
function paragraphBody(pXml: string): { openTag: string; body: string } {
  const open = pXml.match(/^<w:p\b[^>]*?>/);
  if (!open) return { openTag: "<w:p>", body: pXml };
  const openTag = open[0];
  const body = pXml.slice(openTag.length, pXml.length - "</w:p>".length);
  return { openTag, body };
}

/** Split body into a sequence of <w:pPr> (optional) + run-or-other tokens. */
function tokenize(body: string): { ppr: string; tokens: string[] } {
  let ppr = "";
  const pprMatch = body.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|^<w:pPr\s*\/>/);
  let rest = body;
  if (pprMatch) {
    ppr = pprMatch[0];
    rest = body.slice(ppr.length);
  }
  // Tokenize remainder into <w:r ...>...</w:r> blocks (and any stray content).
  const tokens: string[] = [];
  const re = /<w:r\b[^>]*?>[\s\S]*?<\/w:r>|<w:bookmarkStart\b[^>]*\/>|<w:bookmarkEnd\b[^>]*\/>|<w:proofErr\b[^>]*\/>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    if (m.index > last) {
      const between = rest.slice(last, m.index);
      if (between.trim()) tokens.push(between);
    }
    tokens.push(m[0]);
    last = re.lastIndex;
  }
  if (last < rest.length) {
    const tail = rest.slice(last);
    if (tail.trim()) tokens.push(tail);
  }
  return { ppr, tokens };
}

function runText(runXml: string): string {
  // Concatenate all <w:t>...</w:t> contents (preserving spaces).
  let out = "";
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(runXml)) !== null) out += m[1];
  return out;
}

function isWhitespaceOnlyRun(runXml: string): boolean {
  if (!runXml.startsWith("<w:r")) return false;
  const t = runText(runXml);
  return t.length > 0 && t.trim().length === 0;
}

// --- Core rewrite ---------------------------------------------------------

interface RewriteResult {
  xml: string;
  paragraphsRewritten: number;
  paragraphsSkippedAlreadySplit: number;
  paragraphsTouchedByCode: Record<string, number>;
}

function rewrite(xml: string): RewriteResult {
  const paras = splitParagraphs(xml);
  const replacements = new Map<number, string>();
  let rewritten = 0;
  let skipped = 0;
  const byCode: Record<string, number> = {};

  const codeRe = new RegExp(
    `\\{\\{\\s*of_(${DESC_CODES.join("|")})_desc\\s*\\}\\}`,
  );

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const text = strippedText(p.xml);
    const codeMatch = text.match(codeRe);
    if (!codeMatch) continue;

    const code = codeMatch[1];

    // Identify whether visible label text precedes the `{{`. If the only
    // non-whitespace content of this paragraph IS the merge tag itself,
    // it's already been split — leave it alone.
    const beforeTag = text.slice(0, codeMatch.index ?? 0);
    if (beforeTag.trim().length === 0) {
      skipped++;
      continue;
    }

    const { openTag, body } = paragraphBody(p.xml);
    const { ppr, tokens } = tokenize(body);
    if (tokens.length === 0) continue;

    // Find the FIRST run whose run-text contains `{{`. That run begins the
    // merge tag (the merge tag may span multiple following runs).
    let splitIdx = -1;
    for (let k = 0; k < tokens.length; k++) {
      const tk = tokens[k];
      if (!tk.startsWith("<w:r")) continue;
      const t = runText(tk);
      if (t.includes("{{")) { splitIdx = k; break; }
    }
    if (splitIdx <= 0) {
      // either no `{{` at run start (shouldn't happen) or splitting at the
      // very first token would leave an empty head paragraph — skip.
      skipped++;
      continue;
    }

    // Walk backwards over whitespace-only runs immediately preceding the
    // split — those are the inline padding spaces we want to drop.
    let headEnd = splitIdx;
    while (
      headEnd > 0 &&
      tokens[headEnd - 1].startsWith("<w:r") &&
      isWhitespaceOnlyRun(tokens[headEnd - 1])
    ) {
      headEnd--;
    }
    if (headEnd === 0) {
      // Nothing visible left in head — skip rather than emit blank label.
      skipped++;
      continue;
    }

    const headTokens = tokens.slice(0, headEnd);
    const tailTokens = tokens.slice(splitIdx);

    // Build two paragraphs reusing the original opening <w:p ...> tag and
    // <w:pPr>. The 2nd paragraph re-uses the same <w:pPr> so spacing,
    // style, and indent match the label paragraph above it.
    const headPara =
      `${openTag}${ppr}${headTokens.join("")}</w:p>`;
    const tailPara =
      `<w:p>${ppr}${tailTokens.join("")}</w:p>`;

    replacements.set(i, headPara + tailPara);
    rewritten++;
    byCode[code] = (byCode[code] || 0) + 1;
  }

  if (replacements.size === 0) {
    return { xml, paragraphsRewritten: 0, paragraphsSkippedAlreadySplit: skipped, paragraphsTouchedByCode: byCode };
  }

  // Reassemble document XML.
  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    const repl = replacements.get(i);
    if (repl == null) continue;
    out.push(xml.slice(cursor, paras[i].start));
    out.push(repl);
    cursor = paras[i].end;
  }
  out.push(xml.slice(cursor));

  return {
    xml: out.join(""),
    paragraphsRewritten: rewritten,
    paragraphsSkippedAlreadySplit: skipped,
    paragraphsTouchedByCode: byCode,
  };
}

// --- HTTP handler ---------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let templatePath = DEFAULT_TEMPLATE_PATH;
    let dryRun = false;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.templatePath) templatePath = String(body.templatePath);
      if (body?.dryRun) dryRun = !!body.dryRun;
    } catch (_) {}

    const dl = await supabase.storage.from("templates").download(templatePath);
    if (dl.error || !dl.data) {
      return new Response(
        JSON.stringify({ error: dl.error?.message || "no data", templatePath }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const unzipped = fflate.unzipSync(bytes);
    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) {
      return new Response(
        JSON.stringify({ error: "word/document.xml missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    const originalXml = decoder.decode(docXmlBytes);

    const result = rewrite(originalXml);

    if (result.paragraphsRewritten === 0 || dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          dryRun,
          paragraphsRewritten: result.paragraphsRewritten,
          paragraphsSkippedAlreadySplit: result.paragraphsSkippedAlreadySplit,
          paragraphsTouchedByCode: result.paragraphsTouchedByCode,
          message: result.paragraphsRewritten === 0
            ? "No matching paragraphs to rewrite — template already normalized."
            : "Dry run — no changes written.",
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    unzipped["word/document.xml"] = encoder.encode(result.xml);
    const repacked = fflate.zipSync(unzipped as fflate.Zippable);

    const up = await supabase.storage.from("templates").upload(templatePath, repacked, {
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
        paragraphsRewritten: result.paragraphsRewritten,
        paragraphsSkippedAlreadySplit: result.paragraphsSkippedAlreadySplit,
        paragraphsTouchedByCode: result.paragraphsTouchedByCode,
        originalSize: bytes.length,
        newSize: repacked.length,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

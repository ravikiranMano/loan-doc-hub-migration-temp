// One-shot template rewrite for the RE851D ENCUMBRANCE INFORMATION section.
//
// Goal (per latest user spec):
//   Merge each YES/NO checkbox pair onto a SINGLE paragraph (one line) with a
//   non-breaking space between "YES" and the no-glyph tag, so Word cannot
//   wrap or stack the two checkboxes vertically.
//
// Pairs handled (each in 5 property sections):
//   {{pr_li_encumbranceOfRecord_N_yes_glyph}} YES   ←┐ merge into one
//   {{pr_li_encumbranceOfRecord_N_no_glyph}} NO     ←┘ paragraph
//   …delinqu60day…
//   …currentDelinqu…
//   …delinquencyPaidByLoan…
//
// Strictly scoped — only paragraphs that contain a `_yes_glyph` (or its
// matching `_no_glyph`) for one of the four families are touched. Any
// intervening blank paragraphs between the YES paragraph and the NO
// paragraph are removed so the pair sits on the same line.
//
// Idempotent: if a paragraph already contains both `_yes_glyph` and
// `_no_glyph` for the same family, no change is made.
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

const FAMILIES = [
  "encumbranceOfRecord",
  "delinqu60day",
  "currentDelinqu",
  "delinquencyPaidByLoan",
] as const;
type Family = (typeof FAMILIES)[number];

interface Para {
  start: number;
  end: number;
  text: string;     // raw XML
  stripped: string; // text content with tags removed
}

function splitParagraphs(xml: string): Para[] {
  const out: Para[] = [];
  const re = /<w:p\b[^>]*?>[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = m[0];
    out.push({
      start: m.index,
      end: m.index + text.length,
      text,
      stripped: text.replace(/<[^>]+>/g, ""),
    });
  }
  return out;
}

function detectFamily(stripped: string, kind: "yes" | "no"): Family | null {
  for (const f of FAMILIES) {
    const re = new RegExp(`pr_li_${f}_N_${kind}_glyph`);
    if (re.test(stripped)) return f;
  }
  return null;
}

/**
 * Merge paragraph B's inner content into paragraph A, separated by a
 * non-breaking-space run. We splice B's runs (everything inside the
 * outer <w:p>...</w:p>, EXCLUDING B's <w:pPr>) just before A's </w:p>.
 *
 * The non-breaking space is inserted as its own run that copies A's last
 * run-properties (rPr) when available, so font/size match.
 */
function mergeParagraphs(aXml: string, bXml: string): string {
  // Strip B's wrapping <w:p ...> ... </w:p> AND B's leading <w:pPr>.
  const bInnerMatch = bXml.match(/^<w:p\b[^>]*?>([\s\S]*)<\/w:p>$/);
  if (!bInnerMatch) return aXml; // safety
  let bInner = bInnerMatch[1];
  // Drop B's <w:pPr>...</w:pPr> if present (paragraph-level props belong
  // to the paragraph wrapper, which is being discarded).
  bInner = bInner.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, "");

  // Try to find a recent <w:rPr> in A to clone for the NBSP run, so the
  // glyph spacing/font matches surrounding text.
  let rPrClone = "";
  const lastRPr = [...aXml.matchAll(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g)].pop();
  if (lastRPr) rPrClone = lastRPr[0];

  const nbspRun =
    `<w:r>${rPrClone}<w:t xml:space="preserve">\u00A0</w:t></w:r>`;

  // Insert NBSP run + B's inner runs immediately before A's closing </w:p>.
  return aXml.replace(/<\/w:p>\s*$/, `${nbspRun}${bInner}</w:p>`);
}

function processXml(xml: string): {
  xml: string;
  pairsMerged: number;
  blanksRemoved: number;
} {
  const paras = splitParagraphs(xml);
  if (paras.length === 0) return { xml, pairsMerged: 0, blanksRemoved: 0 };

  // Track which paragraphs are dropped, and which are rewritten.
  const drop = new Set<number>();
  const rewrite = new Map<number, string>();

  let pairsMerged = 0;
  let blanksRemoved = 0;

  for (let i = 0; i < paras.length; i++) {
    if (drop.has(i)) continue;
    const a = paras[i];
    const yesFam = detectFamily(a.stripped, "yes");
    if (!yesFam) continue;
    // Idempotency: skip if A already contains the matching no-glyph.
    if (new RegExp(`pr_li_${yesFam}_N_no_glyph`).test(a.stripped)) continue;

    // Walk forward to find the matching NO paragraph, skipping blank
    // paragraphs and stopping at any non-blank, non-matching content.
    let j = i + 1;
    const intermediates: number[] = [];
    let matched = -1;
    while (j < paras.length && j <= i + 6) {
      const pj = paras[j];
      const jStripped = pj.stripped.trim();
      const noFam = detectFamily(pj.stripped, "no");
      if (noFam === yesFam) { matched = j; break; }
      if (jStripped === "") { intermediates.push(j); j++; continue; }
      // Non-blank, non-matching paragraph — abort merge for this YES.
      break;
    }
    if (matched < 0) continue;

    // Merge: A.text + NBSP + B.runs.  Drop intermediates and B.
    const aXml = rewrite.get(i) ?? a.text;
    const bXml = paras[matched].text;
    rewrite.set(i, mergeParagraphs(aXml, bXml));
    drop.add(matched);
    for (const k of intermediates) {
      drop.add(k);
      blanksRemoved++;
    }
    pairsMerged++;
  }

  if (rewrite.size === 0 && drop.size === 0) {
    return { xml, pairsMerged: 0, blanksRemoved: 0 };
  }

  // Rebuild the XML in document order, applying rewrites and skipping drops.
  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!rewrite.has(i) && !drop.has(i)) continue;
    out.push(xml.slice(cursor, p.start));
    if (rewrite.has(i)) out.push(rewrite.get(i)!);
    // dropped paragraphs emit nothing
    cursor = p.end;
  }
  out.push(xml.slice(cursor));

  return { xml: out.join(""), pairsMerged, blanksRemoved };
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

    const dl = await supabase.storage.from("templates").download(templatePath);
    if (dl.error || !dl.data) {
      return new Response(
        JSON.stringify({
          error: `download failed: ${dl.error?.message || "no data"}`,
          templatePath,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const inputBytes = new Uint8Array(await dl.data.arrayBuffer());

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

    const { xml: newXml, pairsMerged, blanksRemoved } = processXml(originalXml);

    if (newXml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          pairsMerged: 0,
          blanksRemoved: 0,
          message:
            "Template already has YES/NO pairs inline — no changes written.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        templatePath,
        pairsMerged,
        blanksRemoved,
        originalSize: inputBytes.length,
        newSize: repacked.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

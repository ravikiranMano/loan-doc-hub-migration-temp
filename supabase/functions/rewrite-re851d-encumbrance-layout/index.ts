// One-shot template rewrite for the RE851D ENCUMBRANCE INFORMATION section.
//
// Goals (per user spec, all 5 property sections):
//   1. Right-align the YES/NO checkbox paragraphs that contain
//      {{pr_li_(encumbranceOfRecord|delinqu60day|currentDelinqu|delinquencyPaidByLoan)_N_yes_glyph}}.
//   2. Keep each YES/NO checkbox paragraph together with its preceding
//      question paragraph (and any blank spacing paragraphs in between)
//      so they never split across page breaks (Problem 2: question A).
//
// Strictly scoped — only paragraphs that contain one of the four lien
// glyph tags (and a small lookback window above them) are touched.
// Idempotent: re-running adds nothing new (we dedupe keepNext/keepLines/jc).
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

const GLYPH_FAMILY_RE =
  /pr_li_(?:encumbranceOfRecord|delinqu60day|currentDelinqu|delinquencyPaidByLoan)/;

interface Para {
  start: number;
  end: number;
  text: string;
  stripped: string;
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

/**
 * Insert <w:pPr> children safely.
 * - Dedupe by tag name (keepNext, keepLines, jc).
 * - If <w:pPr> exists, insert before </w:pPr>.
 * - If <w:pPr> missing, create one immediately after opening <w:p ...>.
 *
 * Note: schema technically constrains child order, but Word is forgiving
 * for these specific elements in practice.
 */
function modifyPara(
  pXml: string,
  opts: { keepNext?: boolean; keepLines?: boolean; rightAlign?: boolean },
): string {
  const want: string[] = [];
  if (opts.keepNext && !/<w:keepNext\b/.test(pXml)) want.push("<w:keepNext/>");
  if (opts.keepLines && !/<w:keepLines\b/.test(pXml)) {
    want.push("<w:keepLines/>");
  }
  if (opts.rightAlign && !/<w:jc\b[^/]*\bw:val="right"/.test(pXml)) {
    // If a non-right jc is present, replace it; else insert.
    if (/<w:jc\b[^/]*\/>/.test(pXml)) {
      pXml = pXml.replace(/<w:jc\b[^/]*\/>/, '<w:jc w:val="right"/>');
    } else {
      want.push('<w:jc w:val="right"/>');
    }
  }
  if (want.length === 0) return pXml;
  const insert = want.join("");

  if (/<w:pPr\b[^>]*>/.test(pXml)) {
    // Insert before <w:rPr> if present (rPr must remain last child of pPr),
    // otherwise insert before </w:pPr>.
    if (/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>\s*<\/w:pPr>/.test(pXml)) {
      return pXml.replace(
        /(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>\s*<\/w:pPr>)/,
        insert + "$1",
      );
    }
    return pXml.replace(/<\/w:pPr>/, insert + "</w:pPr>");
  }
  // Create pPr right after opening <w:p ...>
  return pXml.replace(/(<w:p\b[^>]*?>)/, `$1<w:pPr>${insert}</w:pPr>`);
}

function processXml(xml: string): { xml: string; checkboxParas: number; questionParas: number } {
  const paras = splitParagraphs(xml);
  // Map each paragraph index to its rewritten text (default: same as original)
  const rewrites = new Map<number, string>();

  let checkboxCount = 0;
  let questionCount = 0;

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!GLYPH_FAMILY_RE.test(p.stripped)) continue;
    if (!/_yes_glyph/.test(p.stripped)) continue;

    // 1) Right-align + keepLines on the checkbox paragraph
    const next = modifyPara(rewrites.get(i) ?? p.text, {
      rightAlign: true,
      keepLines: true,
    });
    if (next !== p.text) {
      rewrites.set(i, next);
      checkboxCount++;
    }

    // 2) Walk back up to 5 preceding paragraphs adding keepNext+keepLines.
    //    Stop after the first paragraph that contains "?" (the question).
    let stepsBack = 0;
    for (let j = i - 1; j >= 0 && stepsBack < 5; j--, stepsBack++) {
      const pj = paras[j];
      const cur = rewrites.get(j) ?? pj.text;
      const upd = modifyPara(cur, { keepNext: true, keepLines: true });
      if (upd !== pj.text) {
        rewrites.set(j, upd);
        questionCount++;
      }
      if (pj.stripped.includes("?")) break;
    }
  }

  if (rewrites.size === 0) return { xml, checkboxParas: 0, questionParas: 0 };

  // Apply rewrites in document order
  const out: string[] = [];
  let cursor = 0;
  const indices = [...rewrites.keys()].sort((a, b) => a - b);
  for (const idx of indices) {
    const p = paras[idx];
    out.push(xml.slice(cursor, p.start));
    out.push(rewrites.get(idx)!);
    cursor = p.end;
  }
  out.push(xml.slice(cursor));

  return { xml: out.join(""), checkboxParas: checkboxCount, questionParas: questionCount };
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

    const { xml: newXml, checkboxParas, questionParas } = processXml(originalXml);

    if (newXml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          checkboxParas: 0,
          questionParas: 0,
          message: "Template already has right-align + keep-together — no changes written.",
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
        checkboxParas,
        questionParas,
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

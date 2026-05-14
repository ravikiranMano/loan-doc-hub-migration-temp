// One-shot template rewrite for the RE851D ENCUMBRANCE INFORMATION section.
//
// Goal: make each per-property "encumbrance" group exactly match the reference
// document `re851d - LPDS Multi-property.docx`, which is:
//
//   p_Q1   "Are there any encumbrances of record..."   ind=360, before=93
//   p_S1   (blank spacer)                              before=68
//   p_Q2   "Over the last 12 months, were any payments more than 60 days late?"
//          ind=718 hanging=358, tabs=718
//   p_YN1  encumbrance YES/NO                          ind=86,  tabs=986, before=93
//   p_S2   (blank spacer)                              before=68
//   p_YN2  60-day YES/NO                               ind=86,  tabs=986
//   p_END  (blank carrying continuous 2-col sectPr)
//
// The current generated output has, for the FIRST property only, an EXTRA
// empty paragraph between YN1 and the S2 spacer, and BOTH YN paragraphs
// are missing `<w:ind w:left="86"/>`. The previous rewrite added
// `keepNext`/`keepLines` to neighbouring blanks which made the layout
// noisier without fixing the alignment.
//
// This rewrite, scoped strictly to YES/NO paragraphs of
//   pr_li_encumbranceOfRecord_N
//   pr_li_delinqu60day_N
// does the following:
//   1. Adds `<w:ind w:left="86"/>` to YN paragraphs of those two families
//      when missing.
//   2. Trims trailing whitespace-only runs from those YN paragraphs (so the
//      visible "NO" is not pushed off-edge by stray spaces).
//   3. Removes prior `keepNext` noise the older rewrite injected on
//      blank/question paragraphs adjacent to YN paragraphs.
//   4. For the first property pattern only, removes a single redundant
//      empty paragraph that sits BETWEEN YN1 and the S2 spacer, so the
//      flow matches every other property and the reference document.
//   5. Leaves all checkbox SDT logic, tag names, and section properties
//      untouched.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778746922135_RE851D-V12.1.docx";

const FAMILIES = ["encumbranceOfRecord", "delinqu60day"] as const;
type Family = (typeof FAMILIES)[number];

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

function familyFor(stripped: string): Family | null {
  for (const f of FAMILIES) {
    if (
      new RegExp(`pr_li_${f}_N_yes_glyph`).test(stripped) &&
      new RegExp(`pr_li_${f}_N_no_glyph`).test(stripped)
    ) {
      return f;
    }
  }
  return null;
}

function isVisuallyEmpty(p: Para): boolean {
  // No visible text, no checkbox SDT, no drawing, no tab character, no break.
  if (p.stripped.trim().length > 0) return false;
  if (/<w:sdt\b/.test(p.text)) return false;
  if (/<w:drawing\b/.test(p.text)) return false;
  if (/<w:tab\s*\/>/.test(p.text)) return false;
  if (/<w:br\b/.test(p.text)) return false;
  return true;
}

function paragraphCarriesSectPr(p: Para): boolean {
  return /<w:sectPr\b/.test(p.text);
}

/**
 * Ensure pPr contains `<w:ind w:left="86"/>`. If an `<w:ind ...>` already
 * exists, leave it alone (other properties already have correct indents).
 * Idempotent.
 */
function ensureCheckboxIndent(pXml: string): { xml: string; changed: boolean } {
  const open = pXml.match(/^<w:p\b[^>]*?>/);
  if (!open) return { xml: pXml, changed: false };
  const IND = `<w:ind w:left="86"/>`;
  const pprMatch = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
  if (!pprMatch) {
    return {
      xml: pXml.replace(open[0], `${open[0]}<w:pPr>${IND}</w:pPr>`),
      changed: true,
    };
  }
  if (/<w:ind\b[^>]*\/>/.test(pprMatch[1])) {
    return { xml: pXml, changed: false };
  }
  // Insert <w:ind/> after <w:tabs/> if present, else at start of pPr inner.
  let inner = pprMatch[1];
  if (/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/.test(inner)) {
    inner = inner.replace(/(<\/w:tabs>)/, `$1${IND}`);
  } else {
    inner = IND + inner;
  }
  return {
    xml: pXml.replace(pprMatch[0], `<w:pPr>${inner}</w:pPr>`),
    changed: true,
  };
}

/**
 * Drop trailing whitespace-only runs and strip trailing whitespace inside the
 * last <w:t>. Trailing spaces would otherwise widen the rendered checkbox row.
 */
function trimTrailingWhitespace(pXml: string): { xml: string; changed: boolean } {
  let out = pXml;
  let changed = false;
  for (let safety = 0; safety < 5; safety++) {
    const re =
      /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t\b[^>]*>\s*<\/w:t>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>(?=\s*<\/w:p>)/;
    if (!re.test(out)) break;
    out = out.replace(re, "");
    changed = true;
  }
  out = out.replace(
    /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>(?:(?!<w:t\b)[\s\S])*?<\/w:p>\s*$)/,
    (full, open, inner, tail) => {
      const trimmed = inner.replace(/\s+$/, "");
      if (trimmed === inner) return full;
      changed = true;
      return open + trimmed + tail;
    },
  );
  return { xml: out, changed };
}

/**
 * Remove `<w:keepNext/>` and `<w:keepLines/>` from a paragraph's pPr — these
 * were added by an earlier rewrite and now produce visible vertical drift in
 * property 1 that the reference layout does not have.
 */
function stripKeepArtifacts(pXml: string): { xml: string; changed: boolean } {
  const next = pXml
    .replace(/<w:keepNext\s*\/>/g, "")
    .replace(/<w:keepLines\s*\/>/g, "");
  return { xml: next, changed: next !== pXml };
}

function processXml(xml: string): {
  xml: string;
  paragraphsIndented: number;
  paragraphsTrimmed: number;
  paragraphsStripped: number;
  redundantParagraphsRemoved: number;
} {
  const paras = splitParagraphs(xml);
  if (paras.length === 0) {
    return {
      xml,
      paragraphsIndented: 0,
      paragraphsTrimmed: 0,
      paragraphsStripped: 0,
      redundantParagraphsRemoved: 0,
    };
  }

  const rewrite = new Map<number, string>();
  const removeIdx = new Set<number>();
  let indented = 0;
  let trimmed = 0;
  let stripped = 0;
  let removed = 0;

  // Find all YN paragraphs.
  const ynIndices: number[] = [];
  for (let i = 0; i < paras.length; i++) {
    if (familyFor(paras[i].stripped)) ynIndices.push(i);
  }

  // 1+2: Indent and trim each YN paragraph.
  for (const i of ynIndices) {
    let cur = paras[i].text;
    const a = ensureCheckboxIndent(cur);
    if (a.changed) {
      cur = a.xml;
      indented++;
    }
    const t = trimTrailingWhitespace(cur);
    if (t.changed) {
      cur = t.xml;
      trimmed++;
    }
    if (cur !== paras[i].text) rewrite.set(i, cur);
  }

  // 3: strip keepNext/keepLines from any paragraph whose pPr has it within
  // the encumbrance window (1 paragraph before YN1 .. YN2). Pair YN
  // paragraphs into (encumbrance, delinqu60day) groups in document order.
  for (let k = 0; k < ynIndices.length; k += 2) {
    const yn1 = ynIndices[k];
    const yn2 = ynIndices[k + 1];
    if (yn2 == null) break;
    // Window covers question paragraphs above YN1 and any paragraphs up to YN2.
    const winStart = Math.max(0, yn1 - 3);
    const winEnd = yn2;
    for (let j = winStart; j <= winEnd; j++) {
      const base = rewrite.get(j) ?? paras[j].text;
      const s = stripKeepArtifacts(base);
      if (s.changed) {
        rewrite.set(j, s.xml);
        stripped++;
      }
    }

    // 4: between YN1 and YN2 the reference has exactly ONE blank spacer
    // paragraph. If there are more visually-empty paragraphs in that gap
    // (and they don't carry sectPr or any meaningful content), remove the
    // extras (keep the FIRST one which inherits original spacer formatting
    // closest to the reference).
    const between: number[] = [];
    for (let j = yn1 + 1; j < yn2; j++) {
      if (isVisuallyEmpty(paras[j]) && !paragraphCarriesSectPr(paras[j])) {
        between.push(j);
      }
    }
    if (between.length > 1) {
      // Keep the one with `before="68"` if present (matches reference spacer);
      // otherwise keep the first.
      let keepIdx = between.findIndex((j) =>
        /<w:spacing\b[^>]*w:before="68"/.test(paras[j].text),
      );
      if (keepIdx < 0) keepIdx = 0;
      for (let m = 0; m < between.length; m++) {
        if (m === keepIdx) continue;
        removeIdx.add(between[m]);
        removed++;
      }
    }
  }

  if (rewrite.size === 0 && removeIdx.size === 0) {
    return {
      xml,
      paragraphsIndented: indented,
      paragraphsTrimmed: trimmed,
      paragraphsStripped: stripped,
      redundantParagraphsRemoved: removed,
    };
  }

  // Assemble new XML.
  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    if (removeIdx.has(i)) {
      out.push(xml.slice(cursor, paras[i].start));
      cursor = paras[i].end;
      continue;
    }
    if (rewrite.has(i)) {
      out.push(xml.slice(cursor, paras[i].start));
      out.push(rewrite.get(i)!);
      cursor = paras[i].end;
    }
  }
  out.push(xml.slice(cursor));

  return {
    xml: out.join(""),
    paragraphsIndented: indented,
    paragraphsTrimmed: trimmed,
    paragraphsStripped: stripped,
    redundantParagraphsRemoved: removed,
  };
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

    const result = processXml(originalXml);

    if (result.xml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          ...result,
          xml: undefined,
          message: "Template already normalized — no changes written.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    decompressed["word/document.xml"] = encoder.encode(result.xml);
    const repacked = fflate.zipSync(decompressed as fflate.Zippable);

    const up = await supabase.storage.from("templates").upload(templatePath, repacked, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (up.error) {
      return new Response(JSON.stringify({ error: `upload failed: ${up.error.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        templatePath,
        paragraphsIndented: result.paragraphsIndented,
        paragraphsTrimmed: result.paragraphsTrimmed,
        paragraphsStripped: result.paragraphsStripped,
        redundantParagraphsRemoved: result.redundantParagraphsRemoved,
        originalSize: inputBytes.length,
        newSize: repacked.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

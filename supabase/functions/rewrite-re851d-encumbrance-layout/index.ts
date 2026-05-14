// One-shot template rewrite for the RE851D ENCUMBRANCE INFORMATION section.
//
// Goal: render every YES/NO checkbox pair on the SAME line as its question,
// right-aligned to the page/cell margin, matching the reference template
// `re851d - LPDS Multi-property.docx`.
//
// For each of the 4 question families, in every property section:
//
//   QUESTION PHRASE                    → FAMILY
//   "encumbrances of record"           → encumbranceOfRecord
//   "60 days late"                     → delinqu60day
//   "remain unpaid"                    → currentDelinqu
//   "cure the delinquency"             → delinquencyPaidByLoan
//
// We locate the question paragraph, then absorb the matching YES + NO runs
// (whether they currently live in two separate paragraphs or in one already
// merged paragraph below the question) into the question paragraph. Layout:
//
//   <question text> <TAB>  {{...yes_glyph}} YES &#160; {{...no_glyph}} NO
//
// A right-aligned tab stop on the question's <w:pPr> pulls the checkbox
// glyphs to the right margin. <w:keepLines/> stops Word from breaking the
// question text away from its checkboxes.
//
// Strictly scoped — only the four question paragraphs (× N properties) are
// touched. Idempotent: a question paragraph that already contains a matching
// `_yes_glyph` is skipped.

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
  { family: "encumbranceOfRecord", phrase: /encumbrances of record/i },
  { family: "delinqu60day",        phrase: /60 days late/i },
  { family: "currentDelinqu",      phrase: /remain unpaid/i },
  { family: "delinquencyPaidByLoan", phrase: /cure the delinquency/i },
] as const;
type Family = (typeof FAMILIES)[number]["family"];

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

function hasGlyph(stripped: string, family: Family, kind: "yes" | "no"): boolean {
  return new RegExp(`pr_li_${family}_N_${kind}_glyph`).test(stripped);
}

/**
 * Extract the inner runs of a paragraph (everything inside <w:p>...</w:p>
 * except its <w:pPr>). Returns "" if the paragraph cannot be parsed.
 */
function paragraphInnerRuns(pXml: string): string {
  const inner = pXml.match(/^<w:p\b[^>]*?>([\s\S]*)<\/w:p>$/);
  if (!inner) return "";
  return inner[1].replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, "");
}

/**
 * Get the last <w:rPr> block in an XML chunk, to clone for our injected runs
 * so font/size match.
 */
function lastRPr(xml: string): string {
  const all = [...xml.matchAll(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g)];
  return all.length ? all[all.length - 1][0] : "";
}

/**
 * Ensure the question paragraph has:
 *   - a right-aligned tab stop at ~6.5" (9360 twips) for the checkbox column
 *   - <w:keepLines/> so question + checkboxes never split across pages
 *
 * Operates on the <w:pPr> block. Adds <w:pPr> if missing. Idempotent.
 */
function injectQuestionPPr(pXml: string): string {
  const TAB_XML = `<w:tabs><w:tab w:val="right" w:leader="none" w:pos="9360"/></w:tabs>`;
  const KEEP   = `<w:keepLines/>`;
  const open = pXml.match(/^<w:p\b[^>]*?>/);
  if (!open) return pXml;
  const pprMatch = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
  if (!pprMatch) {
    const pPr = `<w:pPr>${KEEP}${TAB_XML}</w:pPr>`;
    return pXml.replace(open[0], `${open[0]}${pPr}`);
  }
  let inner = pprMatch[1];
  // Replace existing <w:tabs>...</w:tabs> with one that includes our right tab.
  if (/<w:tabs\b/.test(inner)) {
    inner = inner.replace(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/, TAB_XML);
  } else {
    inner = TAB_XML + inner;
  }
  if (!/<w:keepLines\s*\/>/.test(inner)) {
    inner = KEEP + inner;
  }
  return pXml.replace(pprMatch[0], `<w:pPr>${inner}</w:pPr>`);
}

/**
 * Append a TAB run + the YES/NO checkbox runs into the question paragraph,
 * before its closing </w:p>. The YES and NO runs come from the source
 * paragraphs; a single non-breaking-space run sits between them.
 */
function appendCheckboxRuns(
  questionXml: string,
  yesInner: string,
  noInner: string,
): string {
  const rPr = lastRPr(questionXml + yesInner);
  const tabRun  = `<w:r>${rPr}<w:tab/></w:r>`;
  const nbspRun = `<w:r>${rPr}<w:t xml:space="preserve">\u00A0</w:t></w:r>`;
  const injected = `${tabRun}${yesInner}${nbspRun}${noInner}`;
  return questionXml.replace(/<\/w:p>\s*$/, `${injected}</w:p>`);
}

function processXml(xml: string): {
  xml: string;
  questionsRewritten: number;
  paragraphsDropped: number;
} {
  const paras = splitParagraphs(xml);
  if (paras.length === 0) {
    return { xml, questionsRewritten: 0, paragraphsDropped: 0 };
  }

  const drop = new Set<number>();
  const rewrite = new Map<number, string>();

  let questionsRewritten = 0;

  for (let i = 0; i < paras.length; i++) {
    if (drop.has(i)) continue;
    const q = paras[i];

    // Identify which family this question (if any) belongs to.
    const fam = FAMILIES.find(f => f.phrase.test(q.stripped));
    if (!fam) continue;

    // Idempotency: question already absorbed the YES glyph for this family.
    if (hasGlyph(q.stripped, fam.family, "yes")) continue;

    // Look ahead up to ~8 paragraphs for source paragraphs containing
    // _yes_glyph and _no_glyph for the SAME family. They may be:
    //   (a) one paragraph with both glyphs (already-inline merge), or
    //   (b) two paragraphs, possibly with blanks between them.
    let yesIdx = -1;
    let noIdx  = -1;
    let inlineIdx = -1;
    const intermediates: number[] = [];

    for (let j = i + 1; j < paras.length && j <= i + 8; j++) {
      if (drop.has(j)) continue;
      const pj = paras[j];
      const sj = pj.stripped;
      const hasYes = hasGlyph(sj, fam.family, "yes");
      const hasNo  = hasGlyph(sj, fam.family, "no");
      if (hasYes && hasNo) { inlineIdx = j; break; }
      if (hasYes && yesIdx < 0) { yesIdx = j; continue; }
      if (hasNo  && noIdx  < 0 && yesIdx >= 0) { noIdx = j; break; }
      // Track strictly-blank intermediates we'd be willing to delete.
      if (sj.trim() === "") { intermediates.push(j); continue; }
      // Any other glyph family / non-blank content → stop walking; we won't
      // grab tags from a different question's row.
      const otherFamilyHit = FAMILIES.some(f =>
        f.family !== fam.family &&
        (hasGlyph(sj, f.family, "yes") || hasGlyph(sj, f.family, "no"))
      );
      if (otherFamilyHit) break;
      // Non-empty unrelated text (e.g. another question line) → stop.
      break;
    }

    let yesInner = "";
    let noInner  = "";
    const sourcesToDrop: number[] = [];

    if (inlineIdx >= 0) {
      // Single source paragraph already has both glyphs inline.
      // Splice the runs as-is (preserves the existing NBSP between them).
      yesInner = paragraphInnerRuns(paras[inlineIdx].text);
      sourcesToDrop.push(inlineIdx);
    } else if (yesIdx >= 0 && noIdx >= 0) {
      yesInner = paragraphInnerRuns(paras[yesIdx].text);
      noInner  = paragraphInnerRuns(paras[noIdx].text);
      sourcesToDrop.push(yesIdx, noIdx);
    } else {
      continue; // no matching checkbox sources — skip this question
    }

    // Compose the new question paragraph.
    let newQ = injectQuestionPPr(q.text);
    if (inlineIdx >= 0) {
      // For inline source we already have YES + NBSP + NO inside yesInner.
      const rPr = lastRPr(newQ + yesInner);
      const tabRun = `<w:r>${rPr}<w:tab/></w:r>`;
      newQ = newQ.replace(/<\/w:p>\s*$/, `${tabRun}${yesInner}</w:p>`);
    } else {
      newQ = appendCheckboxRuns(newQ, yesInner, noInner);
    }

    rewrite.set(i, newQ);
    for (const k of sourcesToDrop) drop.add(k);
    // Also drop blank paragraphs strictly between the question and the
    // last consumed source (so we don't leave gaps).
    const lastSrc = Math.max(...sourcesToDrop);
    for (const k of intermediates) {
      if (k > i && k < lastSrc) drop.add(k);
    }
    questionsRewritten++;
  }

  if (rewrite.size === 0 && drop.size === 0) {
    return { xml, questionsRewritten: 0, paragraphsDropped: 0 };
  }

  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!rewrite.has(i) && !drop.has(i)) continue;
    out.push(xml.slice(cursor, p.start));
    if (rewrite.has(i)) out.push(rewrite.get(i)!);
    cursor = p.end;
  }
  out.push(xml.slice(cursor));

  return {
    xml: out.join(""),
    questionsRewritten,
    paragraphsDropped: drop.size,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const url = new URL(req.url);
    if (url.searchParams.get("inspect") === "1") {
      const paras = splitParagraphs(originalXml);
      const sample: any[] = [];
      for (let i = 0; i < paras.length; i++) {
        const s = paras[i].stripped;
        const famHit = FAMILIES.find(f => f.phrase.test(s));
        const yesHit = FAMILIES.find(f => hasGlyph(s, f.family, "yes"));
        const noHit  = FAMILIES.find(f => hasGlyph(s, f.family, "no"));
        if (famHit || yesHit || noHit) {
          sample.push({
            i,
            q: famHit?.family,
            y: yesHit?.family,
            n: noHit?.family,
            t: s.slice(0, 80),
          });
        }
      }
      return new Response(JSON.stringify({ sample }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { xml: newXml, questionsRewritten, paragraphsDropped } =
      processXml(originalXml);

    if (newXml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          questionsRewritten: 0,
          paragraphsDropped: 0,
          message: "Template already laid out — no changes written.",
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
        questionsRewritten,
        paragraphsDropped,
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

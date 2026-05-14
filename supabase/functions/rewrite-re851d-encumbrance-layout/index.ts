// One-shot template rewrite for the RE851D ENCUMBRANCE INFORMATION section.
//
// The RE851D document body uses a multi-column section: question text
// flows in the LEFT column, YES/NO checkbox glyphs flow in the RIGHT
// column. A previous pass already merged each YES + NO into a single
// paragraph (joined by `&#160;`), but they still render LEFT-aligned
// inside the right column, which produces the broken look in the
// generated document.
//
// This rewrite right-aligns those merged YES/NO paragraphs so the
// checkbox pair snaps to the column's right edge, matching the
// reference layout in `re851d - LPDS Multi-property.docx`. We also
// add `<w:keepLines/>` so a YES/NO row never wraps internally.
//
// Strictly scoped — only paragraphs whose stripped text contains BOTH
// `pr_li_<family>_N_yes_glyph` and `pr_li_<family>_N_no_glyph` for one
// of the four families are touched. Idempotent: if `<w:jc w:val="right"/>`
// is already present, the paragraph is left alone.

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

/**
 * Ensure the paragraph's <w:pPr> contains:
 *   - <w:jc w:val="right"/>
 *   - <w:keepLines/>
 * Adds <w:pPr> if missing, replaces an existing <w:jc> if present.
 * Idempotent.
 */
function rightAlignAndKeep(pXml: string): { xml: string; changed: boolean } {
  const open = pXml.match(/^<w:p\b[^>]*?>/);
  if (!open) return { xml: pXml, changed: false };
  const JC   = `<w:jc w:val="right"/>`;
  const KEEP = `<w:keepLines/>`;
  const pprMatch = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
  if (!pprMatch) {
    const pPr = `<w:pPr>${KEEP}${JC}</w:pPr>`;
    return { xml: pXml.replace(open[0], `${open[0]}${pPr}`), changed: true };
  }
  let inner = pprMatch[1];
  let mutated = false;
  if (/<w:jc\b[^>]*\/>/.test(inner)) {
    if (!/<w:jc[^>]*w:val="right"/.test(inner)) {
      inner = inner.replace(/<w:jc\b[^>]*\/>/, JC);
      mutated = true;
    }
  } else {
    inner = inner + JC;
    mutated = true;
  }
  if (!/<w:keepLines\s*\/>/.test(inner)) {
    inner = KEEP + inner;
    mutated = true;
  }
  if (!mutated) return { xml: pXml, changed: false };
  return {
    xml: pXml.replace(pprMatch[0], `<w:pPr>${inner}</w:pPr>`),
    changed: true,
  };
}

function processXml(xml: string): {
  xml: string;
  paragraphsRightAligned: number;
} {
  const paras = splitParagraphs(xml);
  if (paras.length === 0) return { xml, paragraphsRightAligned: 0 };

  const rewrite = new Map<number, string>();
  let count = 0;

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const fam = familyFor(p.stripped);
    if (!fam) continue;
    const { xml: nx, changed } = rightAlignAndKeep(p.text);
    if (!changed) continue;
    rewrite.set(i, nx);
    count++;
  }

  if (rewrite.size === 0) return { xml, paragraphsRightAligned: 0 };

  const out: string[] = [];
  let cursor = 0;
  for (let i = 0; i < paras.length; i++) {
    if (!rewrite.has(i)) continue;
    const p = paras[i];
    out.push(xml.slice(cursor, p.start));
    out.push(rewrite.get(i)!);
    cursor = p.end;
  }
  out.push(xml.slice(cursor));

  return { xml: out.join(""), paragraphsRightAligned: count };
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
      const counts: Record<string, number> = {};
      const samples: Array<{ i: number; pPr: string; text: string }> = [];
      for (let i = 0; i < paras.length; i++) {
        const s = paras[i].stripped;
        for (const f of FAMILIES) {
          const yes = new RegExp(`pr_li_${f}_N_yes_glyph`).test(s);
          const no  = new RegExp(`pr_li_${f}_N_no_glyph`).test(s);
          if (yes || no) {
            const k = `${f}:${yes ? "Y" : ""}${no ? "N" : ""}`;
            counts[k] = (counts[k] || 0) + 1;
            if (samples.length < 6) {
              const ppr = paras[i].text.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
              samples.push({ i, pPr: ppr?.[0] || "(none)", text: s.slice(0, 100) });
            }
          }
        }
      }
      return new Response(JSON.stringify({ counts, samples }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { xml: newXml, paragraphsRightAligned } = processXml(originalXml);

    if (newXml === originalXml) {
      return new Response(
        JSON.stringify({
          ok: true,
          templatePath,
          paragraphsRightAligned: 0,
          message: "Template already right-aligned — no changes written.",
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
        paragraphsRightAligned,
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

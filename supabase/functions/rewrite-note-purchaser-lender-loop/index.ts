// One-shot admin function: ensures the Note Purchaser Qualification Checklist
// template's SIGNATURE-REGION lender block (the paragraph immediately above
// "Signature: ___" / "Date: ___") renders the PRIMARY lender only, with the
// expected two-line layout — "Lender: " then a <w:br/> then the primary
// display name. The append loop in generate-document/index.ts produces
// Lender 2..N blocks by cloning this paragraph; if the primary paragraph is
// wrong, all cloned blocks inherit the bug.
//
// History:
//   v1 — replaced the {{#if (eq ld_p_lenderType ...)}} {{else}} {{/if}} block
//        with a {{#each lenders}}{{this.displayName}}{{/each}} loop. WRONG:
//        the body "Lender Name:" field at the top of the template was already
//        a {{#each lenders}} block (paragraphs 2..8), so the per-lender body
//        expansion was never broken. The {{#if}} block this function actually
//        replaced was the *signature region's primary-name slot*, and turning
//        it into a loop caused the primary signature line to render all four
//        lender names stacked AND stripped the "Lender:" label + <w:br/>
//        run structure that the append loop relies on as a clone template.
//   v2 — bumped marker only; structural bug from v1 still in place.
//   v3 — (this file) restores the signature-region paragraph to the correct
//        single-primary-lender layout:
//          <w:p>{originalPPr}
//            <w:r>{rPr}<w:t xml:space="preserve">Lender: </w:t></w:r>
//            <w:r>{rPr}<w:t/><w:br/><w:t>{{ ld_p_displayName }}</w:t>
//                     <w:br/><w:t/></w:r>
//          </w:p>
//        Idempotent: re-runs on v1/v2/v3 by detecting either the marker or
//        the stale loop literal and rewriting in place.
//
// Body "Lender Name:" field (paragraphs ~2..8) is left UNTOUCHED — it already
// uses {{#each lenders}}{{#if ...}}{{this.firstName}}...{{else}}{{this.vesting}}{{/if}}{{/each}}.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_ID = "680299de-f1eb-4a63-9b31-4b7b70c66948";

const MARKER_V1 = "<!-- note-purchaser-lender-loop:v1 -->";
const MARKER_V2 = "<!-- note-purchaser-lender-loop:v2 -->";
const MARKER_V3 = "<!-- note-purchaser-lender-loop:v3 -->";
const MARKER_V4 = "<!-- note-purchaser-lender-loop:v4 -->";
const STALE_LOOP_LITERAL =
  "{{#each lenders}}{{this.displayName}}{{/each}}";

function visibleText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [])
    .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
    .join("");
}

/**
 * Build the corrected signature-region primary paragraph. Preserves the
 * source paragraph's <w:pPr> and the first run's <w:rPr> so font, indent and
 * spacing match the template exactly.
 *
 * Layout is two runs in one paragraph:
 *   run 1: "Lender: " (literal, with xml:space="preserve")
 *   run 2: <w:t/><w:br/><w:t>{{ ld_p_displayName }}</w:t><w:br/><w:t/>
 *
 * The generic appender in generate-document/index.ts clones this paragraph
 * for Lender 2..N and substitutes only the label run's text ("Lender: " ->
 * "Lender N: ") and the name <w:t>; the <w:br/> structure is preserved.
 */
function buildPrimaryParagraph(
  sourcePXml: string,
  formattingAnchorPXml?: string,
): string {
  // Prefer the formatting anchor (the Signature paragraph, BodyText style)
  // because the stale v1 paragraph this is replacing has no pPr/rPr at all.
  const anchor = formattingAnchorPXml || sourcePXml;
  const pPrMatch = anchor.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  // Strip <w:jc w:val="both"/> → "left" on the primary lender paragraph.
  // The label/name pair uses <w:br/> soft line breaks, and full justification
  // on a paragraph containing <w:br/> stretches every line except the last,
  // producing "Horizon    Capital    LLC" output. See note-purchaser-lender-
  // loop:v4. Labels and names are fixed short strings — left-aligned is the
  // visually correct choice and matches the appended Lender 2..N blocks.
  const pPr = pPrMatch
    ? pPrMatch[0].replace(
        /<w:jc\b[^>]*\bw:val="both"[^>]*\/>/g,
        '<w:jc w:val="left"/>',
      )
    : "";
  const firstRun = anchor.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/);
  const rPrMatch = firstRun ? firstRun[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) : null;
  const rPr = rPrMatch ? rPrMatch[0] : "";
  return (
    `<w:p>${pPr}` +
      `<w:r>${rPr}<w:t xml:space="preserve">Lender: </w:t></w:r>` +
      `<w:r>${rPr}` +
        `<w:t></w:t>` +
        `<w:br/>` +
        `<w:t xml:space="preserve">{{ ld_p_displayName }}</w:t>` +
        `<w:br/>` +
        `<w:t></w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}


function rewriteDocumentXml(
  xml: string,
): { xml: string; replaced: number; note: string } {
  // Note: we no longer early-exit on MARKER_V3 — re-running may be needed to
  // refresh formatting (e.g. the paragraph 32 written by the first v3 pass
  // had empty pPr/rPr because it was built from a minimal v1 source).


  // Collect all <w:p> spans with their visible text.
  const pRe = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;
  type Para = { start: number; end: number; xml: string; text: string };
  const paras: Para[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    paras.push({
      start: m.index,
      end: m.index + m[0].length,
      xml: m[0],
      text: visibleText(m[0]),
    });
  }

  // Locate the SIGNATURE-REGION primary paragraph. Strategy: find the
  // "Signature: ___" paragraph, then walk backwards a few paragraphs looking
  // for either:
  //   (a) the stale loop literal added by v1/v2 (single paragraph), OR
  //   (b) the original {{#if (eq ld_p_lenderType ...)}} ... {{/if}} block
  //       (possibly split across paragraphs), OR
  //   (c) an existing v3-style "Lender: ... {{ld_p_displayName}}" paragraph
  //       (idempotent re-application path).
  const sigIdx = paras.findIndex((p) => /\bSignature\s*:/i.test(p.text));
  if (sigIdx === -1) {
    return { xml, replaced: 0, note: "Signature paragraph not found" };
  }

  // (a) Stale loop literal directly above Signature?
  for (let i = sigIdx - 1; i >= Math.max(0, sigIdx - 4); i--) {
    if (paras[i].text.includes(STALE_LOOP_LITERAL)) {
      const replacement = buildPrimaryParagraph(paras[i].xml, paras[sigIdx].xml);
      const before = xml.substring(0, paras[i].start);
      const after = xml.substring(paras[i].end);
      let out = before + replacement + after;
      out = out.replace(MARKER_V1, "").replace(MARKER_V2, "");
      out = out.replace(/<\/w:body>/, `${MARKER_V3}</w:body>`);
      return { xml: out, replaced: 1, note: `rewrote stale loop literal at paragraph ${i}` };
    }
  }

  // (c) v3-style primary already present. If it's missing pPr/rPr (which can
  // happen when the first v3 pass built it from a stripped v1 source), or if
  // the caller wants a forced refresh, re-emit using the Signature paragraph
  // as the formatting anchor. Otherwise just refresh the marker.
  for (let i = sigIdx - 1; i >= Math.max(0, sigIdx - 4); i--) {
    if (
      /Lender\s*:/i.test(paras[i].text) &&
      paras[i].text.includes("ld_p_displayName") &&
      paras[i].xml.includes("<w:br/>")
    ) {
      const hasPPr = /<w:pPr>/.test(paras[i].xml);
      const hasRPr = /<w:rPr>/.test(paras[i].xml);
      if (!hasPPr || !hasRPr) {
        const replacement = buildPrimaryParagraph(paras[i].xml, paras[sigIdx].xml);
        const before = xml.substring(0, paras[i].start);
        const after = xml.substring(paras[i].end);
        let out = before + replacement + after;
        out = out.replace(MARKER_V1, "").replace(MARKER_V2, "");
        if (!out.includes(MARKER_V3)) {
          out = out.replace(/<\/w:body>/, `${MARKER_V3}</w:body>`);
        }
        return { xml: out, replaced: 1, note: `refreshed v3 primary paragraph ${i} formatting from Signature anchor` };
      }
      let out = xml.replace(MARKER_V1, "").replace(MARKER_V2, "");
      if (!out.includes(MARKER_V3)) {
        out = out.replace(/<\/w:body>/, `${MARKER_V3}</w:body>`);
      }
      return { xml: out, replaced: 0, note: `v3 primary paragraph already present at ${i} with formatting; marker refreshed` };
    }
  }


  // (b) Original {{#if (eq ld_p_lenderType ...)}} block (may span paragraphs).
  let startIdx = -1;
  let endIdx = -1;
  for (let i = Math.max(0, sigIdx - 12); i < sigIdx; i++) {
    if (
      paras[i].text.includes("{{#if") &&
      (paras[i].text.includes("ld_p_lenderType") ||
        paras[i].text.includes("ld_p_firstIfEntityUse") ||
        paras[i].text.includes("ld_p_vesting"))
    ) {
      startIdx = i;
      break;
    }
  }
  if (startIdx !== -1) {
    let acc = "";
    for (let j = startIdx; j < Math.min(paras.length, startIdx + 12); j++) {
      acc += paras[j].text;
      const opens = (acc.match(/\{\{#if/g) || []).length;
      const closes = (acc.match(/\{\{\/if\}\}/g) || []).length;
      if (closes >= opens && closes > 0) { endIdx = j; break; }
    }
  }
  if (startIdx !== -1 && endIdx !== -1) {
    const replacement = buildPrimaryParagraph(paras[startIdx].xml, paras[sigIdx].xml);
    const before = xml.substring(0, paras[startIdx].start);
    const after = xml.substring(paras[endIdx].end);
    let out = before + replacement + after;
    out = out.replace(/<\/w:body>/, `${MARKER_V3}</w:body>`);
    return {
      xml: out,
      replaced: endIdx - startIdx + 1,
      note: `rewrote original {{#if}} block paragraphs ${startIdx}..${endIdx}`,
    };
  }

  return { xml, replaced: 0, note: "no matching signature-region paragraph found" };
}

async function rewriteTemplate(
  supabase: ReturnType<typeof createClient>,
  templateId: string,
  force: boolean,
): Promise<Record<string, unknown>> {
  const { data: row, error: rowErr } = await supabase
    .from("templates")
    .select("id, name, file_path")
    .eq("id", templateId)
    .maybeSingle();
  if (rowErr) throw new Error(`templates lookup failed: ${rowErr.message}`);
  if (!row) return { templateId, skipped: "template row not found" };
  if (!row.file_path) return { templateId, skipped: "no file_path on template" };

  const { data: blob, error: dlErr } = await supabase.storage
    .from("templates")
    .download(row.file_path);
  if (dlErr || !blob) {
    throw new Error(`download failed: ${dlErr?.message || "no blob"}`);
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  const unzipped = fflate.unzipSync(buf);
  const docPath = "word/document.xml";
  if (!unzipped[docPath]) {
    return { templateId, skipped: "no word/document.xml" };
  }
  const docXml = new TextDecoder().decode(unzipped[docPath]);

  if (!force && docXml.includes(MARKER_V3)) {
    return { templateId, name: row.name, skipped: "already at v3" };
  }

  const { xml: nextXml, replaced, note } = rewriteDocumentXml(docXml);
  if (replaced === 0 && nextXml === docXml) {
    return { templateId, name: row.name, replaced: 0, note };
  }

  unzipped[docPath] = new TextEncoder().encode(nextXml);
  const rezipped = fflate.zipSync(unzipped, { level: 6 });

  const { error: upErr } = await supabase.storage
    .from("templates")
    .upload(row.file_path, rezipped, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);

  return {
    templateId,
    name: row.name,
    file_path: row.file_path,
    replaced,
    note,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let body: { templateId?: string; force?: boolean } = {};
    try {
      body = await req.json();
    } catch (_) {
      // empty body is fine
    }

    const targets = body.templateId ? [body.templateId] : [TEMPLATE_ID];
    const force = body.force === true;
    const results: unknown[] = [];
    for (const id of targets) {
      try {
        results.push(await rewriteTemplate(supabase, id, force));
      } catch (e) {
        results.push({ templateId: id, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

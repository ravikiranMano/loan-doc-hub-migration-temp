// One-shot rewrite of the "ADDENDUM TO NOTE EVENT OF DEFAULT" template.
//
// The Option 1 / Option 2 text and the red helper sentence all live INSIDE
// the single "Remedies Upon Event of Default..." paragraph. So we cannot
// replace the whole paragraph — we must surgically replace just the text
// segment that runs from "Option 1:" up to and including the closing of the
// helper "...in "Loan")", while preserving the legal prefix and suffix.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_NAME = "ADDENDUM TO NOTE EVENT OF DEFAULT";

// Final conditional segment that replaces "Option 1: ... Option 2: ... (this is conditional ... "Loan")"
// Uses straight ASCII quotes inside `(the "Default Rate").` to match the
// existing template style; downstream rendering preserves them.
const CONDITIONAL_SEGMENT =
  '{{#if ln_p_defaultInterestModifierEnabled}}to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.{{else if ln_p_defaultInterestFlatRateEnabled}}to a flat rate of {{ln_p_defaultInterestFlatRate}}%{{/if}} (the "Default Rate").';

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const verify = url.searchParams.get("verify") === "1";
  const dump = url.searchParams.get("dump") === "1";

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tpl, error: tplErr } = await supabase
      .from("templates")
      .select("id, name, file_path")
      .eq("name", TEMPLATE_NAME)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr || !tpl) throw new Error(`template lookup failed: ${tplErr?.message}`);
    if (!tpl.file_path) throw new Error("template has no file_path");

    const { data: blob, error: dlErr } = await supabase.storage
      .from("templates")
      .download(tpl.file_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
    const inputBytes = new Uint8Array(await blob.arrayBuffer());

    const unzipped = fflate.unzipSync(inputBytes);
    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) throw new Error("word/document.xml not found");
    const originalXml = new TextDecoder().decode(docXmlBytes);

    if (verify) {
      // Inspect target paragraph text for verification markers.
      const flat = flattenParagraphsContaining(originalXml, [
        "ln_p_defaultInterestModifier",
        "ln_p_defaultInterestFlatRate",
      ]);
      return new Response(
        JSON.stringify(
          {
            file_path: tpl.file_path,
            paragraph_text: flat,
            has_if: flat.includes("{{#if ln_p_defaultInterestModifierEnabled}}"),
            has_elseif: flat.includes("{{else if ln_p_defaultInterestFlatRateEnabled}}"),
            has_default_rate_outside: /\{\{\/if\}\}\s*\(the\s+["“]Default Rate["”]\)\./.test(flat),
            still_has_option1: /Option\s*1\s*:/i.test(flat),
            still_has_option2: /Option\s*2\s*:/i.test(flat),
            still_has_helper: /this is conditional based on/i.test(flat),
          },
          null,
          2,
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dump) {
      const paras: string[] = [];
      const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paraRe.exec(originalXml)) !== null) {
        const text = extractParagraphText(pm[0]);
        if (text.trim()) paras.push(text);
      }
      return new Response(JSON.stringify({ paragraphs: paras }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { xml: newXml, report } = rewriteDocumentXml(originalXml);

    if (report.changes === 0 || dryRun) {
      return new Response(
        JSON.stringify({ ok: false, dryRun, message: "no upload", report }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    unzipped["word/document.xml"] = new TextEncoder().encode(newXml);
    const outBytes = fflate.zipSync(unzipped);

    const versionMatch = tpl.file_path.match(/_v(\d+)\.docx$/i);
    const nextVersion = versionMatch ? parseInt(versionMatch[1], 10) + 1 : 2;
    const newPath = versionMatch
      ? tpl.file_path.replace(/_v\d+\.docx$/i, `_v${nextVersion}.docx`)
      : tpl.file_path.replace(/\.docx$/i, `_v${nextVersion}.docx`);

    const { error: upErr } = await supabase.storage
      .from("templates")
      .upload(newPath, outBytes, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    const { error: updErr } = await supabase
      .from("templates")
      .update({ file_path: newPath })
      .eq("id", tpl.id);
    if (updErr) throw new Error(`template row update failed: ${updErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, oldPath: tpl.file_path, newPath, report }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[rewrite-addendum-default-template]", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------
// Rewrite logic
// ---------------------------------------------------------------------------

function rewriteDocumentXml(xml: string): { xml: string; report: any } {
  const report = {
    changes: 0,
    paragraphsInspected: 0,
    targetParagraphMatched: false,
    alreadyConditional: false,
    optionStart: -1,
    helperEnd: -1,
    flatTextBefore: "",
  };

  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  const out = xml.replace(paraRe, (paraXml) => {
    report.paragraphsInspected++;
    const text = extractParagraphText(paraXml);
    if (!text) return paraXml;

    const hasOpt1 = /Option\s*1\s*:/i.test(text);
    const hasOpt2 = /Option\s*2\s*:/i.test(text);
    const hasHelper = /this is conditional based on/i.test(text);
    const hasAnyOptionMarker = hasOpt1 || hasOpt2 || hasHelper;

    // Idempotency: paragraph already has conditional and no legacy markers.
    if (
      text.includes("{{#if ln_p_defaultInterestModifierEnabled}}") &&
      !hasOpt1 &&
      !hasOpt2 &&
      !hasHelper
    ) {
      report.alreadyConditional = true;
      return paraXml;
    }

    if (!hasAnyOptionMarker) return paraXml;

    report.targetParagraphMatched = true;
    report.flatTextBefore = text;

    // Locate the start of "Option 1:" (or whichever option marker appears first).
    // Locate the end of the helper sentence: the closing `)` of `...in "Loan")`.
    // Also tolerate the case where the helper is absent.
    const opt1Idx = matchIndex(text, /Option\s*1\s*:/i);
    const opt2Idx = matchIndex(text, /Option\s*2\s*:/i);
    const helperIdx = matchIndex(text, /\(\s*this is conditional based on/i);

    const candidates = [opt1Idx, opt2Idx, helperIdx].filter((n) => n >= 0);
    if (candidates.length === 0) return paraXml;
    let segStart = Math.min(...candidates);

    // Trim any leading whitespace that immediately precedes the segment so we
    // don't duplicate spaces (the prefix already ends with "...shall increase ").
    while (segStart > 0 && /\s/.test(text[segStart - 1])) segStart--;
    // Re-add exactly one space.
    const needsLeadingSpace = segStart > 0 && !text.slice(0, segStart).endsWith(" ");

    // Find segment end: after the helper's closing `)` if helper exists,
    // otherwise after the "(the \"Default Rate\")." phrase if present,
    // otherwise after the last option-related closing paren.
    let segEnd = -1;
    if (helperIdx >= 0) {
      // Find the closing `)` after the helper phrase.
      const close = text.indexOf(")", helperIdx);
      if (close >= 0) segEnd = close + 1;
    }
    if (segEnd < 0) {
      // Fall back to end of `(the "Default Rate").`
      const m = /\(the\s+["“]Default Rate["”]\)\./.exec(text);
      if (m) segEnd = m.index + m[0].length;
    }
    if (segEnd < 0) return paraXml; // nothing safe to do

    report.optionStart = segStart;
    report.helperEnd = segEnd;

    const prefix = text.slice(0, segStart);
    const suffix = text.slice(segEnd);

    const middle = (needsLeadingSpace ? " " : "") + CONDITIONAL_SEGMENT;
    const newParaText = prefix + middle + suffix;

    report.changes++;
    return rebuildParagraphWithText(paraXml, newParaText);
  });

  return { xml: out, report };
}

function matchIndex(s: string, re: RegExp): number {
  const m = re.exec(s);
  return m ? m.index : -1;
}

function extractParagraphText(paraXml: string): string {
  const parts: string[] = [];
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(paraXml)) !== null) {
    parts.push(decodeXml(m[1]));
  }
  return parts.join("");
}

/**
 * Rebuild the paragraph: preserve `<w:pPr>` if any, reuse the first run's
 * `<w:rPr>` for formatting continuity, and emit a single run carrying the new
 * full paragraph text. This guarantees red/bold runs from the original Option
 * labels and helper are dropped, since we use only the first (legal-text) run's
 * properties.
 */
function rebuildParagraphWithText(paraXml: string, newText: string): string {
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";

  const firstRunRPr = (() => {
    const runMatch = paraXml.match(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/);
    if (!runMatch) return "";
    const rPrMatch = runMatch[1].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    return rPrMatch ? rPrMatch[0] : "";
  })();

  const openMatch = paraXml.match(/^<w:p(?:\s[^>]*)?>/);
  const open = openMatch ? openMatch[0] : "<w:p>";

  const newRun =
    `<w:r>${firstRunRPr}<w:t xml:space="preserve">${escapeXmlText(newText)}</w:t></w:r>`;

  return `${open}${pPr}${newRun}</w:p>`;
}

function flattenParagraphsContaining(xml: string, needles: string[]): string {
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    const text = extractParagraphText(pm[0]);
    if (needles.every((n) => text.includes(n))) return text;
  }
  // Fallback: any paragraph mentioning at least one needle
  paraRe.lastIndex = 0;
  while ((pm = paraRe.exec(xml)) !== null) {
    const text = extractParagraphText(pm[0]);
    if (needles.some((n) => text.includes(n))) return text;
  }
  return "";
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

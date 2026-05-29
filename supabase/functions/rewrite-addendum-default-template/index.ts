// One-shot rewrite of the "ADDENDUM TO NOTE EVENT OF DEFAULT" template.
// Fixes:
//   Bug 2 — Adds missing "({{ln_p_defaultInterestModifier}}%)" in Option 1.
//   Bug 3 — Wraps Option 1 / Option 2 in {{#if}} / {{else if}} / {{/if}},
//           removes "Option 1:" / "Option 2:" labels, and removes the red
//           helper paragraph "(this is conditional based on…)".
// Field key names are not changed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_NAME = "ADDENDUM TO NOTE EVENT OF DEFAULT";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const dump = url.searchParams.get("dump") === "1";

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Load template row by name (the active row id can change over time).
    const { data: tpl, error: tplErr } = await supabase
      .from("templates")
      .select("id, name, file_path")
      .eq("name", TEMPLATE_NAME)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr || !tpl) throw new Error(`template lookup failed: ${tplErr?.message}`);
    if (!tpl.file_path) throw new Error("template has no file_path");

    // 2. Download docx.
    const { data: blob, error: dlErr } = await supabase.storage
      .from("templates")
      .download(tpl.file_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
    const inputBytes = new Uint8Array(await blob.arrayBuffer());

    // 3. Unzip, edit document.xml, re-zip.
    const unzipped = fflate.unzipSync(inputBytes);
    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) throw new Error("word/document.xml not found");
    const originalXml = new TextDecoder().decode(docXmlBytes);

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
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    unzipped["word/document.xml"] = new TextEncoder().encode(newXml);
    const outBytes = fflate.zipSync(unzipped);

    // 4. Upload as new version.
    const versionMatch = tpl.file_path.match(/_v(\d+)\.docx$/i);
    const nextVersion = versionMatch ? parseInt(versionMatch[1], 10) + 1 : 2;
    const newPath = tpl.file_path.replace(/_v\d+\.docx$/i, `_v${nextVersion}.docx`);

    const { error: upErr } = await supabase.storage
      .from("templates")
      .upload(newPath, outBytes, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    // 5. Point template row at new file.
    const { error: updErr } = await supabase
      .from("templates")
      .update({ file_path: newPath })
      .eq("id", tpl.id);
    if (updErr) throw new Error(`template row update failed: ${updErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, oldPath: tpl.file_path, newPath, report }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[rewrite-addendum-default-template]", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Rewrite the document XML to apply Bug 2 and Bug 3 fixes.
 *
 * Strategy:
 *  - Walk paragraph-by-paragraph (<w:p>…</w:p>).
 *  - For each paragraph, extract the visible text by concatenating <w:t> runs.
 *  - Detect Option 1, Option 2, and the red helper paragraphs.
 *  - Replace the entire Option-1 paragraph with the conditional Option-1 block
 *    (still containing {{#if}} … and the Option-1 sentence).
 *  - Replace the Option-2 paragraph with the {{else if}} block and the
 *    Option-2 sentence, ending with {{/if}}(the "Default Rate").
 *  - Delete the red helper paragraph entirely.
 *
 * We rewrite each affected paragraph by replacing all <w:r>…</w:r> runs in it
 * with a single clean run whose text matches the target. We reuse the
 * paragraph's first <w:rPr> for formatting if present.
 */
function rewriteDocumentXml(xml: string): { xml: string; report: any } {
  const report = {
    changes: 0,
    sentenceReplaced: false,
    helperRemoved: false,
    option2ParagraphRemoved: false,
    paragraphsInspected: 0,
  };

  const FULL_SENTENCE =
    '{{#if ln_p_defaultInterestModifierEnabled}}to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.{{else if ln_p_defaultInterestFlatRateEnabled}}to a flat rate of {{ln_p_defaultInterestFlatRate}}%{{/if}} (the "Default Rate").';

  // Match a <w:p ...>...</w:p> paragraph (non-greedy).
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  const out = xml.replace(paraRe, (paraXml) => {
    report.paragraphsInspected++;
    const text = extractParagraphText(paraXml);
    if (!text.trim()) return paraXml;

    const flat = text.replace(/\s+/g, " ").trim();

    // ---------- Red helper paragraph (remove entirely) ----------
    if (
      /this is conditional based on the selection made in/i.test(flat) &&
      /Default Interest/i.test(flat) &&
      /Penalties/i.test(flat)
    ) {
      report.helperRemoved = true;
      report.changes++;
      return "";
    }

    // ---------- Standalone Option 2 paragraph (merge into Option 1's, remove) ----------
    if (
      /Option\s*2\s*:/i.test(flat) &&
      /ln_p_defaultInterestFlatRate/.test(flat) &&
      !/Option\s*1\s*:/i.test(flat)
    ) {
      report.option2ParagraphRemoved = true;
      report.changes++;
      return "";
    }

    // ---------- The Default-Interest sentence paragraph ----------
    // Match any paragraph that already drives Option 1 (matches original
    // "Option 1:" labelled form, the partially-rewritten {{#if}} form, or any
    // paragraph that mentions ln_p_defaultInterestModifier with no other content).
    const mentionsModifier = /ln_p_defaultInterestModifier(?!Enabled)/.test(flat);
    const isOption1Like =
      /Option\s*1\s*:/i.test(flat) ||
      /\{\{#if\s+ln_p_defaultInterestModifierEnabled\}\}/.test(flat) ||
      (mentionsModifier && /above the Note rate/i.test(flat));

    if (isOption1Like) {
      // Idempotency guard — already exactly correct.
      if (flat === FULL_SENTENCE.replace(/\s+/g, " ").trim()) return paraXml;
      report.sentenceReplaced = true;
      report.changes++;
      return rewriteParagraphText(paraXml, FULL_SENTENCE);
    }

    return paraXml;
  });

  return { xml: out, report };
}

function extractParagraphText(paraXml: string): string {
  const parts: string[] = [];
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(paraXml)) !== null) {
    parts.push(m[1]);
  }
  return parts.join("");
}

/**
 * Replace every <w:r>…</w:r> run in a paragraph with a single new run carrying
 * `newText`. Preserves <w:pPr> if present and reuses the first run's <w:rPr>
 * for character formatting continuity.
 */
function rewriteParagraphText(paraXml: string, newText: string): string {
  // Pull out pPr (paragraph properties) if any.
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";

  // Pull out the first run's rPr for formatting reuse.
  const firstRunRPr = (() => {
    const runMatch = paraXml.match(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/);
    if (!runMatch) return "";
    const rPrMatch = runMatch[1].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    return rPrMatch ? rPrMatch[0] : "";
  })();

  // Preserve <w:p ...> opening attributes.
  const openMatch = paraXml.match(/^<w:p(?:\s[^>]*)?>/);
  const open = openMatch ? openMatch[0] : "<w:p>";

  const newRun =
    `<w:r>${firstRunRPr}<w:t xml:space="preserve">${escapeXmlText(newText)}</w:t></w:r>`;

  return `${open}${pPr}${newRun}</w:p>`;
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

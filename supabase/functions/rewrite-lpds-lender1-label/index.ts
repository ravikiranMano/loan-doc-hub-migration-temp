// One-shot rewrite of the "Addendum to LPDS" template's Lender 1 label
// paragraph so it reads "Lender 1: <name>" instead of "Lender: <name>",
// and so the Individual branch no longer concatenates middle name with a
// stray trailing space.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_NAME = "Addendum to LPDS";

const LABEL_TEXT = "Lender 1: ";
const VALUE_EXPR =
  '{{#if (eq ld_p_lenderType "Individual")}}{{ld_p_firstIfEntityUse}} {{ld_p_last}}{{else}}{{ld_p_vesting}}{{/if}}';

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const verify = url.searchParams.get("verify") === "1";

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
      const flat = flattenFirstParagraphContaining(originalXml, "ld_p_lenderType");
      return new Response(
        JSON.stringify(
          {
            file_path: tpl.file_path,
            paragraph_text: flat,
            has_lender1: flat.startsWith("Lender 1:"),
            still_has_bare_lender: /^Lender:\s/.test(flat),
            still_has_middle_token: flat.includes("ld_p_middle"),
          },
          null,
          2,
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
    console.error("[rewrite-lpds-lender1-label]", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------

function rewriteDocumentXml(xml: string): { xml: string; report: any } {
  const report = {
    changes: 0,
    paragraphsInspected: 0,
    targetParagraphMatched: false,
    alreadyFixed: false,
    flatTextBefore: "",
  };

  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  const out = xml.replace(paraRe, (paraXml) => {
    report.paragraphsInspected++;
    const text = extractParagraphText(paraXml);
    if (!text) return paraXml;

    // Target the Lender 1 label paragraph: starts with "Lender" and
    // contains the ld_p_lenderType handlebars conditional.
    if (!text.includes("ld_p_lenderType")) return paraXml;
    if (!/^\s*Lender\b/.test(text)) return paraXml;

    if (text.startsWith("Lender 1:") && !text.includes("ld_p_middle")) {
      report.alreadyFixed = true;
      return paraXml;
    }

    report.targetParagraphMatched = true;
    report.flatTextBefore = text;

    // Capture original pPr and first two runs' rPr to preserve formatting.
    const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";

    const runs = [...paraXml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
    const firstRPr = runs[0]?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    const valueRPr = runs[1]?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? firstRPr;

    const openMatch = paraXml.match(/^<w:p(?:\s[^>]*)?>/);
    const open = openMatch ? openMatch[0] : "<w:p>";

    const newPara =
      `${open}${pPr}` +
      `<w:r>${firstRPr}<w:t xml:space="preserve">${escapeXmlText(LABEL_TEXT)}</w:t></w:r>` +
      `<w:r>${valueRPr}<w:t xml:space="preserve">${escapeXmlText(VALUE_EXPR)}</w:t></w:r>` +
      `</w:p>`;

    report.changes++;
    return newPara;
  });

  return { xml: out, report };
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

function flattenFirstParagraphContaining(xml: string, needle: string): string {
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    const text = extractParagraphText(pm[0]);
    if (text.includes(needle)) return text;
  }
  return "";
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

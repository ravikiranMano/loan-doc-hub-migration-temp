// One-shot: rewrite the "Addendum to LPDS" template so the primary lender's
// label reads "Lender 1: " (not "Lender: ") and strip any trailing whitespace
// from the rendered vesting value.
//
// Surgical, idempotent. Only touches the single paragraph that contains
// "Lender: " followed by the ld_p_* merge tags. Lender 2..N blocks are
// untouched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_NAME = "Addendum to LPDS";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

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
      .from("templates").download(tpl.file_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
    const inputBytes = new Uint8Array(await blob.arrayBuffer());

    const unzipped = fflate.unzipSync(inputBytes);
    const docBytes = unzipped["word/document.xml"];
    if (!docBytes) throw new Error("word/document.xml not found");
    const originalXml = new TextDecoder().decode(docBytes);

    const report = { labelChanged: 0, trailingTrimmed: 0, alreadyDone: false };

    // Find every paragraph and operate only on the primary lender one:
    // a paragraph whose visible text matches /^\s*Lender:\s*\{\{/ (i.e.
    // "Lender: " immediately followed by a Handlebars merge tag).
    const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let newXml = originalXml.replace(paraRe, (paraXml) => {
      const visible = extractVisibleText(paraXml);
      if (!/^\s*Lender:\s*\{\{/.test(visible)) {
        // Already rewritten? Skip and flag.
        if (/^\s*Lender\s+1:\s*\{\{/.test(visible)) report.alreadyDone = true;
        return paraXml;
      }

      let out = paraXml;

      // (1) Rewrite the first <w:t> containing literal "Lender: " → "Lender 1: ".
      // Preserve xml:space and surrounding rPr.
      out = out.replace(
        /(<w:t(?:\s[^>]*)?>)Lender:\s(<\/w:t>)/,
        (_m, open: string, close: string) => {
          report.labelChanged++;
          // Ensure xml:space="preserve" is present (it already is in this template).
          const openWithSpace = /xml:space=/.test(open)
            ? open
            : open.replace(/<w:t/, '<w:t xml:space="preserve"');
          return `${openWithSpace}Lender 1: ${close}`;
        },
      );

      // (2) Trim trailing whitespace from the LAST non-empty <w:t> in this
      // paragraph so the rendered value never carries a trailing space.
      const tTokens: Array<{ start: number; end: number; full: string; open: string; inner: string; close: string }> = [];
      const tRe = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(out)) !== null) {
        tTokens.push({
          start: tm.index,
          end: tm.index + tm[0].length,
          full: tm[0],
          open: tm[1],
          inner: tm[2],
          close: tm[3],
        });
      }
      for (let i = tTokens.length - 1; i >= 0; i--) {
        const t = tTokens[i];
        if (!t.inner.length) continue;
        const trimmed = t.inner.replace(/\s+$/, "");
        if (trimmed !== t.inner) {
          report.trailingTrimmed++;
          out = out.slice(0, t.start) + `${t.open}${trimmed}${t.close}` + out.slice(t.end);
        }
        break;
      }

      return out;
    });

    if (!report.labelChanged && !report.trailingTrimmed) {
      return new Response(
        JSON.stringify({ ok: true, noop: true, alreadyDone: report.alreadyDone, file_path: tpl.file_path }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, report }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    unzipped["word/document.xml"] = new TextEncoder().encode(newXml);
    const outBytes = fflate.zipSync(unzipped);

    const versionMatch = tpl.file_path.match(/_v(\d+)\.docx$/i);
    const nextVersion = versionMatch ? parseInt(versionMatch[1], 10) + 1 : 2;
    const newPath = versionMatch
      ? tpl.file_path.replace(/_v\d+\.docx$/i, `_v${nextVersion}.docx`)
      : tpl.file_path.replace(/\.docx$/i, `_v${nextVersion}.docx`);

    const { error: upErr } = await supabase.storage.from("templates").upload(newPath, outBytes, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    const { error: updErr } = await supabase
      .from("templates").update({ file_path: newPath }).eq("id", tpl.id);
    if (updErr) throw new Error(`template row update failed: ${updErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, oldPath: tpl.file_path, newPath, report }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[fix-lpds-lender1-label]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function extractVisibleText(paraXml: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraXml)) !== null) parts.push(m[1]);
  return parts.join("");
}

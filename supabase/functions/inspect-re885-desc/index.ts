// Throwaway inspection helper: downloads the RE885 template, unzips it,
// and returns small XML snippets surrounding each `{{of_NNN_desc}}` merge
// tag so we can plan the description-paragraph rewrite safely.
//
// Read-only. Does NOT mutate the template.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TEMPLATE_PATH = "1778766453217_re885.docx";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let templatePath = DEFAULT_TEMPLATE_PATH;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.templatePath) templatePath = String(body.templatePath);
    } catch (_) {}

    const dl = await supabase.storage.from("templates").download(templatePath);
    if (dl.error || !dl.data) {
      return new Response(
        JSON.stringify({ error: dl.error?.message || "no data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const unzipped = fflate.unzipSync(bytes);
    const docXml = new TextDecoder().decode(unzipped["word/document.xml"]);

    // Strip text from XML to find description tags even if split across runs.
    const textOnly: string[] = [];
    const map: number[] = [];
    for (let i = 0; i < docXml.length; i++) {
      const ch = docXml[i];
      if (ch === "<") {
        const close = docXml.indexOf(">", i);
        if (close === -1) break;
        i = close;
        continue;
      }
      textOnly.push(ch);
      map.push(i);
    }
    const flat = textOnly.join("");

    const tagRe = /\{\{\s*of_([0-9]{3,4})_desc\s*\}\}/g;
    const samples: Array<{
      code: string;
      flatIndex: number;
      paragraph: string;
    }> = [];
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(flat)) !== null) {
      const xmlIdx = map[m.index];
      // Find enclosing <w:p ...>...</w:p>
      const pStart = docXml.lastIndexOf("<w:p ", xmlIdx);
      const pStartAlt = docXml.lastIndexOf("<w:p>", xmlIdx);
      const pBegin = Math.max(pStart, pStartAlt);
      const pEnd = docXml.indexOf("</w:p>", xmlIdx);
      const para = pBegin >= 0 && pEnd >= 0
        ? docXml.slice(pBegin, pEnd + "</w:p>".length)
        : "(paragraph not found)";
      samples.push({ code: m[1], flatIndex: m.index, paragraph: para });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        templatePath,
        descTagCount: samples.length,
        codes: samples.map((s) => s.code),
        // First 4 unique paragraphs (deduped) so payload stays small.
        paragraphSamples: dedupeFirst(samples, 6),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function dedupeFirst(
  samples: Array<{ code: string; paragraph: string }>,
  limit: number,
) {
  const seen = new Set<string>();
  const out: Array<{ code: string; paragraph: string }> = [];
  for (const s of samples) {
    const key = s.paragraph.replace(/\s+/g, " ").slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

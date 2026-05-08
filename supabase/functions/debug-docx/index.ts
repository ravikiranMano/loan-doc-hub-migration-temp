import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.storage.from("generated-docs").download(path);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    const buf = new Uint8Array(await data.arrayBuffer());
    const unz = fflate.unzipSync(buf);
    const xml = new TextDecoder().decode(unz["word/document.xml"]);
    // Find ENCUMBRANCE sections and dump 4000 chars after each
    const out: any[] = [];
    const sectionRe = /ENCUMBRANCE\(S\)\s+(REMAINING|EXPECTED\s+OR\s+ANTICIPATED)/gi;
    let m: RegExpExecArray | null;
    while ((m = sectionRe.exec(xml)) !== null) {
      if (out.length >= 2) continue;
      const after = xml.slice(m.index, m.index + 80000);
      const ballIdx = after.search(/BALLOON\s+PAYMENT/i);
      const ballRaw = ballIdx >= 0 ? xml.slice(m.index + ballIdx, m.index + ballIdx + 6000) : "(none)";
      out.push({ at: m.index, kind: m[1], ballOffset: ballIdx, ballRaw });
    }
    return new Response(JSON.stringify({ count: out.length, sections: out }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});

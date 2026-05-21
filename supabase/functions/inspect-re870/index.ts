import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { templateId } = await req.json();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tpl } = await sb.from("templates").select("id,name,file_path").eq("id", templateId).maybeSingle();
  if (!tpl?.file_path) return new Response(JSON.stringify({ error: "no template" }), { headers: corsHeaders });
  const { data: blob, error } = await sb.storage.from("templates").download(tpl.file_path);
  if (error || !blob) return new Response(JSON.stringify({ error: error?.message }), { headers: corsHeaders });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const uz = fflate.unzipSync(buf);
  const xml = new TextDecoder().decode(uz["word/document.xml"] || new Uint8Array());
  const paras = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  const samples: { i: number; text: string }[] = [];
  paras.forEach((p, i) => {
    const text = (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, "")).join("");
    if (/INVESTOR NAME|NAME OF ENTITY|TYPE OF ORGANIZATION|NAME OF PERSON COMPLETING|BROKER ACKNOWLEDGEMENT|ld_p_|isIndividual|each lenders/.test(text)) {
      samples.push({ i, text: text.slice(0, 300) });
    }
  });
  const ldTags = Array.from(new Set((xml.match(/ld_p_[A-Za-z]+/g) || [])));
  const hasEach = xml.includes("{{#each lenders}}");
  return new Response(JSON.stringify({ name: tpl.name, file_path: tpl.file_path, total_paras: paras.length, ldTags, hasEach, samples }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

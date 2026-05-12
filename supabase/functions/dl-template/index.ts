import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.searchParams.get("p") || "1778522536971_re885.docx";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.storage.from("templates").download(path);
  if (error) return new Response(error.message, { status: 500, headers: corsHeaders });
  return new Response(await data.arrayBuffer(), { headers: { ...corsHeaders, "Content-Type": "application/octet-stream" } });
});

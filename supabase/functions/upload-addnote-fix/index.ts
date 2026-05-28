// One-off: upload patched Addendum to Note template, overwriting in place.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const path = "1774530442054_Default-ADDENDUM_TO_NOTE.docx";
  const bytes = new Uint8Array(await req.arrayBuffer());
  const { error } = await sb.storage.from("templates").upload(path, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ ok: true, bytes: bytes.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

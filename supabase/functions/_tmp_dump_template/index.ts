import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("p") || "1779204187646_re851a_-_LPDS_Field_Key_mapping_New.docx";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.storage.from("templates").download(path);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = ""; for (let i=0;i<buf.length;i++) bin += String.fromCharCode(buf[i]);
  return new Response(btoa(bin), { headers: { "content-type": "text/plain" }});
});

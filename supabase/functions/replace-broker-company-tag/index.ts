// Edge function: scan all .docx in the `templates` bucket, replace
// {{bk_p_company}} occurrences with {{bk_p_licenseeNameIfEntity}} in
// every internal XML part, and re-upload only the templates that change.

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OLD_TAG = "bk_p_company";
const NEW_TAG = "bk_p_licenseeNameIfEntity";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional ?dryRun=1 to only scan and report
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const startIdx = parseInt(url.searchParams.get("start") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  const allFiles: { name: string }[] = [];
  let offset = 0;
  const PAGE = 100;
  while (true) {
    const { data, error } = await supabase.storage
      .from("templates")
      .list("", { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.name?.toLowerCase().endsWith(".docx")) allFiles.push({ name: f.name });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const batch = allFiles.slice(startIdx, startIdx + limit);


  const updated: string[] = [];
  const matched: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const f of allFiles) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("templates")
        .download(f.name);
      if (dlErr || !blob) {
        skipped.push({ name: f.name, reason: dlErr?.message || "download failed" });
        continue;
      }
      const buf = new Uint8Array(await blob.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);

      let touched = false;
      const xmlEntries = Object.keys(zip.files).filter(
        (n) => n.endsWith(".xml") || n.endsWith(".rels"),
      );
      for (const entryName of xmlEntries) {
        const entry = zip.file(entryName);
        if (!entry) continue;
        const text = await entry.async("string");
        if (text.includes(OLD_TAG)) {
          touched = true;
          if (!dryRun) {
            const replaced = text.split(OLD_TAG).join(NEW_TAG);
            zip.file(entryName, replaced);
          }
        }
      }

      if (touched) {
        matched.push(f.name);
        if (!dryRun) {
          const out = await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
          });
          const { error: upErr } = await supabase.storage
            .from("templates")
            .upload(f.name, out, {
              upsert: true,
              contentType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
          if (upErr) {
            skipped.push({ name: f.name, reason: `upload: ${upErr.message}` });
          } else {
            updated.push(f.name);
          }
        }
      }
    } catch (e) {
      skipped.push({ name: f.name, reason: (e as Error).message });
    }
  }

  return new Response(
    JSON.stringify({
      dryRun,
      total: allFiles.length,
      matchedCount: matched.length,
      updatedCount: updated.length,
      matched,
      updated,
      skipped,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

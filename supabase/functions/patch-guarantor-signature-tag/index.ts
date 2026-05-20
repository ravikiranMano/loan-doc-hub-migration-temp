// One-shot edge function: scan template .docx files in the `templates` bucket
// and inject `{{ag_p_fullName}}` after any bare "Guarantor:" signature label
// that has no merge tag mapped to it. Idempotent — skips paragraphs that
// already contain `{{ag_p_` so re-runs are safe.
//
// Query params:
//   ?dryRun=1   → report matches without writing
//   ?name=...   → only process this exact template filename
//   ?all=1      → scan every template (default: only "Personal Guaranty by Third Party"
//                 + any filename matching /guaranty/i)
//   ?start=N&limit=M for batching

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Insert this run right after the `Guarantor:` text run. Plain, size 22, with
// a leading space so it visually separates from the label.
const AG_RUN =
  `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
  `<w:t xml:space="preserve"> {{ag_p_fullName}}</w:t></w:r>`;

// Process one paragraph at a time so we only touch the signature-line paragraph
// and never get confused by other "Guarantor" mentions in body prose.
function patchParagraphs(xml: string): { changed: boolean; out: string; hits: number } {
  let changed = false;
  let hits = 0;
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const out = xml.replace(paraRe, (para) => {
    // Skip if paragraph already wires an AG tag
    if (/\{\{\s*ag_p_/.test(para)) return para;

    // Find a run whose <w:t> text is exactly "Guarantor:" (the signature label,
    // not body prose like "Guarantor agrees that...").
    const runRe =
      /(<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>)\s*Guarantor:\s*(<\/w:t>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>)/;
    const m = runRe.exec(para);
    if (!m) return para;

    // Reconstruct: keep the original Guarantor: run (normalized to "Guarantor:")
    // and append AG_RUN immediately after it.
    const before = para.slice(0, m.index);
    const labelRun = `${m[1]}Guarantor:${m[2]}`;
    const after = para.slice(m.index + m[0].length);
    changed = true;
    hits += 1;
    return `${before}${labelRun}${AG_RUN}${after}`;
  });
  return { changed, out, hits };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlyName = url.searchParams.get("name");
  const all = url.searchParams.get("all") === "1";
  const startIdx = parseInt(url.searchParams.get("start") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  // List candidate files
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
      if (!f.name?.toLowerCase().endsWith(".docx")) continue;
      if (onlyName && f.name !== onlyName) continue;
      if (!onlyName && !all && !/guaranty/i.test(f.name)) continue;
      allFiles.push({ name: f.name });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const batch = allFiles.slice(startIdx, startIdx + limit);

  const updated: string[] = [];
  const matched: { name: string; hits: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const f of batch) {
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
      let totalHits = 0;
      // Patch document.xml + any header/footer XML.
      const xmlEntries = Object.keys(zip.files).filter(
        (n) =>
          n === "word/document.xml" ||
          /^word\/(header|footer)\d*\.xml$/.test(n),
      );
      for (const entryName of xmlEntries) {
        const entry = zip.file(entryName);
        if (!entry) continue;
        const text = await entry.async("string");
        const { changed, out, hits } = patchParagraphs(text);
        if (changed) {
          touched = true;
          totalHits += hits;
          if (!dryRun) zip.file(entryName, out);
        }
      }

      if (touched) {
        matched.push({ name: f.name, hits: totalHits });
        if (!dryRun) {
          const outBuf = await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
          });
          const { error: upErr } = await supabase.storage
            .from("templates")
            .upload(f.name, outBuf, {
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
      scope: onlyName ? `name=${onlyName}` : all ? "all" : "guaranty-only",
      total: allFiles.length,
      batchStart: startIdx,
      batchSize: batch.length,
      nextStart: startIdx + batch.length,
      matchedCount: matched.length,
      updatedCount: updated.length,
      matched,
      updated,
      skipped,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

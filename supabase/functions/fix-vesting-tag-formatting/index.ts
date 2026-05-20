// Edge function: scan all .docx in the `templates` bucket and normalize
// any {{br_p_vesting}} Handlebars tag whose runs are split by bold formatting
// (which causes duplicate injection and bold rendering). Replaces broken
// runs with a single plain run containing " {{br_p_vesting}} ".

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TAG = "br_p_vesting";

// Canonical replacement run: plain text, single space before & after the tag.
const CANONICAL_RUN =
  `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:rtl w:val="0"/></w:rPr>` +
  `<w:t xml:space="preserve"> {{${TAG}}} </w:t></w:r>`;

function normalizeXml(xml: string): { changed: boolean; out: string } {
  if (!xml.includes(TAG)) return { changed: false, out: xml };
  let out = xml;
  let changed = false;

  // Pattern A: tag split across two runs — run1 ends with "{{", run2 starts with "br_p_vesting}}".
  // Optionally consume a trailing whitespace-only run (often bold) that follows.
  const splitRe = new RegExp(
    `<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t[^>]*>[^<{}]*\\{\\{\\s*<\\/w:t>\\s*<\\/w:r>` +
      `\\s*<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t[^>]*>\\s*${TAG}\\s*\\}\\}[^<{}]*<\\/w:t>\\s*<\\/w:r>` +
      `(?:\\s*<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t[^>]*>\\s+<\\/w:t>\\s*<\\/w:r>)?`,
    "g",
  );
  if (splitRe.test(out)) {
    out = out.replace(splitRe, CANONICAL_RUN);
    changed = true;
  }

  // Pattern B: tag lives inside a single run that is bold. Replace that
  // entire run with the canonical (non-bold) run, preserving surrounding
  // text on either side of the tag within that run.
  const singleBoldRe = new RegExp(
    `<w:r\\b[^>]*>\\s*<w:rPr>(?=(?:(?!<\\/w:rPr>)[\\s\\S])*?<w:b\\b)(?:(?!<\\/w:rPr>)[\\s\\S])*?<\\/w:rPr>\\s*<w:t[^>]*>([^<]*?)\\{\\{\\s*${TAG}\\s*\\}\\}([^<]*?)<\\/w:t>\\s*<\\/w:r>`,
    "g",
  );
  if (singleBoldRe.test(out)) {
    out = out.replace(singleBoldRe, (_m, pre: string, post: string) => {
      const before = pre.endsWith(" ") || pre === "" ? pre : pre + " ";
      const after = post.startsWith(" ") || post === "" ? post : " " + post;
      const text = `${before || " "}{{${TAG}}}${after || " "}`;
      return (
        `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:rtl w:val="0"/></w:rPr>` +
        `<w:t xml:space="preserve">${text}</w:t></w:r>`
      );
    });
    changed = true;
  }

  return { changed, out };
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
      const xmlEntries = Object.keys(zip.files).filter((n) => n.endsWith(".xml"));
      for (const entryName of xmlEntries) {
        const entry = zip.file(entryName);
        if (!entry) continue;
        const text = await entry.async("string");
        const { changed, out } = normalizeXml(text);
        if (changed) {
          touched = true;
          if (!dryRun) zip.file(entryName, out);
        }
      }

      if (touched) {
        matched.push(f.name);
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

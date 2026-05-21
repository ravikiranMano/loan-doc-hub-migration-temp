// One-shot: patches RE870 templates so the "NAME OF PERSON COMPLETING THIS QUESTIONNAIRE"
// line renders with proper spacing and an optional middle name.
//
// Before:  {{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}
// After:   {{ld_p_firstIfEntityUse}} {{#if ld_p_middle}}{{ld_p_middle}} {{/if}}{{ld_p_last}}
//
// Strategy: operate on the visible text. The three tags currently sit in adjacent
// <w:r>...<w:t>...</w:t></w:r> runs in a single paragraph. We locate the run that
// contains "{{ld_p_firstIfEntityUse}}" and replace ONLY the <w:t> text content of
// the three consecutive tag-bearing runs to inject the spaces and #if conditional.
// All <w:rPr> formatting is preserved verbatim.

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGETS = [
  "1779120469182_re870_-_Investor_Questionnaire_-_Field_Key_mapping__1_.docx",
  "1779124702694_re870_-_Investor_Questionnaire_-_Field_Key_mapping__1___2_.docx",
  "1779312915249_re870_-_Investor_Questionnaire_-_Field_Key_mapping__1___1_.docx",
];

// Find the <w:t ...>...</w:t> blocks containing each of the three tags (which may span
// across split <w:t> elements within a single run, but in our inspected template the
// three tags each live in their own single <w:t>). Replace the inner text accordingly.
function patchDocumentXml(xml: string): { xml: string; changed: boolean; note: string } {
  // Quick presence check.
  if (!xml.includes("ld_p_firstIfEntityUse") || !xml.includes("ld_p_last")) {
    return { xml, changed: false, note: "tags not found" };
  }

  // Replace the <w:t>{{ld_p_firstIfEntityUse}}</w:t> with a version that appends a space.
  // Use xml:space="preserve" to keep the trailing space.
  const reFirst =
    /<w:t(\s[^>]*)?>\{\{\s*ld_p_firstIfEntityUse\s*\}\}<\/w:t>/g;
  // Replace {{ld_p_middle}} with the conditional wrapped form (still inside a single <w:t>).
  const reMiddle =
    /<w:t(\s[^>]*)?>\{\{\s*ld_p_middle\s*\}\}<\/w:t>/g;
  // Last stays the same — no leading/trailing space needed; the conditional supplies the
  // separating space when middle is present, and the first-tag run already supplies one.
  // (Untouched.)

  let changed = false;

  const out1 = xml.replace(reFirst, (_m, attrs) => {
    changed = true;
    return `<w:t xml:space="preserve">{{ld_p_firstIfEntityUse}} </w:t>`;
  });

  const out2 = out1.replace(reMiddle, (_m, _attrs) => {
    changed = true;
    // Inject the {{#if}}…{{/if}} block inline so the Handlebars-style parser sees it.
    return `<w:t xml:space="preserve">{{#if ld_p_middle}}{{ld_p_middle}} {{/if}}</w:t>`;
  });

  return { xml: out2, changed, note: changed ? "patched" : "no-op" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyPath = url.searchParams.get("path"); // optional: patch one file
  const paths = onlyPath ? [onlyPath] : TARGETS;

  const results: any[] = [];

  for (const path of paths) {
    try {
      const { data, error } = await sb.storage.from("templates").download(path);
      if (error) {
        results.push({ path, ok: false, error: error.message });
        continue;
      }
      const inBytes = new Uint8Array(await data.arrayBuffer());
      const zip = await JSZip.loadAsync(inBytes);
      const docFile = zip.file("word/document.xml");
      if (!docFile) {
        results.push({ path, ok: false, error: "word/document.xml not found" });
        continue;
      }
      const xml = await docFile.async("string");
      const before =
        (xml.match(/ld_p_firstIfEntityUse/g) || []).length;
      const { xml: patched, changed, note } = patchDocumentXml(xml);

      if (!changed) {
        results.push({ path, ok: true, changed: false, note, before });
        continue;
      }

      if (dryRun) {
        results.push({ path, ok: true, changed: true, dryRun: true, note, before });
        continue;
      }

      zip.file("word/document.xml", patched);
      const outBytes = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      });

      const { error: upErr } = await sb.storage
        .from("templates")
        .upload(path, outBytes, {
          upsert: true,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      if (upErr) {
        results.push({ path, ok: false, error: upErr.message });
        continue;
      }
      results.push({ path, ok: true, changed: true, note, before, bytes: outBytes.length });
    } catch (e) {
      results.push({ path, ok: false, error: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

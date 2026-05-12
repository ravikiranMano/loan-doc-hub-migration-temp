import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Lossless cleanup of a Word XML part. Removes authoring noise that has no
 * effect on rendering or merge logic but bloats document.xml and slows down
 * every regex pass in the document-generation pipeline.
 *
 * Stripped:
 *   - All w:rsid* attributes (Word revision-save IDs)
 *   - <w:proofErr .../> self-closing spell/grammar markers
 *   - <w:lastRenderedPageBreak/> hints (recomputed by Word on open)
 *   - <mc:Fallback>...</mc:Fallback> blocks (legacy VML duplicates of
 *     modern DrawingML in mc:AlternateContent — Word renders mc:Choice)
 *   - <mc:AlternateContent> wrappers when only mc:Choice remains
 *   - _GoBack proof bookmarks
 *
 * Document structure (paragraphs, runs, tables, sections, styles, SDTs,
 * merge tags, drawings, hyperlinks) is preserved unchanged.
 */
function cleanupWordXml(xml: string): string {
  let out = xml;

  // 1. Strip mc:Fallback blocks first — biggest win on templates with many
  //    text boxes / shapes (RE851D V12 was ~63% of file size).
  out = out.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");

  // 2. Unwrap mc:AlternateContent that now contains only an mc:Choice.
  //    Iterate until stable to handle nested AlternateContent.
  let prev: string;
  let safety = 0;
  do {
    prev = out;
    out = out.replace(
      /<mc:AlternateContent[^>]*>\s*<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>\s*<\/mc:AlternateContent>/g,
      "$1",
    );
    safety++;
  } while (out !== prev && safety < 8);

  // 3. Strip rsid attributes anywhere they appear.
  out = out.replace(/\s+w:rsid[A-Za-z]*="[0-9A-Fa-f]+"/g, "");

  // 4. Strip proofErr self-closing tags.
  out = out.replace(/<w:proofErr\b[^/>]*\/>/g, "");

  // 5. Strip lastRenderedPageBreak hints (Word recomputes on open).
  out = out.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");

  // 6. Strip _GoBack proof bookmarks (cursor-position artifact from Word).
  out = out.replace(
    /<w:bookmarkStart\b[^/>]*w:name="_GoBack"[^/>]*\/>/g,
    "",
  );

  return out;
}

const TEXT_PARTS_TO_CLEAN = [
  "word/document.xml",
  "word/header1.xml",
  "word/header2.xml",
  "word/header3.xml",
  "word/footer1.xml",
  "word/footer2.xml",
  "word/footer3.xml",
];

/**
 * Try to apply the cleanup to a DOCX byte buffer. Returns the cleaned bytes
 * or the original bytes if anything goes wrong (cleanup is opportunistic
 * and must never block uploads).
 */
function tryCleanupDocx(bytes: Uint8Array): Uint8Array {
  try {
    const decompressed = fflate.unzipSync(bytes);
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    let touched = false;
    let beforeTotal = 0;
    let afterTotal = 0;

    for (const part of TEXT_PARTS_TO_CLEAN) {
      const data = decompressed[part];
      if (!data) continue;
      const original = decoder.decode(data);
      const cleaned = cleanupWordXml(original);
      if (cleaned.length !== original.length) {
        decompressed[part] = encoder.encode(cleaned);
        touched = true;
        beforeTotal += original.length;
        afterTotal += cleaned.length;
        console.log(
          `[upload-template] cleaned ${part}: ${original.length}B -> ${cleaned.length}B (${
            Math.round((1 - cleaned.length / original.length) * 100)
          }% smaller)`,
        );
      }
    }

    if (!touched) return bytes;

    const repacked = fflate.zipSync(decompressed as fflate.Zippable);
    console.log(
      `[upload-template] total xml cleanup: ${beforeTotal}B -> ${afterTotal}B; docx ${bytes.length}B -> ${repacked.length}B`,
    );
    return repacked;
  } catch (err) {
    console.warn(
      `[upload-template] cleanup skipped due to error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return bytes;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Use service role for storage operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { templateId, fileName, fileContent } = await req.json();

    if (!templateId || !fileName || !fileContent) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: templateId, fileName, fileContent" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode base64 file content
    const binaryString = atob(fileContent);
    const rawBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      rawBytes[i] = binaryString.charCodeAt(i);
    }

    // Lossless cleanup pass — strips authoring noise (rsids, proofErr,
    // mc:Fallback duplicates) so downstream document generation stays
    // within Edge Function CPU budget on large templates.
    const bytes = tryCleanupDocx(rawBytes);

    // Upload to templates bucket (use just fileName, not nested "templates/" path)
    const storagePath = fileName;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("templates")
      .upload(storagePath, bytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update the template record with the file path (just use fileName directly)
    const { error: updateError } = await supabase
      .from("templates")
      .update({ file_path: fileName })
      .eq("id", templateId);

    if (updateError) {
      console.error("Update error:", updateError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        path: storagePath,
        message: "Template uploaded successfully" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

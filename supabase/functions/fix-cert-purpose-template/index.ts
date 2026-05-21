// One-shot maintenance function: patches the Certification of Purpose template
// to replace the hardcoded Authorized Signer text with the proper merge tags.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';

const BUCKET = 'templates';
const PATH = '1779384299634_Certification_of_Purpose__Occupancy__Material_Facts_V6_-_Entity__1__v1__1_.docx';
const HARDCODED = 'Adtn Guarantor Marc Boucher';
const REPLACEMENT = '{{ld_p_authorizedFirst}} {{ld_p_authorizedMiddle}}{{ld_p_authorizedLast}}';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(PATH);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);

    const buf = new Uint8Array(await blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    const report: Record<string, { before: number; after: number }> = {};
    const targets = Object.keys(zip.files).filter((n) => n.endsWith('.xml'));

    for (const name of targets) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      const before = (xml.match(new RegExp(HARDCODED.replace(/ /g, '\\s*'), 'g')) || []).length;
      if (before === 0) continue;

      // Replace the hardcoded text inside any <w:t> run with the merge tags.
      // Use a tolerant regex to handle the value being split across runs (rare here).
      const re = new RegExp(HARDCODED, 'g');
      const patched = xml.replace(re, REPLACEMENT);

      const after = (patched.match(re) || []).length;
      report[name] = { before, after };
      zip.file(name, patched);
    }

    const patchedBuf = await zip.generateAsync({ type: 'uint8array' });

    const { error: upErr } = await supabase.storage.from(BUCKET).update(PATH, patchedBuf, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    return new Response(JSON.stringify({ ok: true, report, bytes: patchedBuf.byteLength }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

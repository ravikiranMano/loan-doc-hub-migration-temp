// One-shot maintenance function: replace AG merge tags in the Authorized Signer
// line of the Certification of Purpose template with the Lender Authorized Party tags.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';

const BUCKET = 'templates';
const PATH = '1779384299634_Certification_of_Purpose__Occupancy__Material_Facts_V6_-_Entity__1__v1__1_.docx';

// Match the exact AG run that follows the "Authorized Signer:" label.
const FROM = '{{ag_p_firstName}} {{ag_p_middle}}{{ag_p_last}}';
const TO   = '{{ld_p_authorizedFirst}} {{ld_p_authorizedMiddle}}{{ld_p_authorizedLast}}';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(PATH);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);

    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const report: Record<string, { replacements: number }> = {};

    for (const name of Object.keys(zip.files)) {
      if (!name.endsWith('.xml')) continue;
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      if (!xml.includes(FROM)) continue;
      const count = xml.split(FROM).length - 1;
      const patched = xml.split(FROM).join(TO);
      zip.file(name, patched);
      report[name] = { replacements: count };
    }

    const out = await zip.generateAsync({ type: 'uint8array' });

    const { error: upErr } = await supabase.storage.from(BUCKET).update(PATH, out, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    return new Response(JSON.stringify({ ok: true, report, bytes: out.byteLength }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

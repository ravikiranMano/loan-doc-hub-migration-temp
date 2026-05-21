// v3 inspector
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const PATH = '1779384299634_Certification_of_Purpose__Occupancy__Material_Facts_V6_-_Entity__1__v1__1_.docx';
  const { data: blob } = await supabase.storage.from('templates').download(PATH);
  const zip = await JSZip.loadAsync(new Uint8Array(await blob!.arrayBuffer()));
  const xml = await zip.file('word/document.xml')!.async('string');
  // Find any "Authorized Signer" context
  const out: any = { hits: [] };
  const re = /Authorized\s*Signer/gi;
  let m;
  while ((m = re.exec(xml))) {
    out.hits.push({ idx: m.index, ctx: xml.slice(Math.max(0, m.index - 80), m.index + 800) });
    if (out.hits.length >= 5) break;
  }
  out.hasAdtn = xml.includes('Adtn');
  out.hasBoucher = xml.includes('Boucher');
  out.hasMarcBoucher = xml.includes('Marc');
  out.hasLdAuth = xml.includes('ld_p_authorized');
  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

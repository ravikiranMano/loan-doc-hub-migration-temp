import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(url, key);
for (const [bucket, path, out] of [
  ['templates', '1778746922135_RE851D-V12.1.docx', '/tmp/tpl/t.docx'],
  ['generated-docs', 'a4eefafb-cd04-4bf5-adb8-f432d79e0e65/43492f94-60ad-44c3-a8c2-24dabf36eac7_v76_1778748668640.docx', '/tmp/tpl/g.docx'],
]) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) { console.error(bucket, error); continue; }
  writeFileSync(out, Buffer.from(await data.arrayBuffer()));
  console.log('ok', out);
}

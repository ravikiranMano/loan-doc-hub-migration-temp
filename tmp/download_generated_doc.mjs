import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const path = process.argv[2];
const out = process.argv[3];
if (!url || !key || !path || !out) process.exit(2);
const supabase = createClient(url, key);
const { data, error } = await supabase.storage.from('generated-docs').download(path);
if (error) { console.error(error.message); process.exit(1); }
const buf = Buffer.from(await data.arrayBuffer());
writeFileSync(out, buf);
console.log(`${buf.length} bytes written to ${out}`);

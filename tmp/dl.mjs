import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(url, key);
const { data, error } = await supabase.storage.from('templates').download('1779312915249_re870_-_Investor_Questionnaire_-_Field_Key_mapping__1___1_.docx');
if (error) { console.error(error); process.exit(1); }
writeFileSync('/tmp/tpl/iq.docx', Buffer.from(await data.arrayBuffer()));
console.log('ok');

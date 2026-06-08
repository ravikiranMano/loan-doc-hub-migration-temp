/**
 * One-time: convert re851a v1 DOCX → docxtemplater v2, upload to re851a_vDT, save local copy.
 * Run from backend/: npx ts-node scripts/docx/convert-re851a-once.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  convertDocxBuffer,
  extractMergeTagsFromXml,
  inspectDocxParse,
  mergeSplitRuns,
} from './lib/docx-v2-convert';
import { templateOutputDir } from './paths';
import PizZip from 'pizzip';

const SOURCE = {
  name: 're851a',
  file_path: '1780668781036_re851a_v1__2_.docx',
};
const VDT = {
  id: '5a716f42-aba0-4768-aa0b-83920553eb00',
  name: 're851a_vDT',
  file_path: '1780679901877_re851a_v1_vDT.docx',
  state: 'TBD',
  product_type: 'TBD',
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in backend/.env');

  const supabase = createClient(url, key);
  const outDir = templateOutputDir('re851a');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Downloading source:', SOURCE.file_path);
  const { data: blob, error: dlErr } = await supabase.storage.from('templates').download(SOURCE.file_path);
  if (dlErr || !blob) throw new Error(`Download failed: ${dlErr?.message ?? 'no data'}`);

  const original = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(path.join(outDir, 're851a-original.docx'), original);

  const zip = new PizZip(original);
  const docXml = zip.file('word/document.xml')?.asText() ?? '';
  const tagsBefore = extractMergeTagsFromXml(docXml);
  console.log('Tags before conversion (sample):', tagsBefore.slice(0, 20), '… total unique:', tagsBefore.length);

  const converted = convertDocxBuffer(original);
  fs.writeFileSync(path.join(outDir, 're851a-v2.docx'), converted);

  const convertedXml = new PizZip(converted).file('word/document.xml')?.asText() ?? '';
  const tagsAfter = extractMergeTagsFromXml(convertedXml);

  const inspectBefore = inspectDocxParse(original);
  const inspectAfter = inspectDocxParse(converted);
  console.log('Inspect before:', inspectBefore);
  console.log('Inspect after:', inspectAfter);

  const { data: dictRows, error: dictErr } = await supabase
    .from('field_dictionary')
    .select('field_key');
  if (dictErr) throw dictErr;
  const dictKeys = new Set((dictRows ?? []).map((r: { field_key: string }) => r.field_key));

  const mergeKeys = tagsAfter.filter(
    (t) => !t.includes('==') && /^[A-Za-z][A-Za-z0-9_.]*$/.test(t),
  );
  const mapped = mergeKeys.filter((k) => dictKeys.has(k));
  const unmapped = mergeKeys.filter((k) => !dictKeys.has(k));

  const report = {
    source: SOURCE,
    vdtTarget: VDT,
    tagsBeforeCount: tagsBefore.length,
    tagsAfterCount: tagsAfter.length,
    inspectBefore,
    inspectAfter,
    mappedCount: mapped.length,
    unmappedCount: unmapped.length,
    unmappedTags: unmapped.sort(),
    conditions: tagsAfter.filter((t) => t.includes('==')),
  };
  fs.writeFileSync(path.join(outDir, 'field-mapping-report.json'), JSON.stringify(report, null, 2));

  if (!inspectAfter.ok) {
    console.error('Converted DOCX failed docxtemplater parse:', inspectAfter.errors);
    process.exit(1);
  }

  console.log('Uploading to re851a_vDT storage:', VDT.file_path);
  const { error: upErr } = await supabase.storage.from('templates').upload(VDT.file_path, converted, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  console.log('Done.');
  console.log('Local copy:', path.join(outDir, 're851a-v2.docx'));
  console.log('Report:', path.join(outDir, 'field-mapping-report.json'));
  console.log('Mapped:', mapped.length, 'Unmapped:', unmapped.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

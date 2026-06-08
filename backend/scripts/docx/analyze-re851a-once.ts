import * as fs from 'fs';
import PizZip from 'pizzip';
import { mergeSplitRuns, convertDocxBuffer, inspectDocxParse } from './lib/docx-v2-convert';

const original = fs.readFileSync('scripts/docx/output/re851a/re851a-original.docx');
const merged = mergeSplitRuns(new PizZip(original).file('word/document.xml')!.asText());

const wtRe = /<w:t(?:[^>]*)>([^<]*)<\/w:t>/g;
let partial = 0;
let m: RegExpExecArray | null;
const samples: string[] = [];
while ((m = wtRe.exec(merged)) !== null) {
  const t = m[1];
  if (/\{\{[^}]*$/.test(t) || /^[^{]*\}\}/.test(t) || (t.includes('{') && !/\{\{[^{}]+\}\}/.test(t))) {
    partial++;
    if (samples.length < 10) samples.push(t.slice(0, 100));
  }
}
console.log('partial after merge', partial, samples);

const converted = convertDocxBuffer(original);
const convXml = new PizZip(converted).file('word/document.xml')!.asText();
let partial2 = 0;
while ((m = wtRe.exec(convXml)) !== null) {
  const t = m[1];
  if (/\{\{[^}]*$/.test(t) || /^[^{]*\}\}/.test(t) || (t.includes('{') && !/\{\{[^{}]+\}\}/.test(t))) partial2++;
}
console.log('partial after convert', partial2);

const stillIf = convXml.match(/\{\{#if[^}]+\}\}/g) ?? [];
console.log('remaining #if', stillIf.length, [...new Set(stillIf)]);

const inspect = inspectDocxParse(converted);
console.log('inspect converted', inspect.ok, 'tags', inspect.tagCount);
if (!inspect.ok) {
  console.log('errors', inspect.errors.slice(0, 30));
  const wtRe2 = /<w:t(?:[^>]*)>([^<]*)<\/w:t>/g;
  const bad: string[] = [];
  while ((m = wtRe2.exec(convXml)) !== null) {
    const t = m[1];
    if (/\{\{[^}]*$/.test(t) || /^[^{]*\}\}/.test(t) || (t.includes('{') && !/\{\{[^{}]+\}\}/.test(t))) {
      bad.push(t.slice(0, 120));
    }
  }
  console.log('bad w:t cells', bad);
}

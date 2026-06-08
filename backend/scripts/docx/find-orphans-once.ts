import * as fs from 'fs';
import PizZip from 'pizzip';

const x = new PizZip(fs.readFileSync('scripts/docx/output/re851a/re851a-original.docx'))
  .file('word/document.xml')!
  .asText();

for (const needle of ['pr_li_ant_originalAmount', 'pr_li_rem_originalAmount', '${{']) {
  const i = x.indexOf(needle);
  console.log(needle, i);
  if (i >= 0) console.log(x.slice(i - 60, i + 100), '\n');
}

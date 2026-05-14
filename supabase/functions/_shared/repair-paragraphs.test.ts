// Verifies repairUnclosedParagraphsBeforeStructuralClose closes a <w:p>
// that leaks past </w:sdtContent> — the RE851D failure mode reported as
// "expected </w:p> before </w:sdtContent>".

import { repairUnclosedParagraphsBeforeStructuralClose, validateContentXmlPart } from "./docx-processor.ts";

const broken =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body>` +
  `<w:p><w:sdt><w:sdtContent>` +
  `<w:p><w:r><w:t>inner</w:t></w:r>` +
  // missing </w:p> here — paragraph leaks past </w:sdtContent>
  `</w:sdtContent></w:sdt></w:p>` +
  `</w:body></w:document>`;

const { xml: fixed, repaired } = repairUnclosedParagraphsBeforeStructuralClose(broken);
if (repaired !== 1) throw new Error(`expected 1 repair, got ${repaired}`);
validateContentXmlPart("word/document.xml", fixed);
console.log("✓ repairUnclosedParagraphsBeforeStructuralClose closes leaked <w:p>");

/**
 * Regression tests for the RE851A Part 2 broker-capacity A/B safety pass.
 *
 * Pins the contract that:
 *   or_p_isBrkBorrower = true  -> A (Agent)     becomes ☐, B (Principal) becomes ☑
 *   or_p_isBrkBorrower = false -> A (Agent)     becomes ☑, B (Principal) becomes ☐
 *   or_p_isBrkBorrower missing -> glyphs are left untouched
 *
 * "Is Broker Also a Borrower?" Yes means the broker is acting as a Principal
 * on the loan, so the B row (Principal as a borrower) is the checked option.
 *
 * These tests exercise replaceMergeTags() (the same entry point used by
 * generate-document) with XML shaped like re851a_v64.docx — literal
 * "A. Agent in arranging a loan…" and "B. *Principal as a borrower…"
 * labels with static ☐ glyphs in front of each.
 *
 * No template, schema, UI, or other field mappings are touched.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { replaceMergeTags } from "./tag-parser.ts";
import type { FieldValueData, LabelMapping } from "./types.ts";

function buildBrokerCapacityFixture(): string {
  // Mirrors the actual run-split observed in re851a_v64.docx:
  //   A row: <w:t>☐ .</w:t> + <w:t>A. Agent in arranging a loan...</w:t>
  //   B row: <w:sdt>...<w:t>☐</w:t></w:sdt> + <w:t>B. </w:t> + <w:t>*</w:t> + <w:t>Principal as a borrower...</w:t>
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">PART 2  BROKER CAPACITY IN TRANSACTION</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">☐ .</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">A. Agent in arranging a loan on behalf of another</w:t></w:r></w:p>
<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">B. </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">*</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">Principal as a borrower on funds from which broker will directly or indirectly benefit</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 3 LOAN INFORMATION</w:t></w:r></w:p>
</w:body></w:document>`;
}

function run(value: "true" | "false" | null): string {
  const fieldValues = new Map<string, FieldValueData>();
  if (value !== null) {
    fieldValues.set("or_p_isBrkBorrower", { rawValue: value, dataType: "boolean" });
  }
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>(["or_p_isBrkBorrower"]);
  return replaceMergeTags(
    buildBrokerCapacityFixture(),
    fieldValues,
    fieldTransforms,
    mergeTagMap,
    labelMap,
    validFieldKeys,
    "RE851A",
  );
}

// Strip XML tags first, then locate the (now-contiguous) plain-text label and
// return the last visible glyph (☐/☑/☒) appearing before it. This handles
// labels split across multiple <w:t> runs (e.g. "B. " + "*" + "Principal...").
function lastGlyphBeforeLabel(xml: string, label: string): string | null {
  const plain = xml.replace(/<[^>]*>/g, "");
  const idx = plain.indexOf(label);
  if (idx < 0) return null;
  const region = plain.substring(0, idx);
  const matches = region.match(/[☐☑☒]/g);
  return matches ? matches[matches.length - 1] : null;
}

Deno.test("RE851A broker-capacity — isBrkBorrower=true → A=☑, B=☐", () => {
  const out = run("true");
  assertEquals(
    lastGlyphBeforeLabel(out, "A. Agent in arranging a loan"),
    "☑",
    "A row glyph should be checked when Yes is selected (1st condition checked)",
  );
  const bGlyph =
    lastGlyphBeforeLabel(out, "*Principal as a borrower") ??
    lastGlyphBeforeLabel(out, "Principal as a borrower");
  assertEquals(bGlyph, "☐", "B row glyph should be unchecked when Yes is selected");
});

Deno.test("RE851A broker-capacity — isBrkBorrower=false → A=☐, B=☑", () => {
  const out = run("false");
  assertEquals(
    lastGlyphBeforeLabel(out, "A. Agent in arranging a loan"),
    "☐",
    "A row glyph should be unchecked when No is selected",
  );
  const bGlyph =
    lastGlyphBeforeLabel(out, "*Principal as a borrower") ??
    lastGlyphBeforeLabel(out, "Principal as a borrower");
  assertEquals(bGlyph, "☑", "B row glyph should be checked when No is selected (2nd condition checked)");
});

Deno.test("RE851A broker-capacity — missing field leaves glyphs untouched", () => {
  const out = run(null);
  assertEquals(
    lastGlyphBeforeLabel(out, "A. Agent in arranging a loan"),
    "☐",
    "A row glyph should remain the original ☐ from the template",
  );
  const bGlyph =
    lastGlyphBeforeLabel(out, "*Principal as a borrower") ??
    lastGlyphBeforeLabel(out, "Principal as a borrower");
  assertEquals(bGlyph, "☐", "B row glyph should remain the original ☐ from the template");
});


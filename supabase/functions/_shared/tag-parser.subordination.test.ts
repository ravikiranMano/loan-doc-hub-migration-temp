/**
 * Regression tests for RE851A "Subordination Provision" Yes/No checkbox
 * safety pass in tag-parser.ts.
 *
 * Reproduces the structure observed in the live RE851A v5 generated DOCX:
 *   - "There are subordination provisions" anchor in one paragraph
 *   - several intervening paragraphs (~5KB of XML) including a column break
 *   - two separate <w:sdt> checkbox blocks, each followed by a literal
 *     " Yes" / " No" text run
 *
 * Verifies that for both true and false values the correct checkbox is
 * toggled (w14:checked + display glyph) without altering surrounding text.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { replaceMergeTags } from "./tag-parser.ts";
import type { FieldValueData, LabelMapping } from "./types.ts";

const SDT_BLOCK = (state: "0" | "1", glyph: "☐" | "☑") => `<w:sdt><w:sdtPr><w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic" w:hint="eastAsia"/></w:rPr><w14:checkbox><w14:checked w14:val="${state}"/><w14:checkedState w14:val="2611" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${glyph}</w:t></w:r></w:sdtContent></w:sdt>`;

// Pad with ~5KB of innocuous run XML to mirror the live template's gap
// between the anchor text and the Yes/No checkboxes.
const PAD = `<w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t xml:space="preserve">${"x".repeat(80)}</w:t></w:r>`;
const FILLER = Array.from({ length: 60 }, () => PAD).join("");

function buildFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">There are subordination provisions.</w:t></w:r></w:p>
<w:p>${FILLER}</w:p>
<w:p><w:r><w:t xml:space="preserve">If YES, explain here.</w:t></w:r>${SDT_BLOCK("0", "☐")}<w:r><w:t xml:space="preserve"> Yes</w:t></w:r></w:p>
<w:p><w:r><w:tab/></w:r>${SDT_BLOCK("0", "☐")}<w:r><w:t xml:space="preserve"> No</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 4 MULTI-LENDER TRANSACTIONS</w:t></w:r></w:p>
</w:body></w:document>`;
}

function run(value: "true" | "false"): string {
  const fieldValues = new Map<string, FieldValueData>([
    ["ln_p_subordinationProvision", { rawValue: value, dataType: "boolean" }],
    ["loan_terms.subordination_provision", { rawValue: value, dataType: "boolean" }],
  ]);
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>([
    "ln_p_subordinationProvision",
    "loan_terms.subordination_provision",
  ]);
  return replaceMergeTags(buildFixture(), fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, "RE851A");
}

function checkboxStatesAroundLabels(xml: string): { yes: string | null; no: string | null } {
  const findStateBefore = (label: string): string | null => {
    const labelIdx = xml.indexOf(` ${label}`);
    if (labelIdx < 0) return null;
    const region = xml.substring(Math.max(0, labelIdx - 1500), labelIdx);
    const matches = [...region.matchAll(/<w14:checked w14:val="(\d)"/g)];
    return matches.length ? matches[matches.length - 1][1] : null;
  };
  return { yes: findStateBefore("Yes"), no: findStateBefore("No") };
}

Deno.test("RE851A subordination provision — checked: Yes=☑, No=☐", () => {
  const out = run("true");
  const states = checkboxStatesAroundLabels(out);
  assertEquals(states.yes, "1", "Yes checkbox should be checked");
  assertEquals(states.no, "0", "No checkbox should be unchecked");
  // Display glyphs should reflect the state too
  const yesIdx = out.indexOf(" Yes");
  const yesRegion = out.substring(Math.max(0, yesIdx - 800), yesIdx);
  assertStringIncludes(yesRegion, "☑");
  const noIdx = out.indexOf(" No");
  const noRegion = out.substring(Math.max(0, noIdx - 800), noIdx);
  assertStringIncludes(noRegion, "☐");
});

Deno.test("RE851A subordination provision — unchecked: Yes=☐, No=☑", () => {
  const out = run("false");
  const states = checkboxStatesAroundLabels(out);
  assertEquals(states.yes, "0", "Yes checkbox should be unchecked");
  assertEquals(states.no, "1", "No checkbox should be checked");
});

// ---------------------------------------------------------------------------
// Clean Handlebars text-checkbox shape — the user's pasted RE851A snippet:
//   {{#if ln_p_subordinationProvision}}☑{{else}}☐{{/if}} Yes
//   {{#if ln_p_subordinationProvision}}☐{{else}}☑{{/if}} No
// Reproduces a Word run split where both branch glyphs survive into the
// safety pass. The new paragraph-scoped Yes/No normalizer must remove the
// wrong glyph and leave exactly the correct one immediately before the label.
// ---------------------------------------------------------------------------

function buildHandlebarsFixture(): string {
  const yesRow =
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">{{#if ln_p_subordinationProvision}}</w:t></w:r>` +
    `<w:r><w:t>☑</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">{{else}}</w:t></w:r>` +
    `<w:r><w:t>☐</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">{{/if}}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> Yes</w:t></w:r>` +
    `</w:p>`;
  const noRow =
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">{{#if ln_p_subordinationProvision}}</w:t></w:r>` +
    `<w:r><w:t>☐</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">{{else}}</w:t></w:r>` +
    `<w:r><w:t>☑</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">{{/if}}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> No</w:t></w:r>` +
    `</w:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">There are subordination provisions.</w:t></w:r></w:p>
${yesRow}
${noRow}
<w:p><w:r><w:t>PART 4 MULTI-LENDER TRANSACTIONS</w:t></w:r></w:p>
</w:body></w:document>`;
}

function runHandlebars(value: "true" | "false"): string {
  const fieldValues = new Map<string, FieldValueData>([
    ["ln_p_subordinationProvision", { rawValue: value, dataType: "boolean" }],
    ["loan_terms.subordination_provision", { rawValue: value, dataType: "boolean" }],
  ]);
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>([
    "ln_p_subordinationProvision",
    "loan_terms.subordination_provision",
  ]);
  return replaceMergeTags(buildHandlebarsFixture(), fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, "RE851A");
}

function runHandlebarsSameParagraph(value: "true" | "false"): string {
  const fieldValues = new Map<string, FieldValueData>([
    ["ln_p_subordinationProvision", { rawValue: value, dataType: "boolean" }],
    ["loan_terms.subordination_provision", { rawValue: value, dataType: "boolean" }],
  ]);
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>([
    "ln_p_subordinationProvision",
    "loan_terms.subordination_provision",
  ]);
  const fixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">There are subordination provisions.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">{{#if ln_p_subordinationProvision}}☑{{else}}☐{{/if}} Yes</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">{{#if ln_p_subordinationProvision}}☐{{else}}☑{{/if}} No</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 4 MULTI-LENDER TRANSACTIONS</w:t></w:r></w:p>
</w:body></w:document>`;
  return replaceMergeTags(fixture, fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, "RE851A");
}

function visibleGlyphsBeforeLabel(xml: string, label: string): string {
  const idx = xml.indexOf(` ${label}`);
  if (idx < 0) return "";
  const region = xml.substring(Math.max(0, idx - 500), idx);
  const plain = region.replace(/<[^>]*>/g, "");
  return (plain.match(/[☐☑☒]/g) || []).join("");
}

Deno.test("RE851A subordination provision (Handlebars text) — checked: only ☑ before Yes, only ☐ before No", () => {
  const out = runHandlebars("true");
  const yesGlyphs = visibleGlyphsBeforeLabel(out, "Yes");
  const noGlyphs = visibleGlyphsBeforeLabel(out, "No");
  assertEquals(yesGlyphs.slice(-1), "☑", `Yes label expected ☑, got "${yesGlyphs}"`);
  assertEquals(noGlyphs.slice(-1), "☐", `No label expected ☐, got "${noGlyphs}"`);
  if (out.includes("{{#if") || out.includes("{{/if}}") || out.includes("{{else}}")) {
    throw new Error("Handlebars markers should be stripped from rendered output");
  }
});

Deno.test("RE851A subordination provision (Handlebars text) — unchecked: only ☐ before Yes, only ☑ before No", () => {
  const out = runHandlebars("false");
  const yesGlyphs = visibleGlyphsBeforeLabel(out, "Yes");
  const noGlyphs = visibleGlyphsBeforeLabel(out, "No");
  assertEquals(yesGlyphs.slice(-1), "☐", `Yes label expected ☐, got "${yesGlyphs}"`);
  assertEquals(noGlyphs.slice(-1), "☑", `No label expected ☑, got "${noGlyphs}"`);
});

Deno.test("RE851A subordination provision (same paragraph text) — unchecked: Yes=☐, No=☑", () => {
  const out = runHandlebarsSameParagraph("false");
  const yesGlyphs = visibleGlyphsBeforeLabel(out, "Yes");
  const noGlyphs = visibleGlyphsBeforeLabel(out, "No");
  assertEquals(yesGlyphs.slice(-1), "☐", `Yes label expected ☐, got "${yesGlyphs}"`);
  assertEquals(noGlyphs.slice(-1), "☑", `No label expected ☑, got "${noGlyphs}"`);
  if (out.includes("{{#if") || out.includes("{{/if}}") || out.includes("{{else}}")) {
    throw new Error("Handlebars markers should be stripped from same-paragraph rendered output");
  }
});

// ---------------------------------------------------------------------------
// Live RE851A layout (uploaded screenshot): Yes already has ☐ but No has NO
// checkbox glyph at all in the authored template. Each label sits in its own
// paragraph with no Handlebars markers and no SDT block. The safety pass
// must inject the correct glyph before the bare "No" label so the unchecked
// state visibly shows "☑ No".
// ---------------------------------------------------------------------------

function runBareNoLabel(value: "true" | "false"): string {
  const fieldValues = new Map<string, FieldValueData>([
    ["ln_p_subordinationProvision", { rawValue: value, dataType: "boolean" }],
    ["loan_terms.subordination_provision", { rawValue: value, dataType: "boolean" }],
  ]);
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>([
    "ln_p_subordinationProvision",
    "loan_terms.subordination_provision",
  ]);
  const fixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">{{deal.id}}</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">There are subordination provisions.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">If YES, explain here or on an attachment.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">☐ Yes</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">No</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 4 MULTI-LENDER TRANSACTIONS</w:t></w:r></w:p>
</w:body></w:document>`;
  return replaceMergeTags(fixture, fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, "RE851A");
}

Deno.test("RE851A subordination provision (bare No label) — unchecked: Yes=☐, No=☑", () => {
  const out = runBareNoLabel("false");
  const yesGlyphs = visibleGlyphsBeforeLabel(out, "Yes");
  const noGlyphs = visibleGlyphsBeforeLabel(out, "No");
  assertEquals(yesGlyphs.slice(-1), "☐", `Yes label expected ☐, got "${yesGlyphs}"`);
  assertEquals(noGlyphs.slice(-1), "☑", `No label expected ☑, got "${noGlyphs}"`);
});

Deno.test("RE851A subordination provision (bare No label) — checked: Yes=☑, No=☐", () => {
  const out = runBareNoLabel("true");
  const yesGlyphs = visibleGlyphsBeforeLabel(out, "Yes");
  const noGlyphs = visibleGlyphsBeforeLabel(out, "No");
  assertEquals(yesGlyphs.slice(-1), "☑", `Yes label expected ☑, got "${yesGlyphs}"`);
  assertEquals(noGlyphs.slice(-1), "☐", `No label expected ☐, got "${noGlyphs}"`);
});

// ---------------------------------------------------------------------------
// (eq KEY "true") explicit boolean check — the syntax requested by the user.
// Verifies both string-literal and bareword boolean comparisons render the
// correct glyph immediately before each Yes / No label, regardless of CSR
// state.
// ---------------------------------------------------------------------------

function runEqHelper(value: "true" | "false", literal: 'true' | '"true"'): string {
  const fieldValues = new Map<string, FieldValueData>([
    ["ln_p_subordinationProvision", { rawValue: value, dataType: "boolean" }],
    ["loan_terms.subordination_provision", { rawValue: value, dataType: "boolean" }],
  ]);
  const fieldTransforms = new Map<string, string>();
  const mergeTagMap: Record<string, string> = {};
  const labelMap: Record<string, LabelMapping> = {};
  const validFieldKeys = new Set<string>([
    "ln_p_subordinationProvision",
    "loan_terms.subordination_provision",
  ]);
  const fixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">There are subordination provisions.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">{{#if (eq ln_p_subordinationProvision ${literal})}}☑{{else}}☐{{/if}} Yes</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">{{#if (eq ln_p_subordinationProvision ${literal})}}☐{{else}}☑{{/if}} No</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 4 MULTI-LENDER TRANSACTIONS</w:t></w:r></w:p>
</w:body></w:document>`;
  return replaceMergeTags(fixture, fieldValues, fieldTransforms, mergeTagMap, labelMap, validFieldKeys, "RE851A");
}

Deno.test("RE851A subordination provision — (eq KEY \"true\") checked", () => {
  const out = runEqHelper("true", '"true"');
  assertEquals(visibleGlyphsBeforeLabel(out, "Yes").slice(-1), "☑");
  assertEquals(visibleGlyphsBeforeLabel(out, "No").slice(-1), "☐");
  if (out.includes("{{#if") || out.includes("{{/if}}") || out.includes("{{else}}") || out.includes("(eq")) {
    throw new Error("(eq) helper markers should be stripped from rendered output");
  }
});

Deno.test("RE851A subordination provision — (eq KEY \"true\") unchecked", () => {
  const out = runEqHelper("false", '"true"');
  assertEquals(visibleGlyphsBeforeLabel(out, "Yes").slice(-1), "☐");
  assertEquals(visibleGlyphsBeforeLabel(out, "No").slice(-1), "☑");
});

Deno.test("RE851A subordination provision — (eq KEY true) bareword bool checked", () => {
  const out = runEqHelper("true", 'true');
  assertEquals(visibleGlyphsBeforeLabel(out, "Yes").slice(-1), "☑");
  assertEquals(visibleGlyphsBeforeLabel(out, "No").slice(-1), "☐");
});

Deno.test("RE851A subordination provision — (eq KEY true) bareword bool unchecked", () => {
  const out = runEqHelper("false", 'true');
  assertEquals(visibleGlyphsBeforeLabel(out, "Yes").slice(-1), "☐");
  assertEquals(visibleGlyphsBeforeLabel(out, "No").slice(-1), "☑");
});

Deno.test("RE851A financial statement section — No-only rows do not keep manual line breaks", () => {
  const fieldValues = new Map<string, FieldValueData>([
    ["origination_app.financials.performed_by", { rawValue: "Borrower", dataType: "text" }],
    ["origination_app.doc.additional_info_attached", { rawValue: "false", dataType: "boolean" }],
  ]);
  const fixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>
<w:p><w:r><w:t xml:space="preserve">Financial Statements have been audited by CPA or PA. {{#if (eq origination_app.financials.performed_by "CPA")}}☑{{else}}☐{{/if}}YES</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Additional information is included on an attached addendum {{#if origination_app.doc.additional_info_attached}}☑{{else}}☐{{/if}} Yes</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr><w:r><w:br/></w:r><w:r><w:t xml:space="preserve"> {{#if origination_app.doc.additional_info_attached}}☐{{else}}☑{{/if}} No</w:t></w:r></w:p>
<w:p><w:r><w:t>PART 8</w:t></w:r></w:p>
</w:body></w:document>`;
  const out = replaceMergeTags(fixture, fieldValues, new Map(), {}, {}, new Set([
    "origination_app.financials.performed_by",
    "origination_app.doc.additional_info_attached",
  ]), "RE851A");
  const noIdx = out.indexOf(" No");
  const noParaStart = out.lastIndexOf("<w:p", noIdx);
  const noParaEnd = out.indexOf("</w:p>", noIdx);
  const noPara = out.slice(noParaStart, noParaEnd);
  assertEquals(noPara.includes("<w:br"), false);
  assertEquals(noPara.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(), "☑ No");
});

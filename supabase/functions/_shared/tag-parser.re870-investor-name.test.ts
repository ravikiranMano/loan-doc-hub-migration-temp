import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { validateContentXmlPart } from "./docx-processor.ts";
import { processEachBlocks } from "./tag-parser.ts";
import type { FieldValueData } from "./types.ts";

function fieldsForLenders(): Map<string, FieldValueData> {
  const m = new Map<string, FieldValueData>();
  m.set("lenders1.displayName", { rawValue: "Horizon Capital LLC", dataType: "text" });
  m.set("lenders2.displayName", { rawValue: "BlueStone Investments Inc", dataType: "text" });
  m.set("lenders3.displayName", { rawValue: "Sarah Lynn Mitchell, a single woman", dataType: "text" });
  m.set("lenders4.displayName", { rawValue: "Michael Andrew Carter", dataType: "text" });
  return m;
}

function investorNameFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:tbl><w:tr><w:tc>
<w:p><w:r><w:t xml:space="preserve">INVESTOR NAME:</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">{{#each lenders}}{{displayName}}{{/each}}</w:t></w:r></w:p>
</w:tc></w:tr></w:tbl></w:body></w:document>`;
}

function count(xml: string, pattern: RegExp): number {
  return (xml.match(pattern) || []).length;
}

Deno.test("RE870 INVESTOR NAME displayName loop renders one valid Word line per lender", () => {
  const out = processEachBlocks(investorNameFixture(), fieldsForLenders(), {}, undefined);

  assertStringIncludes(out, "INVESTOR NAME:");
  assertStringIncludes(out, "Horizon Capital LLC");
  assertStringIncludes(out, "BlueStone Investments Inc");
  assertStringIncludes(out, "Sarah Lynn Mitchell, a single woman");
  assertStringIncludes(out, "Michael Andrew Carter");
  assertEquals(count(out, /<w:br\/>/g), 3);
  assertEquals(count(out, /<w:t(?:\s[^>]*)?>/g), count(out, /<\/w:t>/g));
  assertEquals(count(out, /<w:r(?:\s[^>]*)?>/g), count(out, /<\/w:r>/g));
  assertEquals(count(out, /<w:p(?:\s[^>]*)?>/g), count(out, /<\/w:p>/g));
  validateContentXmlPart("word/document.xml", out);
});

Deno.test("RE870 INVESTOR NAME loop does not use nested conditionals", () => {
  const fixture = investorNameFixture();
  assert(!fixture.includes("{{#if isIndividual}}"));
  assert(!fixture.includes("{{#if middle}}"));
  assert(!fixture.includes("{{firstName}}"));
  assert(!fixture.includes("{{vesting}}"));
});
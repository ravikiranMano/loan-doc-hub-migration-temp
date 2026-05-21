# Add missing INVESTOR header row to RE870 Investor Questionnaire

## Problem
The generated Investor Questionnaire (RE870) is missing the top header row of the main investor table — a 3-cell row with two gray (`A6A6A6`) spacer cells flanking a centered, bold **INVESTOR** label spanning 2 columns. The row containing `INVESTOR NAME:` appears as the first `<w:tr>` immediately after `</w:tblGrid>` with no header above it.

Confirmed from `Investor_Questionnaire_v38.docx`:
- `<w:tbl>` → `<w:tblGrid>` columns: `3313 / 2189 / 2326 / 3173`
- First `<w:tr>` is the data row containing `INVESTOR NAME:` (no header row precedes it)

The header dimensions the user supplied (`3313 / 4515 gridSpan=2 / 3173`) match the existing tblGrid exactly (`2189+2326=4515`), so the header row will align perfectly.

## Fix scope — single narrow pass in the existing rewriter

Edit only `supabase/functions/rewrite-re870-multi-lender/index.ts`. Add one new pass `ensureInvestorHeaderRow(xml)` and invoke it once at the end of the rewrite pipeline (after the existing Pass B / Pass D INVESTOR NAME cell work, before the function returns the rewritten XML).

### What the pass does
1. Locate the `<w:tbl>` whose first data row contains a `<w:tc>` with visible text matching `INVESTOR NAME` (reuse existing `findCells` / `isInvestorNameCellText` helpers).
2. Walk back from that `<w:tr>` to the immediately preceding sibling. If it is already an `INVESTOR` header row (a `<w:tr>` whose visible text trimmed == `"INVESTOR"`), do nothing — idempotent.
3. Otherwise, insert the canonical header row XML at the position right after `</w:tblGrid>` (i.e. directly before the first `<w:tr>` of that table):

```xml
<w:tr>
  <w:trPr><w:trHeight w:val="230"/></w:trPr>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3313" w:type="dxa"/>
      <w:tcBorders><w:left w:val="nil"/></w:tcBorders>
      <w:shd w:val="clear" w:color="auto" w:fill="A6A6A6"/>
    </w:tcPr>
    <w:p/>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="4515" w:type="dxa"/>
      <w:gridSpan w:val="2"/>
    </w:tcPr>
    <w:p>
      <w:pPr>
        <w:spacing w:line="210" w:lineRule="auto"/>
        <w:jc w:val="center"/>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
        <w:t>INVESTOR</w:t>
      </w:r>
    </w:p>
  </w:tc>
  <w:tc>
    <w:tcPr>
      <w:tcW w:w="3173" w:type="dxa"/>
      <w:tcBorders><w:right w:val="nil"/></w:tcBorders>
      <w:shd w:val="clear" w:color="auto" w:fill="A6A6A6"/>
    </w:tcPr>
    <w:p/>
  </w:tc>
</w:tr>
```

4. Return the modified XML plus a `note` ("INVESTOR header row inserted" / "already present" / "table not found") for the existing debug response.

### Scope guards
- Match only inside a `<w:tbl>` whose tblGrid widths are exactly `3313 / 2189 / 2326 / 3173` (the canonical RE870 investor table), so we never touch unrelated tables.
- Skip if a preceding `<w:tr>` with visible text `INVESTOR` already exists (idempotent re-runs).
- No changes to any other field, conditional, loop, or downstream pass.

## Files changed
- `supabase/functions/rewrite-re870-multi-lender/index.ts` — add `ensureInvestorHeaderRow` and call it once at the end of the rewrite pipeline.

## Files NOT changed
- The stored template document.
- `generate-document/index.ts`, `_shared/tag-parser.ts`, field resolvers, or any other field mapping.
- Other tables, paragraphs, or alignment in the document (the other `<w:jc w:val="center"/>` items the user mentioned at template lines 7966 / 8314 already exist in the generated output — only the header row is missing, which is the single high-impact diff).

## Verification
1. Re-generate the RE870 Investor Questionnaire for the same deal.
2. Unzip and confirm `word/document.xml` now contains a `<w:tr>` with centered `<w:t>INVESTOR</w:t>` immediately after `</w:tblGrid>` and before the `INVESTOR NAME` row.
3. Open in Word: header row renders with gray spacers and centered bold "INVESTOR".
4. Re-run generation a second time and confirm no duplicate header is added (idempotent).

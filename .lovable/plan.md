## Findings

The generated `RE851D_v89` is still mismatching the reference for the first two encumbrance rows because the checkbox paragraphs are being placed inside the wrong section-flow position.

Reference structure around the two affected rows:

```text
Question: Are there any encumbrances...
blank spacer
Question A: Over the last 12 months...
YES/NO row for encumbrance-of-record
blank spacer
YES/NO row for 60-days-late
blank section-break paragraph that starts the two-column area
```

Generated structure currently has extra/incorrect paragraph artifacts:

```text
Question: Are there any encumbrances...
blank spacer
Question A: Over the last 12 months...   [extra trailing spaces]
YES/NO row appears too early / in wrong flow
extra blank keepNext/keepLines paragraph
extra blank keepLines paragraph
extra blank paragraph
YES/NO row carries the section break itself
```

That is why the first two YES/NO rows do not visually match `re851d - LPDS Multi-property`.

## Plan

1. Update only `supabase/functions/rewrite-re851d-encumbrance-layout/index.ts`.
2. Keep all field keys and checkbox logic unchanged.
3. Stop attaching the two-column `<w:sectPr>` to a visible YES/NO checkbox paragraph.
4. Move/normalize that section break onto a blank paragraph immediately after the second YES/NO row, matching the reference document.
5. For only the two affected checkbox families:
   - `pr_li_encumbranceOfRecord_N`
   - `pr_li_delinqu60day_N`
   normalize the paragraph sequence to match the reference:
   ```text
   encumbrance question
   blank spacer
   60-days-late question
   encumbrance YES/NO row
   blank spacer
   60-days-late YES/NO row
   blank section-break paragraph
   ```
6. Remove generated-only formatting artifacts from these rows:
   - trailing whitespace after the 60-days-late question
   - `keepNext`/`keepLines` added to blank spacer rows
   - section properties on visible checkbox rows
7. Preserve existing formatting for later encumbrance rows unless they are part of the same repeated property section and need the same reference-safe normalization.
8. After implementation, compare the DOCX XML for generated vs reference around all 5 property encumbrance sections to confirm:
   - the two visible YES/NO rows are in the same paragraph order as the reference,
   - the two-column section break is on the blank paragraph,
   - no orphaned visible checkbox row carries section properties,
   - no business logic or tag names changed.
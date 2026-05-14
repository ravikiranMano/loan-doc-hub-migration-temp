## Goal
Make every YES/NO checkbox pair in the RE851D ENCUMBRANCE INFORMATION section render on the SAME line as its question, right-aligned to the page/cell margin — matching the reference layout in `re851d - LPDS Multi-property.docx`. Logic, field keys, and checkbox evaluation are unchanged.

## What's wrong now
The previous rewrite already merges YES + NO into one paragraph and glues them with a non-breaking space. But the merged paragraph is its own line BELOW the question text, so the checkboxes appear under the question instead of to the right of it. In narrow table cells the pair can also still wrap.

## Fix (formatting only, in `rewrite-re851d-encumbrance-layout/index.ts`)

For each of the 4 families (`encumbranceOfRecord`, `delinqu60day`, `currentDelinqu`, `delinquencyPaidByLoan`) across all property indices N:

1. **Locate the question paragraph** that immediately precedes the YES paragraph (the paragraph whose stripped text contains the question phrase, e.g. "encumbrances of record", "60 days late", "remain unpaid", "cure the delinquency"/"paid by this loan").
2. **Append the YES + NBSP + NO runs into that question paragraph**, preceded by a single TAB run (`<w:r><w:tab/></w:r>`).
3. **Add a right-aligned tab stop** to the question paragraph's `<w:pPr>` so the checkboxes snap to the right margin:
   ```xml
   <w:tabs><w:tab w:val="right" w:leader="none" w:pos="9360"/></w:tabs>
   ```
   - `9360` twips = 6.5" (US Letter content width). Inside table cells we still target the same value; Word clamps tabs at the cell's right edge, which gives the right-aligned look in both contexts.
4. **Add `<w:keepLines/>`** to the question paragraph so Word never breaks the question text away from its checkboxes.
5. **Drop the now-empty YES paragraph and the NO paragraph** (and any blank paragraphs between question/YES/NO).
6. **Idempotency:** if the question paragraph already contains a `_yes_glyph` tag for that family, skip — the rewrite has already been applied.
7. **Strict scoping:** only paragraphs matched by the question-phrase regex AND followed within ≤6 paragraphs by a YES paragraph for the same family are touched. Nothing else in the document is modified.

## Reference matching
The structure produced will mirror `re851d - LPDS Multi-property.docx`:

```text
Question text ...........................................[TAB→right] ☐ YES &nbsp; ☐ NO
```

A single paragraph, with a right-tab stop pulling the checkbox glyphs to the right margin, and `keepLines` preventing splits.

## Out of scope
- No changes to field keys, glyph resolution, or which box gets checked.
- No `{{#if}}` conditionals.
- No schema/UI changes.
- No changes to other sections, tables, or paragraphs.

## Deploy + verify
1. Deploy `rewrite-re851d-encumbrance-layout`.
2. Invoke once against `1778746922135_RE851D-V12.1.docx`.
3. Unpack the rewritten DOCX and confirm:
   - Each of the 4 question paragraphs (× 5 properties) contains: question text → `<w:tab/>` → `_yes_glyph` tag → YES → `&#160;` → `_no_glyph` tag → NO, all in one `<w:p>`.
   - Each such paragraph's `<w:pPr>` has `<w:tabs><w:tab w:val="right" .../></w:tabs>` and `<w:keepLines/>`.
   - No orphan YES-only or NO-only paragraphs remain for these families.
4. Regenerate RE851D for `DL-2026-0250` and visually confirm the layout matches the reference attachment for every property.

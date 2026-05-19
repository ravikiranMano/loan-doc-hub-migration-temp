## RE851D PROPERTY TYPE — alignment & checkbox normalization

Extend the existing post-render passes in `supabase/functions/generate-document/index.ts` with a new RE851D-scoped safety pass that fixes the PROPERTY TYPE block (question 4) without touching template variables, glyph state, table structure, or column widths.

### Scope

- Applies only when `template.name` matches `/851d/i`.
- Operates on `word/document.xml`, headers, and footers — same envelope used by the existing PROPERTY TYPE spacing pass at lines 8308–8416.
- Runs across every paragraph that visibly belongs to a PROPERTY TYPE row, so all 5 per-property instances are normalized in one pass.

### Row detection

A paragraph qualifies as a PROPERTY TYPE row when its visible text contains exactly one of the 6 right/left-column labels:

- Left column: `SINGLE-FAMILY RESIDENCE (owner occupied)`, `SINGLE-FAMILY RESIDENCE (not owner occupied)`, `SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)`
- Right column: `COMMERCIAL & INCOME-PRODUCING`, `LAND ZONED`, `LAND INCOME PRODUCING` (paired with `OTHER`)

Rows are grouped by visible-label match — independent of where the paragraph sits in the table — so the pass is idempotent and works on all 5 instances.

### Fix steps per qualifying paragraph

1. **Strip stray `<w:br/>` runs** anywhere inside the paragraph (the existing PROPERTY TYPE pass already strips `<w:br/>` from rows that begin with a glyph; this pass widens the gate to also catch the `COMMERCIAL & INCOME-PRODUCING` row whose paragraph begins with an SDT/plain-text checkbox where the leading glyph detection misses).

2. **Force the spacing element** inside `<w:pPr>` to the exact reference values, matching the row index:
   - Row 1 (owner occupied / commercial): `<w:spacing w:before="26" w:after="100" w:line="181" w:lineRule="auto"/>`
   - Row 2 (not owner occupied / land zoned): `<w:spacing w:before="12" w:after="100" w:line="181" w:lineRule="auto"/>`
   - Row 3 (zoned residential lot / land income producing + other): `<w:spacing w:before="12" w:after="100" w:line="173" w:lineRule="auto"/>`
   - If `<w:pPr>` is missing, insert one; if `<w:spacing>` is missing, insert it in schema-correct position; if present, replace its attributes only.

3. **Promote plain-text checkbox glyphs to SDT content controls.** When the paragraph contains a `☐` / `☑` / `☒` character as a plain `<w:t>` run (not already wrapped in `<w:sdt>` with a `<w14:checkbox>`), replace that run with a `<w:sdt>` block carrying:
   - `<w:sdtPr>` → `<w14:checkbox><w14:checked w14:val="1|0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>` plus a stable `<w:id/>`
   - `<w:sdtContent>` containing the original `<w:r>` with the glyph preserved
   - `w14:checked` value derived from the existing glyph (`☑`/`☒` → 1, `☐` → 0) so the checked state is unchanged
   - Original `<w:rPr>` (font/size/color) is carried over verbatim

4. Leave untouched: glyph state (other than wrapping), `{{...}}` placeholders, label text, column widths, table grid, alignment/tabs/indent, `<w:rPr>`.

### Ordering & integration

- Insert immediately AFTER the existing "RE851D POST-RENDER PROPERTY TYPE checkbox spacing safety pass" (ends line 8416) and BEFORE the encumbrance-question cleanup at 8422.
- Uses the same `__passUnzip` / `__passZip` / `__xmlGet` / `__xmlSet` helpers and `debugLog` pattern as neighboring passes.
- Reassigns `processedDocx` only when the pass actually mutates at least one paragraph; otherwise no-op.
- Wrapped in try/catch so a regex failure logs and continues, matching the surrounding pass style.

### Verification

- Re-run RE851D generation on a 5-property deal; download the docx; unzip; for each of the 5 PROPERTY TYPE blocks confirm:
  - Zero `<w:br/>` inside any of the 6 row paragraphs
  - Spacing attributes match the 3-tier table above
  - Every checkbox glyph is inside `<w:sdt>` with `<w14:checkbox>`
  - `{{property_type_*_N}}` placeholders untouched, checked/unchecked state preserved
- Confirm idempotency: running the pass twice yields identical XML on the second run.

### Files touched

- `supabase/functions/generate-document/index.ts` — single additive block (~120 lines) following the established post-render-pass pattern. No schema, no API, no UI, no template storage changes.
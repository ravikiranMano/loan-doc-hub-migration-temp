## Goal

Fix RE851D PROPERTY TYPE rendering so all 5 property sections look identical to Image 2, and fix the `10.64%%` double-percent bug. Do it at the **template source**, not with another post-render patch — the existing post-render passes have proven brittle and order-dependent.

## Approach

Mirror the pattern already used by `supabase/functions/rewrite-re851d-template/index.ts` and `rewrite-re851d-encumbrance-layout/index.ts`: a one-shot admin edge function that downloads the template from the `templates` bucket, rewrites `word/document.xml`, and re-uploads. Idempotent, safe to re-run.

Then retire the now-redundant PROPERTY TYPE post-render passes in `generate-document/index.ts` so we have a single source of truth.

## New edge function: `rewrite-re851d-property-type-layout`

Default `templatePath`: `1778746922135_RE851D-V12.1.docx` (same as the other rewriters).

### 1. Locate every PROPERTY TYPE table

Scan `word/document.xml` for `<w:tbl>` blocks whose tag-stripped text contains all of:
- `SINGLE-FAMILY RESIDENCE (owner`
- `COMMERCIAL`
- `LAND`

Expect 5 matches (one per property section). Log a warning if the count differs but still process whatever is found.

### 2. Rebuild each matched table deterministically

For each match, replace the table with a freshly generated `<w:tbl>` built from a fixed XML template string. The new table:

- `<w:tblPr>` includes:
  - `<w:tblW w:w="5000" w:type="pct"/>` (100% page width)
  - `<w:tblLayout w:type="fixed"/>` (FIXED layout — never auto)
  - Preserves borders from the original (`<w:tblBorders>` copied verbatim if present, else none)
- `<w:tblGrid>` = two columns of equal DXA derived from the original table's grid sum (fallback: 4680 + 4680)
- Two `<w:tc>` per row, each with `<w:tcW w:w="2500" w:type="pct"/>`
- Cell margins copied from original `<w:tblCellMar>` if present (consistent across all 5)

Capture the property index `N` by reading the existing `{{property_type_*_N}}` placeholders inside the matched table (regex on `property_type_sfr_owner_(\d+)`). If absent (blank template instance 1), default to the literal token `N`.

### 3. Left cell — exactly 3 paragraphs

```
{{property_type_sfr_owner_N}} SINGLE-FAMILY RESIDENCE (owner occupied)
{{property_type_sfr_non_owner_N}} SINGLE-FAMILY RESIDENCE (not owner occupied)
{{property_type_sfr_zoned_N}} SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)
```

Each as a single `<w:p>` with `<w:pPr><w:jc w:val="left"/></w:pPr>`, no tabs, no `<w:br/>`, no justified alignment. The checkbox glyph stays as a Handlebars merge tag (existing rendering pipeline converts it to an SDT content control later).

### 4. Right cell — exactly 4 paragraphs (OTHER on its own row)

```
{{property_type_commercial_N}} COMMERCIAL & INCOME-PRODUCING
{{property_type_land_zoned_N}} LAND (zoned commercial/residential)
{{property_type_land_income_N}} LAND (income-producing)
{{property_type_other_N}} OTHER: {{property_type_other_text_N}}
```

Same `<w:pPr>` rules. The `&` is encoded `&amp;`. The OTHER paragraph is always emitted, even when the row is currently inlined or merged in the source.

### 5. Left cell paragraph 4

No 4th paragraph. The right cell's 4th row simply makes the row taller; the left cell remains 3 paragraphs and visually empty below row 3, matching Image 2.

### 6. Fix double-% on LTV (same function, separate pass)

Scan the full XML for any `<w:t>` run whose text contains `{{ln_p_loanToValueRatio_N}}%` or `{{ln_p_loanToValueRatio_<digit>}}%` (and entity-escaped variants). Strip the trailing literal `%`. The resolved value already includes `%` because the field is `dataType: "percentage"` (confirmed at `generate-document/index.ts:1793`, `2327`, `4505`).

This is tag-stripped-index safe (the same buildStrippedIndex helper used by the existing rewriter) so it survives run splits across `{{`, `ln_p_loanToValueRatio_N`, `}}`, and `%`.

### 7. Repack and upload

- `fflate.zipSync` → upload back to same path with `upsert: true`.
- Response: `{ ok, rewrittenTables, ltvPercentsStripped, originalSize, newSize }`.

### Idempotency

- Property-type rewrite keys on text content `SINGLE-FAMILY RESIDENCE (owner` + `COMMERCIAL` + `LAND` co-occurring inside a `<w:tbl>`. After rewrite the table still matches — so re-running rebuilds it from the same deterministic template, byte-identical output.
- LTV `%` strip is a no-op once the trailing `%` is gone.

## Retire redundant post-render passes in `generate-document/index.ts`

Once the template is rewritten, remove (or gate behind `template.name !~ /re851d.*v12\.2/i`) the following passes inside `if (/851d/i.test(template.name))`:

- The PROPERTY TYPE spacing/row pass (lines ~8290–8416)
- The PROPERTY TYPE row alignment + SDT wrapping pass (lines ~8418–~8620) — but **keep** the `wrapPlainGlyphs`→SDT conversion, since the checkbox glyphs still need SDT promotion. Extract just that helper and run it scoped to the PROPERTY TYPE tables. Drop the row-detection, `<w:br/>` stripping, spacing overrides, "owner occupied" normalization, "LAND(zoned" fix, and the instance-5 OTHER splitter — all obsoleted by the template fix.

This deletes ~250 lines of fragile post-render code.

## Files touched

- `supabase/functions/rewrite-re851d-property-type-layout/index.ts` — new (~250 lines)
- `supabase/functions/generate-document/index.ts` — remove obsolete PROPERTY TYPE passes, keep glyph→SDT wrapper
- `.lovable/plan.md` — replace with this plan

No schema changes. No UI changes. No new tables. No changes to merge-tag names or server-side data resolution.

## Verification

1. Deploy `rewrite-re851d-property-type-layout` and invoke it once. Expect `rewrittenTables: 5` (or 5+ depending on extra blank copies) and `ltvPercentsStripped >= 5`.
2. Re-invoke — expect `rewrittenTables: 5, ltvPercentsStripped: 0` (idempotent).
3. Re-generate RE851D for the current 5-property deal. Check:
   - All 5 PROPERTY TYPE blocks visually match Image 2
   - Right column shows OTHER on its own 4th row in every section
   - `owner occupied` never has extra spacing
   - `COMMERCIAL` never wraps mid-word
   - `LOAN TO VALUE RATIO*` shows `10.64%` (single `%`)
4. Re-generate a second time, byte-diff output → identical.

## RE851D PROPERTY TYPE — finish the alignment pass (instances 3, 4, 5)

The existing post-render passes in `supabase/functions/generate-document/index.ts` (lines 8308–8416 spacing pass, 8418–~8620 row/SDT pass) only catch the left-column rows and the COMMERCIAL row when the visible text already begins with a glyph. They miss the failures the user is still seeing on instances 3, 4, and 5 because:

- The `ROW_LABELS` regexes target `LAND ZONED` / `LAND INCOME PRODUCING`, but the template ships the labels as `LAND (zoned commercial/residential)` and `LAND (income-producing)` — so those rows never match.
- The wrap-plain-glyph helper only fires on runs whose `<w:t>` body is *just* the glyph; the LAND (income-producing) row stores it as `<w:t>☐ </w:t>` mixed with a trailing space and is followed by a separate label run, so it slips through.
- Instance 5 stores `☐ LAND (income-producing) ☐ OTHER: property_type_other_text_N}` as a single concatenated text run with no paragraph break and a malformed placeholder.

Extend the second pass (the row alignment + SDT pass that already starts at 8418) so it owns every one of the 5 issues. Single additive block, no schema/UI/template-storage changes.

### 1. Fix row-label coverage

Replace the right-column entries in `ROW_LABELS`:
- row 1 → `/COMMERCIAL\s*&(?:amp;)?\s*INCOME[-\s]?PRODUCING/i`
- row 2 → `/LAND\s*\(zoned\s+commercial\/residential\)/i`
- row 3 → `/LAND\s*\(income[-\s]?producing\)/i`
- row 3 also → `/^OTHER:/i` (so the OTHER row is normalized too)

Keep the left-column entries as they are. Add the same labels to the `xml` early-exit gate at line 8568.

### 2. PROBLEM 1 — strip `<w:br/>` before COMMERCIAL glyph and force `w:before="26"`

Inside the row-1 branch for the COMMERCIAL row, before running the existing spacing override:
- Strip all `<w:br/>` and `<w:tab/>` elements from the paragraph (already done globally in the spacing pass for glyph-leading paragraphs; replicate here for the COMMERCIAL paragraph regardless of leading glyph).
- Then call `setRowSpacing(para, 1)` so `w:before` becomes `26` (matches instance 2 which already renders correctly).

Idempotent — the spacing replacer already overwrites any existing `<w:spacing>` attributes.

### 3. PROBLEM 2 — promote LAND (income-producing) plain checkbox to SDT

Loosen `wrapPlainGlyphs` so that, in addition to "run body is just a glyph", it also wraps a run whose `<w:t>` body matches `^[\s\u00A0]*[\u2610\u2611\u2612][\s\u00A0]+$` (glyph + trailing whitespace, no label text). The glyph remains in the run, the trailing space stays, the run is wrapped in `<w:sdt><w14:checkbox>`.

Apply only when the paragraph's visible text matches one of the PROPERTY TYPE row labels (already gated). Do not split mixed-content runs that carry the label text — those are left alone.

### 4. PROBLEM 3 — split LAND (income-producing) + OTHER on instance 5

Add a paragraph-level rewriter that runs only when the paragraph's visible text matches both `LAND (income-producing)` AND `OTHER:`:

- Locate the single offending `<w:t>` run (text contains `LAND (income-producing)` followed by `☐ OTHER:` …).
- Replace its containing `<w:p>` with two sibling `<w:p>` paragraphs:
  - Paragraph A: `<w:pPr>` with `ROW_SPACING[3]`, then SDT-wrapped `☐` glyph + run carrying `LAND (income-producing)`.
  - Paragraph B: `<w:pPr>` with `ROW_SPACING[3]`, then SDT-wrapped `☐` glyph + run carrying `OTHER: {{property_type_other_text_N}}`.
- Preserve original `<w:rPr>` on both label runs (copy from the source run).
- Repair the placeholder: replace `property_type_other_text_N}` (missing leading `{{` and trailing `}`) with `{{property_type_other_text_N}}` only in this paragraph. `N` is taken from whatever index the source paragraph already references (regex-captured); if none is present, leave the placeholder as the literal token already in the template.

This whole rewriter is gated on the exact "LAND (income-producing) … OTHER:" co-occurrence, so it only fires on instance 5.

### 5. PROBLEM 4 — normalize "owner   occupied" spacing (all instances)

When a paragraph's visible text matches `/SINGLE-FAMILY RESIDENCE \(owner\s+occupied\)/i` with more than one space, replace inside each `<w:t>` body:
```
/(owner)[\s\u00A0]{2,}(occupied)/g  →  "$1 $2"
```
Idempotent: a single space is already a no-op.

### 6. PROBLEM 5 — add missing space after LAND in row-2 right (instances 3, 4)

For the row-2 right paragraph, normalize inside each `<w:t>` body:
```
/LAND\(zoned/g  →  "LAND (zoned"
```
Only run on paragraphs whose visible text contains `LAND(zoned commercial/residential)`. Idempotent.

### Integration & guarantees

- All changes live inside the existing `if (/851d/i.test(template.name || ""))` block at 8431; they reuse `__passUnzip` / `__passZip` / `__xmlGet` / `__xmlSet` / `debugLog` and the same try/catch pattern.
- Pass is idempotent: re-running on already-fixed XML mutates nothing because every transform is keyed on the broken state.
- Untouched: glyph checked/unchecked state, `{{...}}` placeholders other than the single malformed `property_type_other_text_N}`, column widths, table grid, borders, `<w:rPr>`, instance 1 (blank template — no row labels visible since values are empty placeholders, but the gates still apply uniformly; spacing/label fixes are safe no-ops on the blank instance), instance 2 (already correct — every transform is keyed on detecting the broken state so instance 2 hits zero mutations).

### Verification

1. Re-render RE851D on the current 5-property deal.
2. Unzip the output and confirm:
   - Each of the 5 COMMERCIAL paragraphs has zero `<w:br/>` and `<w:spacing w:before="26" …>`.
   - Each of the 5 LAND (income-producing) checkboxes is inside `<w:sdt><w14:checkbox>`.
   - Instance 5 has two separate `<w:p>` elements for LAND (income-producing) and OTHER, with the corrected `{{property_type_other_text_5}}` placeholder.
   - No `(owner  +occupied)` or `LAND(zoned` strings remain.
3. Re-run the same RE851D generation a second time on the same deal: byte-diff the two outputs to confirm idempotency.

### Files touched

- `supabase/functions/generate-document/index.ts` — extend the existing row alignment + SDT pass (~80 added lines). No other files.

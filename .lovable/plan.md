## Goal

In the generated RE851D document, force a single consistent space between each PROPERTY TYPE checkbox glyph (☐/☑/☒) and its label across all seven options, on every property block. Today the template's `{{#if property_type_sfr_owner_N}}☑{{else}}☐{{/if}} SINGLE-FAMILY RESIDENCE …` blocks resolve into runs where the gap between glyph and label is sometimes a tab, sometimes multiple spaces, sometimes nothing — depending on how Word fragmented the conditional. The fix normalizes this gap to exactly one space without touching the glyph state, the labels, the font, the paragraph alignment, or any other section.

## Scope

Single file edited:

- `supabase/functions/generate-document/index.ts` — add ONE new label-anchored post-render normalization pass for the seven PROPERTY TYPE labels. Inserted right after the existing "Source of Information row" safety pass added earlier (same `if (/851d/i.test(template.name || ""))` gate, same `__passUnzip` / `__xmlGet` / `__xmlSet` / `__passZip` helpers, same per-property region pattern used by the cure-delinquency and source-info passes).

No template re-uploads, no new edge function, no schema changes, no UI changes, no changes to which property type is checked (already correctly published per-property by the existing block around lines 1875–1965 and the `property_type_*_N` family in `RE851D_INDEXED_TAGS`).

## How it works (technical)

1. **Label set** (matched case-insensitive, whitespace-flex):
   - `SINGLE-FAMILY RESIDENCE (owner occupied)`
   - `SINGLE-FAMILY RESIDENCE (not owner occupied)`
   - `SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)`
   - `COMMERCIAL`
   - `LAND ZONED`
   - `LAND INCOME PRODUCING`
   - `OTHER`

   Labels are matched only when they appear in a paragraph whose visible text **starts with a checkbox glyph** (`☐ / ☑ / ☒`), so unrelated body prose containing the word `OTHER` or `COMMERCIAL` is never touched. Word-boundary guards (`(?<![A-Za-z])` / `(?![A-Za-z])`) apply to the bare-word labels (`COMMERCIAL`, `OTHER`, `LAND ZONED`, `LAND INCOME PRODUCING`).

2. For every matched paragraph, walk `<w:r>` runs in order:
   - Locate the run whose `<w:t>` text contains the trailing glyph character of the checkbox group (it may be a literal `☐`/`☑` glyph in a static run, or the resolved content of a `<w:sdt>` checkbox SDT).
   - Locate the next run whose `<w:t>` text begins with the label literal (after stripping leading whitespace).
   - Rewrite ONLY the whitespace between those two — drop any `<w:tab/>`, drop empty whitespace-only runs, and ensure the **label run** starts with exactly one regular space (`<w:t xml:space="preserve"> LABEL…</w:t>`).
   - If the glyph and label already share the same `<w:t>` (no inter-run gap), normalize the inline whitespace inside that `<w:t>` to a single space: `☐LABEL` → `☐ LABEL`, `☐\tLABEL` → `☐ LABEL`, `☐   LABEL` → `☐ LABEL`.

3. The pass is **idempotent**: a second invocation on already-normalized XML produces no diff.

4. **Out of scope for this pass** — explicitly NOT modified:
   - Which glyph appears (the checked/unchecked state stays whatever the upstream publisher / earlier safety passes set it to).
   - The label text itself.
   - The paragraph's `<w:pPr>` (alignment, tab stops, indent, spacing).
   - The run's `<w:rPr>` (font, size, color).
   - Anything outside the seven PROPERTY TYPE label paragraphs.
   - The `property_type_other_text_N` value rendered after the OTHER label — only the gap between `☐/☑` and the word `OTHER` is normalized.

## Verification

1. Regenerate the RE851D doc for the current deal and confirm visually that for every property block, all seven PROPERTY TYPE rows render as:
   ```
   ☐ SINGLE-FAMILY RESIDENCE (owner occupied)
   ☐ SINGLE-FAMILY RESIDENCE (not owner occupied)
   ☐ SINGLE-FAMILY RESIDENCE (zoned residential lot/parcel)
   ☐ COMMERCIAL …
   ☐ LAND ZONED …
   ☐ LAND INCOME PRODUCING …
   ☐ OTHER …
   ```
   with a single uniform gap between glyph and label, on every property page.
2. Edge function logs include `RE851D post-render property-type spacing pass: N row(s) normalized in word/document.xml` per property page.

## Not changing

- The `property_type_*` publisher (lines 1875–1965).
- `RE851D_INDEXED_TAGS` entries for property type.
- The DOCX template file.
- Any other RE851D safety pass.
- Source-of-information row pass (just added in the prior turn).
- UI, database, APIs.
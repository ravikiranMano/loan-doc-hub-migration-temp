## Goal

Fix the visual layout of Section 2 PROPERTY TYPE in the RE851D Word template so each property's options render in a clean, fixed two-column grid (3 rows left, 4 rows right) without cell collapse from long `{{property_type_*_N}}` placeholder text. No server-side logic, no variable names, and no other sections change.

## Approach

Add a new admin one-shot edge function (same pattern as the existing `rewrite-re851d-encumbrance-layout` and `rewrite-re851d-template` functions): download the template from the `templates` storage bucket, rewrite `word/document.xml`, repack, and re-upload. Idempotent and safe to re-run.

The function locates each per-property PROPERTY TYPE block (5 total) by anchoring on the unique set of placeholder names per index N (1–5), then replaces the entire block of paragraphs/tables that contain those placeholders with a single canonical fixed-layout 2-column borderless table.

## New file

`supabase/functions/rewrite-re851d-property-type-layout/index.ts`

### Behavior

For each N in 1..5:

1. Find the 8 placeholder occurrences for that property:
   - `{{property_type_sfr_owner_N}}`
   - `{{property_type_sfr_non_owner_N}}`
   - `{{property_type_sfr_zoned_N}}`
   - `{{property_type_commercial_N}}`
   - `{{property_type_land_zoned_N}}`
   - `{{property_type_land_income_N}}`
   - `{{property_type_other_N}}`
   - `{{property_type_other_text_N}}`
2. Compute the smallest contiguous range of top-level block elements (`<w:p>` and `<w:tbl>`) that encloses all 8 placeholders for that N, anchored after the `2. PROPERTY TYPE:` heading paragraph (kept intact).
3. Replace that range with one canonical `<w:tbl>` (see XML below).
4. Skip the property if the canonical table is already present (idempotency check: an existing `<w:tbl>` immediately after the heading whose stripped text contains all 8 tokens for that N and no others).

### Canonical table XML (per property)

- Table width: 9360 DXA (US Letter, 1" margins) with `<w:tblLayout w:type="fixed"/>`
- Two columns, 4680 DXA each
- `<w:tblBorders>` all set to `w:val="nil"` (no visible borders)
- Cell vertical alignment: top (`<w:vAlign w:val="top"/>`)
- Left cell: 3 `<w:p>` paragraphs, one per option (sfr_owner, sfr_non_owner, sfr_zoned)
- Right cell: 4 `<w:p>` paragraphs (commercial, land_zoned, land_income, other line)
- Each paragraph is a single line: `{{property_type_X_N}}` + single space + label text in one `<w:r>` chain (so it never splits across lines)
- The OTHER paragraph: `{{property_type_other_N}} OTHER: {{property_type_other_text_N}}` — three runs in one paragraph
- Paragraph properties: no special indent, default font matching surrounding template runs (copy `<w:rPr>` from the first existing placeholder run in the block to preserve font/size)

### Detection rules

- Use the same tag-stripped-with-offset-map approach as `rewrite-re851d-template/index.ts` so placeholders split across multiple `<w:r>` runs are still located.
- For each placeholder, walk up to its enclosing top-level `<w:p>` or `<w:tbl>` and record start/end offsets.
- The replacement range = min(start) .. max(end) across the 8 placeholders for that N.
- Validation: refuse to rewrite if the heading paragraph "2. PROPERTY TYPE:" (or the closest preceding "PROPERTY TYPE" heading) is included in the range — only the option rows are replaced.

### Response

Returns `{ ok, templatePath, propertiesRewritten, propertiesSkipped, originalSize, newSize }`.

## Invocation

After deploy, the user runs once (per template path) via the existing admin pattern:

```text
POST /functions/v1/rewrite-re851d-property-type-layout
{ "templatePath": "1778746922135_RE851D-V12.1.docx" }
```

Re-running is a no-op once normalized.

## Out of scope

- No changes to `supabase/functions/generate-document/index.ts`
- No changes to placeholder names, publishers, or any other section of the template
- No UI changes

## Technical notes

- DXA units: 1440 = 1 inch; table width 9360 = 6.5" content area, 4680 per column
- `<w:tblLayout w:type="fixed"/>` is the critical property that prevents Word from auto-resizing columns when the placeholder text is wide
- Borderless via `<w:tblBorders>` with all sides `w:val="nil"`; also set `<w:tcBorders>` nil on each cell for safety
- Preserve `xml:space="preserve"` on any `<w:t>` containing leading/trailing spaces (the space between glyph and label, and the spaces around "OTHER:")

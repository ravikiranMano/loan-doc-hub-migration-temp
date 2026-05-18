# RE851D — PROPERTY TYPE Consistency Pass (per-property)

## Goal
Every PROPERTY TYPE block (Property 1..K) renders with identical checkbox glyph size, identical spacing, vertically-aligned left/right columns, equal row heights, and a fixed right-column start — regardless of dynamic values (e.g., `OTHER: <text>`).

## Scope (single edit point)
File: `supabase/functions/generate-document/index.ts`
Section: the existing **RE851D POST-RENDER PROPERTY TYPE checkbox spacing safety pass** (≈ lines 8316–8424).

No template (.docx), publisher, alias, UI, schema, or API change. No other safety pass is touched.

## Out of scope
- The publisher that emits `property_type_*_N` / `_glyph` / `_text_N` (kept as-is).
- The RE851D template's underlying paragraphs and table cells (kept; we only rewrite their inline runs/pPr/tblGrid).
- All other RE851D / RE851A post-render passes.
- The Source-of-Information row and Multiple-Properties checkbox passes.

## What the pass will additionally do

For every paragraph whose visible text begins with `☐ / ☑ / ☒` AND contains one of the 7 PROPERTY TYPE labels (existing gate, reused unchanged):

1. **Glyph run — canonical font + size (NEW)**
   Locate the first `<w:r>` whose `<w:t>` body begins with a checkbox glyph. Replace (or insert) its `<w:rPr>` with a single canonical block:
   - `<w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/>`
   - `<w:sz w:val="20"/><w:szCs w:val="20"/>`
   This guarantees every checkbox glyph is rendered at exactly the same size and shape across every property section.

2. **Label run — canonical font + size (NEW, conservative)**
   For each `<w:r>` whose `<w:t>` body starts with one of the 7 labels, force `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` + `<w:sz w:val="20"/><w:szCs w:val="20"/>` inside its `<w:rPr>` (preserving b / i / color if present). Ensures the label text width and baseline match across all clones.

3. **Paragraph spacing + indent reset (NEW)**
   Inside each matched paragraph's `<w:pPr>`:
   - Remove any `<w:ind .../>` (drops varying left / first-line / hanging indents).
   - Remove any `<w:tabs>...</w:tabs>` (no manual tab alignment).
   - Replace `<w:spacing .../>` with a fixed `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>` so every row is the same height.
   Existing alignment (`<w:jc>`) and numbering (`<w:numPr>`) are preserved.

4. **Existing whitespace / tab / break normalization (KEPT)**
   - Strip stray `<w:tab/>` and `<w:br/>` between glyph and label.
   - Collapse whitespace after each glyph to exactly one regular space; force `xml:space="preserve"`.
   - Strip leading whitespace inside the label's `<w:t>`.

5. **Containing table — fixed column widths (NEW)**
   For every `<w:tbl>` that contains at least one matched PROPERTY TYPE paragraph:
   - Force `<w:tblW w:w="9360" w:type="dxa"/>` (US-letter content width).
   - Rewrite `<w:tblGrid>` to exactly two `<w:gridCol w:w="4680"/>` columns.
   - For every `<w:tc>` in that table, force `<w:tcW w:w="4680" w:type="dxa"/>` and clear `<w:tcMar>` overrides to a fixed `top/bottom=0`, `left/right=120`.
   This guarantees the right column starts at the same horizontal position in every property's PROPERTY TYPE block and prevents `OTHER: <dynamic text>` from shifting columns.

6. **Idempotency**
   The pass detects no-op runs and skips re-zipping; re-running on already-normalized XML yields zero mutations.

## Safety guarantees
- Gate is unchanged: only paragraphs that visibly begin with a checkbox glyph AND contain one of the 7 PROPERTY TYPE labels are touched.
- `<w:numPr>`, `<w:jc>`, bookmarks, content controls (`<w:sdt>`), and label TEXT are never modified.
- Glyph state (☐ vs ☑ vs ☒) is never changed.
- Table-width / column-width rewrite only fires for tables that contain at least one matched PROPERTY TYPE paragraph — no other tables in the document are touched.
- Wrapped in try / catch with `didMutate` flag → on any error the original XML is preserved and rendering continues.

## Verification
- Generate RE851D for a deal with ≥ 2 properties, including one whose PROPERTY TYPE is OTHER with a populated free-text value.
- Confirm in the output `.docx`:
  - Checkbox glyphs visually identical in every property block.
  - Left column labels (SFR rows) align vertically across all blocks.
  - Right column (COMMERCIAL, LAND ZONED, LAND INCOME PRODUCING, OTHER) starts at the same X across all blocks.
  - `OTHER: <text>` length does not shift the row's checkbox position.
  - Row spacing is equal across all 4 rows in every block.
- Confirm no regression in Source-of-Information row, Multiple-Properties checkbox, Encumbrance pages, or RE851A output.

## Memory
Update `mem://features/document-generation/re851d-property-type-spacing` to note that the same pass now also (a) canonicalizes glyph + label run fonts/sizes, (b) resets paragraph indent + spacing, and (c) forces a fixed 2-column `<w:tblGrid>` on any table containing PROPERTY TYPE rows.

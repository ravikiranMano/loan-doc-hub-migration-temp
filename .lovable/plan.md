
## Goal

For RE851D documents, force the "Additional remaining, expected, or anticipated encumbrances are set forth in an attachment to this statement." YES checkbox per-property whenever that property has more than 2 remaining or more than 2 anticipated liens. Currently it stays unchecked even when the addendum logic itself is correct.

## Root cause

In `supabase/functions/generate-document/index.ts`, Pass A of the AEA block (≈ lines 6377–6558) scans for the anchor phrase directly in the raw `word/document.xml`:

- `xmlLowerAEA.indexOf("set forth in an attachment")` — gate
- `/set\s*forth\s*in\s*an\s*attachment/gi` — match loop
- `yesLabelReSrc` / `noLabelReSrc` — Y/N label search, also against raw XML

Word splits visible text across multiple runs (`<w:r><w:t>…</w:t></w:r>`), so the phrase is fragmented by tag boundaries and the regex returns no matches. `hasAnchor` is `false` → the per-property checkbox rewrite loop never runs → both properties' YES boxes stay unchecked.

Sibling RE851D safety passes already solve this via the existing `__getVisProj(filename, xml)` helper, which gives `proj.txt` (visible text, tags stripped) plus `proj.map` (txt-index → xml-index resolver). Anchor matching is done in `proj.txt`, then converted back to xml offsets when picking control runs.

## Fix (scoped, additive)

Edit only the AEA block in `supabase/functions/generate-document/index.ts`. Do **not** touch:
- The addendum builder (Pass B)
- `yesPropIdx` derivation from `fieldValues`
- `perPropRem` / `perPropAnt` publishers (line ~2867)
- The `pr_li_additionalEncumbrance_*` aliases (line ~2992)
- Any template, schema, field dictionary, or UI

Changes inside Pass A only:

1. Replace the raw-XML anchor gate with a visible-text gate using `__getVisProj(filename, xml).txt` (lowercased once, cached). If the phrase isn't in `proj.txt`, skip — same as today, just correct.
2. Replace the raw-XML `anchorRe` match loop with a visible-text scan over `proj.txt`. For each hit, convert the txt-index back to an xml-index via `proj.map` (binary-search resolver) and use that as `aStart` for the rest of the existing logic.
3. Resolve the property `propK` for each hit using the existing `propRanges` (already built from `propAnchorsRaw` on the same projection), unchanged.
4. Same for the YES / NO label searches: scan `proj.txt` for the next `Yes` / `No` after the anchor (case-insensitive, word-boundary), then convert each match back to an xml-index. Feed those xml-indexes into the existing `findControlNearAEA(...)` helper unchanged — that helper already operates on raw XML and on small windows around the label, so it doesn't suffer from the fragmentation problem.
5. Keep `findControlNearAEA`, `rewriteSdtCheckedAEA`, `rewriteDrawingRunAEA`, the rewrite-overlap guard, and the descending-rewrite apply step exactly as they are.
6. Add a single console log after the loop: `RE851D AEA Pass A: anchors=<n> rewrites=<m> yesProps=[…]` so future regressions are diagnosable from edge logs.

Pass B (the addendum builder at lines 6560–6638) is already driven by `yesPropIdx` computed from `fieldValues` (independent of XML structure), so no change is required there. We'll verify via logs that it's already firing for both properties on DL-2026-0230.

## Verification

1. Regenerate RE851D for deal **DL-2026-0230** (`1af428a5-…`).
2. Confirm in the generated `.docx`:
   - Property 1 block: "set forth in an attachment" YES box checked, NO unchecked.
   - Property 2 block: same.
   - Addendum page at end already lists liens 3+ for Property 1 (rem and ant overflow) and the anticipated-overflow liens for Property 2.
3. Confirm in edge function logs: a single `RE851D AEA Pass A:` line shows `anchors=2 rewrites=4 yesProps=[1,2]` (or matching numbers) and the existing `RE851D addendum: appending 2 property section(s)` line.
4. Spot-check a single-property RE851D deal where every property has ≤ 2 liens — anchor still found, both Y/N forced to NO, and no addendum appended. (Existing behavior preserved.)
5. Spot-check a deal whose template uses image-checkbox or SDT-checkbox variants — `findControlNearAEA` already handles all three (`sdt` / `glyph` / `drawing`), so behavior should be unchanged for those.

## Out of scope

- Server-side DOCX → PDF / addendum styling tweaks
- Changes to the addendum heading, layout, fields, or page-break behavior
- Any change to `field_dictionary`, `deal_section_values`, templates, packets, or RLS
- Any frontend / UI changes

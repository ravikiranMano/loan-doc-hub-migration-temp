## Goal

Make the rendered PROPERTY TYPE section (Section 2) of RE851D look like the reference for ALL 5 properties: clean fixed two-column layout, consistent spacing, each checkbox+label on its own line, and the OTHER row separate from the LAND (income-producing) row with the property text inline. Only the docx template layout changes; no business logic or placeholder names move.

## What's wrong now (from the latest generated output)

1. **Property 1** still renders in the original (pre-rewrite) layout — bigger font, original spacing, and OTHER squashed onto the same visible line as LAND (income-producing). This means either Property 1's template block was not actually rewritten, or some other pass overwrites it at runtime.
2. **Properties 2–5** show the new fixed table, but with two regressions:
   - Paragraphs are stacked too tightly (font 9pt, before/after = 40 twips, line=240). The reference uses larger font and more breathing room.
   - The OTHER row visually ends up on the same line as LAND (income-producing) (".. LAND (income-producing) ☑ OTHER: Farm"), even though I emit 4 distinct `<w:p>` in the right cell. Need to confirm whether (a) the runtime post-render safety pass at `generate-document/index.ts:8316–8424` collapses them, (b) one of the per-property publishers re-wraps them, or (c) Word is collapsing empty/whitespace runs.

## Investigation steps (run during implementation)

1. Extend the existing `rewrite-re851d-property-type-layout` edge function with a richer debug mode that returns the raw XML slice for each of the 5 detected blocks AFTER rewrite, so we can confirm all 5 actually got replaced.
2. Generate an RE851D document for the current deal, download the resulting `.docx`, unzip, and read `word/document.xml`. Locate every "PROPERTY TYPE" anchor and dump the surrounding XML for each property to confirm:
   - Whether all 5 property cells contain our canonical `<w:tbl>` or only some
   - Whether OTHER is genuinely a separate `<w:p>` after generation, or whether a post-render pass merged it
3. If Property 1 was not rewritten by the template pass, find why — most likely the FIRST occurrence sits inside an SDT/content control or has an extra wrapper that my top-level block scanner skipped past (`findTopLevelBlocks` only walks direct children of `<w:body>`; nested tables get treated as part of their parent).

## Fix (in `supabase/functions/rewrite-re851d-property-type-layout/index.ts`)

### 1. Cover blocks nested inside other tables / SDTs

Change `findTopLevelBlocks` to also walk recursively inside `<w:tbl>` cells and inside `<w:sdt>`/`<w:sdtContent>` so that a placeholder living inside a nested cell still maps to its enclosing `<w:p>` or innermost `<w:tbl>` row. This fixes the "Property 1 not rewritten" case if it turns out the first PROPERTY TYPE block sits inside an outer table.

### 2. Match the visual style of the original template

Rebuild `buildCanonicalTable` with paragraph properties that match what the surrounding RE851D rows use:

- Font: Arial, size 20 (10pt) — matches PROPERTY OWNER / PROPERTY ADDRESS rows above and below.
- Paragraph spacing: `<w:spacing w:before="120" w:after="120" w:line="276" w:lineRule="auto"/>` (a little more breathing room than before).
- Keep `<w:tblLayout w:type="fixed"/>` so columns never collapse from long placeholder text.
- Keep two equal 4680 DXA columns, borderless, `vAlign=top`.

### 3. Guarantee the OTHER row stays its own paragraph

Two safeguards:

- Add `<w:keepNext/>` on the LAND (income-producing) paragraph and `<w:keepLines/>` on the OTHER paragraph so Word can't merge or visually run them together.
- Inside the OTHER paragraph, ensure the structure is exactly three runs: `{{property_type_other_N}}` + run with ` OTHER: ` (`xml:space="preserve"`) + `{{property_type_other_text_N}}`. No tabs, no breaks. (Already the case; tighten it.)

### 4. Defensive scope check against the post-render pass

The post-render safety pass at `generate-document/index.ts:8316–8424` rewrites paragraphs that begin with a checkbox glyph and contain a PROPERTY TYPE label. It does NOT merge paragraphs, but it does aggressively strip `<w:tab/>` and `<w:br/>`. Verify (via the generated XML dump) that nothing in our canonical paragraphs is being mis-touched. If verification shows it's the cause of any merging or formatting loss, no change is needed there — the canonical table emits no `<w:tab/>`/`<w:br/>` so the pass is a no-op on our paragraphs.

### 5. Sentinel + idempotency stays the same

Keep the existing `PT_LAYOUT_V1` sentinel so re-running is still a no-op once normalized. Bump the sentinel to `PT_LAYOUT_V2` so the new style is re-applied to any template that was already rewritten with the V1 (cramped) style — i.e., the function will redo the 5 blocks once.

## Re-run + verify

1. Deploy and `POST` the function with `{}` once — expect `propertiesRewritten: [1..5]` (re-application thanks to V1→V2 sentinel bump).
2. Generate a fresh RE851D document for the test deal.
3. Visually confirm against the user's reference: 3 rows left / 4 rows right per property, all 5 properties identical, OTHER inline with its text on its own row, no column collapse.

## Out of scope

- No changes to `generate-document/index.ts`
- No changes to placeholders, publishers, or any other section
- No UI or schema changes

## Issue

In RE851D, the "Is there Additional Securing Property?" checkbox renders the literal merge tag (e.g. `{{pr_p_multipleProperties_yes_glyph}}` / `{{pr_p_multipleProperties_no_glyph}}`) for Property #1 and Property #5, while #2–#4 work.

## Root cause

The RE851D template authors the tag with the generic `_N` placeholder inside each PROPERTY #K block:

```
{{pr_p_multipleProperties_yes_glyph_N}}  YES
{{pr_p_multipleProperties_no_glyph_N}}   NO
```

The edge function already publishes per-property indexed values:

- `pr_p_multipleProperties_yes_glyph_1..5`
- `pr_p_multipleProperties_no_glyph_1..5`
- (and the `_yes` / `_no` boolean variants)

(see `supabase/functions/generate-document/index.ts` lines 1144–1158)

…and it has a region-scoped rewriter that turns `_N` → `_K` per PROPERTY #K block (lines 3644–4349). But that rewriter only operates on tags listed in `RE851D_INDEXED_TAGS` / `PART1_TAGS` / `PART2_TAGS`. The `pr_p_multipleProperties_*_N` family is **missing** from those allowlists, so:

- The `_N` literal is never rewritten to the property's index → no value is published for that exact key → the merge resolver leaves the tag literal in the document.
- The dedicated post-render safety pass at line 5515 only flips ☐/☑ glyphs near the question's `YES` / `NO` labels — it cannot recover a literal `{{…}}` placeholder.

Why #1 and #5 specifically: the post-render label-window scan looks ahead ~600 visible chars from each question. For middle properties #2–#4 the next characters after the question include glyph runs that happen to live inside `<w:t>` runs the inline-rewrite branch can repair. For #1 (the first block, which abuts PART 2 boundary content) and #5 (last block, against the document tail) the layout differs slightly and the glyph-flip path either anchors to the wrong run or finds no glyph at all — the literal tags are what actually display.

The clean fix is to make the same `_N` → `_K` rewrite that already powers every other per-property tag also handle this family, so each property's tag becomes a real key that resolves on the standard merge-tag pass.

## Change

`supabase/functions/generate-document/index.ts`

In the `RE851D_INDEXED_TAGS` array (declared near line 3655), add the four `pr_p_multipleProperties_*_N` entries, ordered with `_glyph` variants before the bare boolean variants so the longest-first matcher consumes them in the correct order:

```ts
"pr_p_multipleProperties_yes_glyph_N",
"pr_p_multipleProperties_no_glyph_N",
"pr_p_multipleProperties_yes_N",
"pr_p_multipleProperties_no_N",
```

No other code changes are required:

- The publisher at lines 1144–1158 already writes the `_K` variants for every property index.
- The middle-suffix rewrite at line 4336 already handles `_N_yes_glyph` / `_N_no_glyph` / `_N_yes` / `_N_no`, but the new entries end in `_N` (post `_yes_glyph` etc.), so the standard `_N$` end-of-tag branch at line 4340 picks them up cleanly.
- The post-render glyph-flip safety pass remains as a backstop for templates that don't use these placeholders.

## Constraints honored

- No UI changes.
- No schema, dictionary, or alias changes.
- No change to the publisher logic, formula, or any other property's rewrites.
- Backward compatible — older templates that use `{{pr_p_multipleProperties_yes_glyph}}` (no `_N`) keep working via the global key.

## Validation

Regenerate the RE851D document with a deal that has 2+ properties and confirm:

- Property #1 and Property #5 now show actual ☑ / ☐ glyphs next to YES / NO instead of the literal `{{…}}` text.
- Property #2, #3, #4 continue to render correctly.
- Single-property deals still render NO ☑ / YES ☐ in every property block.
- Edge logs show the new tags being rewritten under each `PROP#K` region (the `regionRewriteCounts` line will tick up).

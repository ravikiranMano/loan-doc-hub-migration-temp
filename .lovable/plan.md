## Root cause

The "Is there Additional Securing Property?" YES/NO glyphs are correctly resolved by the pre-render publisher (global `pr_p_multipleProperties_yes_glyph` / `_no_glyph` produce `☑ YES` / `☐ NO` when property count > 1). The bug is in the **post-render safety pass** in `supabase/functions/generate-document/index.ts` (lines ~5427–5710).

When both YES and NO labels live in the **same `<w:t>` run** (a common Word fragmentation pattern after merge-tag replacement, e.g. `"☑ YES   ☐ NO"`), the pass goes through this flow:

1. `pickFor` returns `none` for both sides — confirmed by log: `yC=none, nC=none`.
2. `combinedPairForRun` tries to match the strict regex `^([☐☑])(\s*Y\s*E\s*S\s+)([☐☑])(\s*N\s*O\b)`. Real-world content often has leading whitespace, NBSP, or a different separator, so it fails silently.
3. Falls through to `inlineForLabel(yXmlIdx, yesGlyph)` which runs `inner.replace(/[☐☑☑]/g, yesGlyph)` — **global** replace. This flips **both** glyphs to YES's glyph.
4. Then `inlineForLabel(nXmlIdx, noGlyph)` runs the same global replace and flips **both** glyphs to NO's glyph.
5. Net effect: both boxes end up identical (here: both `☐` because NO ran last and `noGlyph = ☐`).

Property #1 has data — pre-render gives correct glyphs, then post-render destroys them. Property #5 has no presence data, but the template uses bare (un-indexed) `pr_p_multipleProperties_*_glyph` so it inherits the same global value and is wrecked by the same pass. The Property #2/#3/#4 logs report `touched=false` only because `combinedPairForRun` happens to match those occurrences successfully.

No field-key mapping changes are needed. The data resolution and template tags are correct.

## Fix (post-render pass only — narrow, surgical)

Edit `supabase/functions/generate-document/index.ts`, only inside the `if (/851d/i.test(template.name || ""))` block at lines 5427–5710:

1. **Make `combinedPairForRun` tolerant** so it handles real-world inner text:
   - Allow leading whitespace / NBSP / glyph-adjacent characters before the first glyph (drop the `^` anchor; instead find the first `glyph + YES + glyph + NO` pair anywhere in the inner text).
   - Allow any whitespace, NBSP (`\u00A0`), or tab between glyph and label and between the two pairs.

2. **Make `inlineForLabel` position-aware** so it does NOT global-replace:
   - Locate the single glyph character closest to (and to the left of) the label position inside the same `<w:t>`. Replace only that one character by index, not via `/g` regex.
   - Skip if no glyph exists on the label's side.

3. **Add ordering safeguard**: if YES and NO labels resolve to the same `<w:t>` run AND `combinedPairForRun` did not handle it, run a single combined positional rewrite (locate two glyph indices within `inner`, set the first → `yesGlyph`, second → `noGlyph`). This guarantees we never call two competing global replaces on the same run.

4. **Per-property correctness for Property #5**:
   - Property #5 has no presence fields, but the question must still render based on the global `realCount`. Confirm the post-render pass uses `_propIdxSet.size` (the raw property index set, currently lines 5442–5447), not `realPropertyIndices`. This already matches the desired behavior (5 indices → multi=true), so no further change needed beyond fix #2/#3 above.

5. **Logging**: extend the existing `occ#{N}` log to print the actual `inner` snippet (truncated to 80 chars) when no handler matched, so future regressions are diagnosable from edge logs.

## Validation

- Regenerate RE851D with current 4-property deal and confirm all five PROPERTY blocks show `☑ YES   ☐ NO` (since count > 1).
- Regenerate after deleting properties down to 1 and confirm all blocks show `☐ YES   ☑ NO`.
- Inspect logs: every `occ#K` line should report `touched=true` with no "YES/NO labels not located" warnings.
- Open the resulting .docx in Word and Google Docs to confirm no ☑/☐ duplication and no surviving `{{...}}` literals.

## Out of scope

- Field dictionary, UI forms, template `.docx` content, pre-render publisher, indexed `_N` rewriter, and all other RE851D post-render passes (60-day, cure-delinq, remain-unpaid, encumbrance) — none are touched.

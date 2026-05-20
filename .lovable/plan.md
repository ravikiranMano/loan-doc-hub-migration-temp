# Fix: RE851A `{{#if or_p_isBrkBorrower}}` inline checkboxes render unchecked

## Symptom
In RE851A, with the dropdown *Origination App → Borrower → "Is Borrower also the Broker"* set to **Yes**, the user's two inline conditionals on the Broker Capacity row render with **neither** box checked:

```text
{{#if or_p_isBrkBorrower}}☐{{else}}☑{{/if}}, {{#if or_p_isBrkBorrower}}☑{{else}}☐{{/if}}
```

Expected for YES: `☐, ☑`  ·  Expected for NO: `☑, ☐`.

## Cause (verified in code, not changing here)
Two stages both try to drive these checkboxes; the second clobbers the first.

1. **Handlebars stage** (`supabase/functions/_shared/tag-parser.ts` `processConditionalBlocks` → `isConditionTruthy`, lines 1737–1960) correctly resolves `or_p_isBrkBorrower`. The publisher at `supabase/functions/generate-document/index.ts` lines 2788–2839 sets it to `"true"`/`"false"` from the same dropdown key (`origination_app.borrower.is_borrower_also_broker`, confirmed at `src/components/deal/OriginationApplicationForm.tsx` line 45). So the inline blocks correctly emit `☐, ☑` (YES) or `☑, ☐` (NO).
2. **RE851A label-anchored safety pass** (`supabase/functions/generate-document/index.ts` lines 5024–5064) registers label bindings that flip the single static glyph preceding `A. Agent …` / `B. Principal as a borrower …` from `or_p_brkCapacityAgent` / `or_p_brkCapacityPrincipal`. When the row contains the user's two-glyph `{{#if}}` output instead of one static glyph per label, this pass anchor-matches the wrong glyph (or matches the same glyph twice), erasing the conditional's result and leaving both as `☐`.

The two paths are redundant by design: the safety pass exists so unmodified templates keep working without `{{#if}}`. Once an author opts into `{{#if or_p_isBrkBorrower}}`, the safety pass must step aside for those two anchors only — nothing else.

## Change (single, surgical, RE851A-only)

Make the RE851A label-anchored bindings for the two Broker-Capacity anchors **conditionally registered**:

- Detect, once per generation, whether `word/document.xml` (and headers/footers) contains the token `{{#if or_p_isBrkBorrower}}` or `{{#unless or_p_isBrkBorrower}}` anywhere.
- If detected, **omit** these entries from `re851aLabelAdditions` (lines 5026–5064):
  - `"A. Agent in arranging a loan on behalf of another"`
  - `"A. Agent in arranging a loan"`
  - `"A. Agent"`
  - `"B. Principal as a borrower on funds from which broker will directly or indirectly benefit"`
  - `"B. Principal as a borrower on funds from which broker will benefit"`
  - `"B. Principal as a borrower on funds"`
  - `"B. Principal as a borrower"`
  - `"B. *Principal …"` variants (all four)
- Keep every other entry (`Servicing`, `Amortization`, etc.) and the rest of the pipeline untouched.

Net effect:
- Templates **without** `{{#if or_p_isBrkBorrower}}` → behavior is byte-identical to today (safety pass still drives both glyphs from the booleans).
- Templates **with** `{{#if or_p_isBrkBorrower}}` → the Handlebars stage is the sole source of truth for those two glyphs; safety pass no longer collides.

## Files touched

- `supabase/functions/generate-document/index.ts` — add the inline-conditional detection (~6 lines) just above `const re851aLabelAdditions` and gate the 11 Broker-Capacity entries on `!hasInlineBrkBorrowerIf`. No new exports, no schema, no UI changes.

## Out of scope (per minimal-change policy)
- No change to the publisher (`or_p_isBrkBorrower`, `or_p_brkCapacityAgent`, `or_p_brkCapacityPrincipal`, `*_Glyph`) — they continue to be set for any template that still needs them.
- No change to `tag-parser.ts` conditional engine.
- No change to the UI dropdown, field dictionary, or persistence.
- No change to RE851D or any other template's safety passes.
- No change to Servicing / Amortization label bindings.

## Verification

1. Open deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65`, set *Is Borrower also the Broker* = **Yes**, generate RE851A using the user's template containing the two inline blocks → expect `☐, ☑` on the Broker Capacity row.
2. Toggle to **No**, regenerate → expect `☑, ☐`.
3. Generate an **unmodified** RE851A template (no inline `{{#if}}`) for the same deal in both YES and NO states → expect identical output to today (regression check that the safety pass still drives the glyphs when authors haven't opted in).
4. Confirm `[generate-document] Derived broker capacity checkboxes from "yes": agent=false, principal=true, isBrkBorrower=true` log line still appears (publisher unchanged).

## Memory update (after implementation)
Add one note under `mem://features/document-generation/re851a-checkbox-automation`: *"Broker-Capacity Agent/Principal label-anchored safety pass auto-disables for RE851A templates that contain inline `{{#if or_p_isBrkBorrower}}` so the Handlebars conditional becomes the sole glyph source on that row."*

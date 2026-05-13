## Goal
Make `{{#if pr_li_currentDelinqu}}☑{{else}}☐{{/if}} Yes / NO` in RE851A reflect the lien's UI **Currently Delinquent** checkbox (`lien1.currently_delinquent`) instead of the current balance-derived value.

## Root cause
In `supabase/functions/generate-document/index.ts` (~line 3271), the bare alias `pr_li_currentDelinqu` (and its `_yes` / `_no` / `_glyph` variants and `_${lienIdx}` variants) is computed as:

```
const currentDelinq = Number.isFinite(remBalNum) && remBalNum > 0;
```

So the YES/NO conditional fires off remaining-balance amounts, not off the actual `Currently Delinquent` checkbox the user toggles in the Lien modal. When the user has the checkbox unchecked but a balance > 0, YES still wins; when checked but balance = 0, NO wins. The `{{#if}}` parser itself works correctly (truthy `"true"`, falsy `""`).

## Change (single, minimal)

In the RE851D lien-delinquency publisher block (~lines 3249–3453 of `supabase/functions/generate-document/index.ts`):

1. Read the explicit UI checkbox alongside the existing balance derivation:
   ```ts
   const currentlyDelinquentChecked = truthy(
     getLienVal(prefix, "currently_delinquent", "currentlyDelinquent")
   );
   const currentDelinq = currentlyDelinquentChecked; // was: remBalNum > 0
   ```
2. Keep `remBalNum` available for the existing Q4 "remain unpaid" logic that legitimately depends on remaining balance — only the `currentDelinq` boolean used for `pr_li_currentDelinqu*` aliases changes.
3. Update the `debugLog` so it prints the new source (`uiChecked=…`) for traceability.

This automatically corrects:
- bare aliases set at lines 3446–3450 (`pr_li_currentDelinqu`, `_yes`, `_no`, `_yes_glyph`, `_no_glyph`) — used by the RE851A template
- per-lien aliases at lines 3293–3298 (`pr_li_currentDelinqu_${N}` family)
- per-property mirrors at lines 3373–3378 (`pr_li_currentDelinqu_${pIdx}` family)

## Safety-pass review (RE851D only)

The RE851D "Remain Unpaid YES/NO" safety pass at ~line 7006 anchors checkboxes to `pr_li_currentDelinqu_K`. Per the RE851D spec memory, that question ("Do any of these payments remain unpaid?") is conceptually balance-based. Since the change above repurposes `currentDelinq` to the UI checkbox, this safety pass would shift meaning on RE851D.

**Mitigation:** before that safety pass, publish a parallel `pr_li_remainUnpaid_${k}` (and its `_yes/_no/_glyph` variants) computed from the existing `remBalNum > 0` logic, and update the RE851D safety pass at line 7006–7020 to read `pr_li_remainUnpaid_${k}` instead of `pr_li_currentDelinqu_${k}`. This preserves the RE851D behavior exactly while letting `pr_li_currentDelinqu*` mean what the user expects on RE851A.

(No template tag changes needed — RE851D's "remain unpaid" question is rendered by the safety pass, not by a `{{pr_li_remainUnpaid_*}}` merge tag.)

## Out of scope
- No template/DOCX edits.
- No schema, UI, or field-dictionary changes.
- No other publisher logic touched.

## Verification
1. Deploy `generate-document`.
2. Regenerate RE851A for deal `DL-2026-0226`:
   - With lien1 `currently_delinquent` **checked** → expect `☑ Yes  ☐ NO`.
   - With it **unchecked** → expect `☐ Yes  ☑ NO`.
3. Regenerate RE851D for a deal that previously rendered the "remain unpaid" YES/NO correctly → expect identical output (driven by new `pr_li_remainUnpaid_K`).
4. Inspect edge logs for the new `uiChecked=` debug line.

## Problem

`{{ln_p_originalAmount}}` renders blank in RE851A even though the field is saved.

## Root cause

`field_dictionary.ln_p_originalAmount` exists (section `loan_terms`, currency) and the deal `deal_section_values` row stores its value (`value_number`). The generic publisher in `supabase/functions/generate-document/index.ts` (~L390–470) does set `fieldValues.set("ln_p_originalAmount", ...)` when the dictionary id is present in the JSONB row.

However, RE851A goes through `isEncumbrancePipeline`, which runs several extra passes (upfront authoring-noise strip, label-anchored ENCUMBRANCE rewrite at L9761 keyed on the literal label "ORIGINAL AMOUNT", anti-fallback shield, post-render flush). Two of those interact badly with a standalone `{{ln_p_originalAmount}}` tag:

1. The label-anchored encumbrance pass treats every paragraph whose visible text contains `ORIGINAL AMOUNT` as a `pr_li_*_originalAmount_*` cell and overwrites the cell run with the encumbrance value (or an empty string when no lien slot resolves), wiping the unrelated `{{ln_p_originalAmount}}` tag that happens to share that label.
2. There is no explicit RE851A publisher for `ln_p_originalAmount`, so it relies entirely on the generic dictionary publisher; any path that falls back to canonical `loan_terms.*` or to a composite `loan::<uuid>` key never reaches the resolver and the tag is left unresolved, after which the post-render flush blanks the placeholder.

Additionally, `LOAN_TERMS_BALANCES_KEYS.originalAmount` in `src/lib/fieldKeyMap.ts` is `'loan.original_amount'` (mismatched with the rest of the section which uses `'loan_terms.*'`). The legacy bridge resolves it on save, but it means no `loan_terms.original_amount` alias exists in `fieldValues` for the encumbrance label pass to consult.

## Fix (scoped, additive)

### 1. `supabase/functions/generate-document/index.ts`

Add a small, explicit RE851A publisher near the existing `ln_p_loanAmount` / `ln_p_estimateBallooPaymen` auto-compute block (~L2440–L2520). It will:

- Read the value from any of: `ln_p_originalAmount`, `loan_terms.original_amount`, `loan.original_amount`, `ln_p_originalBalance`, `loan_terms.original_balance` (first non-empty wins).
- Set `fieldValues.set("ln_p_originalAmount", { rawValue, dataType: "currency" })` unconditionally so the merge tag always resolves.
- Also publish a `loan_terms.original_amount` alias so any downstream label/canonical lookups find it.

Then, in the RE851A/encumbrance label-anchored pass at ~L9757–L9767, narrow the `ORIGINAL AMOUNT` rule to only fire when the enclosing cell sits inside an `ENCUMBRANCE(S)` table region. Concretely: keep a `seenEncumbranceAnchor` flag (toggled when the visible text crosses `ENCUMBRANCE` headings) and skip the rewrite for paragraphs that contain a non-`pr_li_` Handlebars tag (e.g. `{{ln_p_…}}`). This preserves all current encumbrance behavior while leaving standalone loan-level tags alone.

### 2. `src/lib/fieldKeyMap.ts`

Change line 401:

```
originalAmount: 'loan.original_amount',
```

to

```
originalAmount: 'loan_terms.original_amount',
```

so the UI persists the value under the same section prefix as every other Loan Terms field. The legacy bridge (`legacyKeyMap.ts` line 398) already maps `loan.original_amount → ln_p_originalAmount`; we add a parallel mapping `'loan_terms.original_amount' → 'ln_p_originalAmount'` to cover both legacy rows and new saves.

## Validation

1. Regenerate RE851A for a deal that has Original Amount populated → `{{ln_p_originalAmount}}` renders as `$1,000,000.00`.
2. Edge function log: confirm `ln_p_originalAmount = 1000000` appears in the pre-render debug fields list (already wired via `debugFields` at L1023; add `ln_p_originalAmount` to that array as part of the diff so future regressions are visible).
3. Confirm no regression in the existing ENCUMBRANCE `ORIGINAL AMOUNT` columns (they still resolve via the per-slot `pr_li_rem/ant_originalAmount_N_S` publisher).

## Out of scope

- Field dictionary, RLS, packets, templates table — no changes.
- RE851D, RE885, charges, liens — no changes.
- UI layout, styling, validation — no changes; only the persistence key path for the existing "Original Amount" input is corrected.
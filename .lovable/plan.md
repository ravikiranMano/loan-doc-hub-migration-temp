# Fix `{{ ln_p_lienPositi }}` rendering twice in RE851A

## Root cause

`ln_p_lienPositi` is the field key for **this loan's** Lien Position (Loan Terms → Priority → Lien Position), populated from the user-entered `loan_terms.lien_position` value.

In `supabase/functions/generate-document/index.ts` (line 2648), the **existing-liens** bridge incorrectly maps the per-lien `priority` field to the same key:

```ts
const lienFieldToLiKeys = {
  ...
  "priority": "ln_p_lienPositi",   // ← wrong target
  ...
};
```

When a deal has multiple existing liens (this deal has 4), the multi-lien aggregator joins their priorities with newlines (e.g. `"1st\n1st"`) and `fieldValues.set("ln_p_lienPositi", ...)` overwrites the loan's own value. The template then renders the placeholder as two stacked lines inside the cell, which is what the screenshot shows.

The same lien priorities are already correctly published to `pr_li_lienPriori`, `pr_li_lienPrioriNow`, and `pr_li_lienPrioriAfter` for the Property → Liens table, so removing this misroute doesn't lose any data.

## Change (single edit, edge function only)

File: `supabase/functions/generate-document/index.ts`

Remove the one offending entry from `lienFieldToLiKeys`:

```diff
 const lienFieldToLiKeys: Record<string, string> = {
   "interest_rate": "li_gd_interestRate",
-  "priority": "ln_p_lienPositi",
   "lien_priority_now": "li_gd_lienPriorityNow",
   ...
 };
```

After this, `ln_p_lienPositi` is sourced solely from the user's Loan Terms entry (`loan_terms.lien_position`), so `{{ ln_p_lienPositi }}` renders the single value once.

The downstream "senior lien" calculation at line 3708 still reads `loan_terms.lien_position` as a fallback, so it remains correct.

## Out of scope

- No UI changes
- No schema/migration changes
- No template edits
- No other bridging logic touched (`pr_li_*` lien-table aliases stay as-is)

## Validation

1. Re-run document generation for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` with template RE851A.
2. Confirm `{{ ln_p_lienPositi }}` cell shows the single Loan Terms value (e.g. `1st`) instead of repeating.
3. Confirm Property → Liens table priority columns still populate from each lien.

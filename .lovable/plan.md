## RE851D — Populate `ln_p_equitySecuringLoan_N` (and confirm footer totals)

### Problem
The RE851D template uses these tags in PART 1 — Loan to Value Ratio:
- Per property: `{{ln_p_equitySecuringLoan_N}}`
- Footer: `{{ln_totalEquitySecuringLoan}}`, `{{ln_totalLoanAmountSecured}}`

In `supabase/functions/generate-document/index.ts` the per-property RE851D Part 1 publisher (~lines 3504–3515) currently emits only `ln_p_amountOfEquity_N` from `pledgedEquity`. The tag `ln_p_equitySecuringLoan_N` is never set, so the “Amount of Equity Securing the Loan” column renders blank. Footer totals are already computed (~lines 3537–3559) but they sum from `ln_p_amountOfEquity_N`, which means today they happen to work — they just need to keep working when we add the new alias.

### Change (single, additive — no refactor, no schema changes)

**File:** `supabase/functions/generate-document/index.ts`

**1. Per property (inside the existing `for (const pi of propIdxSet)` loop, right after `ln_p_amountOfEquity_${pi}` is set, around line 3515):**

Add an alias publish so the template tag resolves directly from pledged equity:

```ts
fieldValues.set(`ln_p_equitySecuringLoan_${pi}`, { rawValue: equityStr, dataType: "currency" });
```

Source remains strictly `property.pledgedEquity` via the existing fallback chain (`pr_p_pledgedEquity_${pi}` → `property${pi}.pledged_equity` → `property${pi}.pledgedEquity`). No Market Value / Encumbrance math.

**2. Footer (existing block ~lines 3539–3555):** No structural change. Update only the totals input source so the sum is taken from the new authoritative key (functionally identical today, but keeps the two paths in sync if `ln_p_amountOfEquity` is ever changed):

```ts
const v = fieldValues.get(`ln_p_equitySecuringLoan_${pi}`)?.rawValue
       ?? fieldValues.get(`ln_p_amountOfEquity_${pi}`)?.rawValue;
```

`ln_totalLoanAmountSecured` continues to come from `loan_terms.loan_amount` via `loanAmtRollup`. Both footer keys remain in the merge payload (already are).

### Why this is safe
- Purely additive: one new key per property, plus a fallback-tolerant change to one read line in the totals loop.
- `propIdxSet` already drives N properties, so it works for any property count.
- No template edits, no schema/UI changes, no other field touched.
- `ln_p_amountOfEquity_N` continues to be published unchanged for templates that still reference it.

### Verification
- Generate RE851D for the open deal (2 properties, pledged 23,432 and 6,778).
- Confirm template renders:
  - Property 1 “Amount of Equity Securing the Loan” = `23,432.00`
  - Property 2 = `6,778.00`
  - `TOTAL EQUITY AMOUNT SECURING THE LOAN` = `30,210.00`
  - `TOTAL AMOUNT OF THE LOAN TO BE SECURED BY MULTIPLE PROPERTIES` = loan amount (e.g. `750,000.00`)
- Check `[generate-document] RE851D Part1 totals: …` log line for the expected sums.

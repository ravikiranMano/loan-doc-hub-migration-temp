## Goal

Fix the RE851d Part 1 (Loan-to-Value Ratio) section so each per-property row computes Remaining/Expected/Total Senior Encumbrances, Amount of Equity, Amount of Equity Securing the Loan, and LTV using the spec's exact rules — with strict `thisLoan` exclusion and the correct lien fields per Condition.

All work stays inside `supabase/functions/generate-document/index.ts`. No DB schema, no UI, no new edge functions.

## What's wrong today (lines ~3308–3495)

1. `thisLoan` is never checked — a "This Loan" lien still gets aggregated.
2. Anticipated uses `lienN.original_balance`, but per spec it must use the "Anticipated Balance (if new lien)" value, which the UI persists as `lienN.new_remaining_balance` (fallback `lienN.anticipated_amount`).
3. `ln_p_loanToValueRatio_N` is computed at lines 1407–1419 as `loanAmount / marketValue`, but per spec PART 1 LTV must be `Total Senior Encumbrances / marketValue × 100`.
4. `pr_p_pledgedEquity_N` is mapped from `propertyN.pledged_equity` (line 256) but never explicitly bridged per-N like `pr_p_appraiseValue_N`. Verify it publishes; if not, add a per-N bridge.
5. Equity formula at line 3487 uses `mv - rem` (remaining only). Spec says `Market Value − Total Senior Encumbrances`.

## Changes

### 1. Per-property rollup (lines ~3308–3495)

- Add a `thisLoan` check at the top of the lien loop (line ~3408): read `lienK.this_loan` (truthy ⇒ skip). Use the existing `truthy3` helper.
- For `cond === "anticipated"` (line ~3422), replace `original_balance` with:
  ```
  new_remaining_balance ?? newRemainingBalance ?? anticipated_amount ?? anticipatedAmount
  ```
- Keep `remain`/`paydown` on `current_balance` (already correct).
- Keep `payoff` excluded (already correct).
- Recompute equity (line ~3487) as `mv - tot` (Market Value − Total Senior Encumbrances) instead of `mv - rem`.
- Per-property LTV: after `tot` is computed, set
  `ln_p_loanToValueRatio_N = (tot / mv) * 100` formatted to 2 decimals; emit `"0.00"` (or skip) when `mv <= 0`.
  This must override the loan/MV LTV written at lines 1416–1418 — write it after that pass (the rollup already runs later, so just ensure unconditional `set`).

### 2. Pledged Equity per-property bridge

Near the per-property bridges around line 1351 (`pr_p_appraiseValue_${idx}`), add:
```
const pledgedV =
  fieldValues.get(`${prefix}.pledged_equity`) ||
  fieldValues.get(`${prefix}.pledgedEquity`);
if (pledgedV?.rawValue && !fieldValues.has(`pr_p_pledgedEquity_${idx}`)) {
  fieldValues.set(`pr_p_pledgedEquity_${idx}`,
    { rawValue: pledgedV.rawValue, dataType: pledgedV.dataType || "currency" });
}
```

### 3. Anti-fallback shield

Add `pr_p_pledgedEquity_N` and `ln_p_amountOfEquity_N` to the per-N safe key list (lines 3902/4038/4062/5161 area) so unpublished indices render `"0.00"` rather than picking up the bare key.

### 4. Logging

Extend the existing `RE851D Part1 rollup property${pi}` debug line to include `mv`, `equity`, and `ltv` so future regressions are visible in `edge_function_logs`.

## Verification

- Existing RE851d tag-parser tests stay green (no parser touch).
- Re-run an end-to-end generate against a deal containing the user's `Re851d_v1_1_2_19-2.docx` template; confirm via edge logs that for each property:
  - `thisLoan` liens are absent from `matchedLog`,
  - `Anticipated` liens contribute `new_remaining_balance` to Expected,
  - `ln_p_loanToValueRatio_N` equals `total/mv*100`.
- Spot-check the 8 spec test cases in the rendered docx (single-property deal, then multi-property deal).

## Out of scope

UI, schema, new tables, Part 2 logic, footer total rows beyond what's already published. The plan does not touch `LiensTableView`, `useDealFields`, or any client code.

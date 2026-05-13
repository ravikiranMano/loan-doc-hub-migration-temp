## Root cause

Pro Rata is computed per-record as `fundingAmount / loanAmount * 100` in two places:

- `src/components/deal/AddFundingModal.tsx` lines 376–388 (auto-compute on edit)
- `src/components/deal/FundingDetailForm.tsx` lines 61–71 (auto-compute on edit)

The denominator is the **original loan amount**, not the **sum of all lender funding amounts**, so when total funded ≠ loan amount, every Pro Rata value is wrong.

The display layer in `LoanFundingGrid.computedPctOwned` (lines 336–352) only re-applies rounding on top of these stored (wrong) values, so the rounding lender ends up absorbing a huge residual instead of a fractional penny.

## Fix

### 1. `src/components/deal/LoanFundingGrid.tsx` — make display authoritative

Rewrite `computedPctOwned` (lines 336–352) to:

- `totalFunded = Σ originalAmount` across `fundingRecords` (skip zero-funded rows)
- For every non-rounding lender: `proRata = round(originalAmount / totalFunded * 100, 4)`
- Rounding lender (`roundingAdjustment === true`): `proRata = round(100 − Σ others, 4)`
- If no rounding lender selected, return the natural rounded values (sum may drift by ≤0.0002%)
- Add a `console.error` assertion when `|Σ proRata − 100| > 0.0001` and a rounding lender exists
- Guard: `totalFunded <= 0` → return zeros, no division

This already feeds `getDisplayedPctOwned` (line 354), which is what the grid renders, so the column is fixed without any schema change.

### 2. `src/components/deal/AddFundingModal.tsx` — fix denominator on save

Lines 376–388: replace `loanAmount` denominator with `totalFunded = Σ existingRecords[*].originalAmount + currentFundingAmount` (excluding the row being edited, identified via `editingRecordId`). Use the same `roundPctForStorage` helper. This keeps the stored `percentOwned` in sync with the new display formula.

Note: `existingRecords` prop currently passes `pctOwned` only. Extend the prop in `LoanFundingGrid` line 918 to also include `originalAmount`, and update the `existingRecords` type at `AddFundingModal.tsx` line 44.

### 3. `src/components/deal/FundingDetailForm.tsx` — fix denominator

Lines 61–71: same change. Add an optional `totalFunded?: number` (or `siblingFundingTotal`) prop; fall back to `loanAmount` only when not provided so any existing caller keeps working. Use `(siblingTotal + fa)` as denominator.

### 4. `src/components/deal/FundingAdjustmentModal.tsx` — read computed Pro Rata

Lines 131–142 and 230 currently call `formatPercentDisplay(r.pctOwned, 4)` directly off the funding record. Compute the same `totalFunded`-based pro rata locally inside the modal (small inline helper that mirrors step 1) and use that value for both the seed `proRata` column and the `handleLenderSelect` autofill, so pro-rata distribution math (lines 158–169) uses correct shares.

### 5. Validation / rounding rules (per requirements)

- 4-decimal rounding everywhere (`toFixed(4)` / `Decimal.toDecimalPlaces(4)`).
- Rounding lender delta is bounded by `n * 5e-5` (sub-penny); add the post-calc assertion in step 1.
- Payment / Net Payment formulas in `computedPayments` (lines 309–331) are untouched.

## Out of scope

- No DB schema or migration changes
- No edits to `LoanTermsFundingForm.tsx` aggregator (line 302 sums display values; it will continue to sum and naturally land at 100%)
- No changes to other grids, document generation, or unrelated modules

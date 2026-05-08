# Platform-Wide Decimal Precision for Rates & Percentages

## Goal

Standardize how every percentage / rate field is **stored** (≥4 decimals) and **displayed** (min 2, max N, suppress trailing zeros beyond 2nd decimal) without changing any UI layout, schema, or save APIs.

## Display rule (single source of truth)

A new helper `formatPercentDisplay(value, maxDecimals)` will:

- Return `''` for empty/NaN
- Always show **at least 2** decimals
- Show **up to `maxDecimals`** decimals
- Strip trailing zeros only **beyond the 2nd** decimal place

Examples (matches spec exactly):

```
10        → 10.00
10.5      → 10.50
10.875    → 10.875
10.8756   → 10.8756   (when max=4)
10.8756   → 10.876    (when max=3, rounded)
27.2727   → 27.2727   (when max=4)
```

## Per-field max display precision

| Field group                                         | Storage | Display max |
|-----------------------------------------------------|--------:|------------:|
| Interest rates (Note Rate, Default Rate, Sold Rate) | 4       | 3           |
| Pro Rata / Funding distribution %                   | 4       | 4           |
| LTV, CLTV, Protective Equity                        | 4       | 2           |
| Late Charge %                                       | 4       | 3           |
| Dollar amounts (unchanged)                          | 2       | 2           |

## Files to change

1. **New** `src/lib/precisionFormat.ts`
   - `formatPercentDisplay(value, max)` – the smart-trim formatter above
   - `roundPctForStorage(value)` – `Number(value).toFixed(4)` (string), used on blur/save
   - `roundDollarForStorage(value)` – `toFixed(2)` (string)
   - All math uses `decimal.js` (small, already-tree-shakable). Add via `bun add decimal.js`.

2. **`src/lib/fieldTransforms.ts`**
   - `formatPercentage(value, decimals=2)` becomes a thin wrapper that calls `formatPercentDisplay(value, decimals)` and appends `%`. Default `decimals` raised to `3` so `applyTransform('percentage')` (used by document merge) emits the smart-trim form. Existing callers that pass an explicit number keep working.
   - `formatForDisplay` `case 'percentage'` switches to `formatPercentDisplay(value, 4)` so generic inline UI shows up to 4 with trailing-zero suppression.
   - `parseToCanonical` unchanged (still strips formatting).

3. **`src/lib/numericInputFilter.ts`**
   - `formatPercentageDisplay(value)` switches to `formatPercentDisplay(value, 4)` (currently hard-coded `toFixed(2)`).

4. **`src/components/deal/DealFieldInput.tsx`**
   - `handleBlur` `case 'percentage'`: store with `roundPctForStorage` (4dp) instead of `toFixed(2)`.
   - Display path already routes through `formatForDisplay`, so it picks up new behavior automatically.

5. **Targeted per-field display caps** (only files that already inline `toFixed`/`formatPercentage` for these fields — no layout changes):
   - `LoanTermsDetailsForm.tsx` – Note Rate, Default Rate → `formatPercentDisplay(v, 3)`
   - `LoanTermsBalancesForm.tsx` – Sold Rate → `(v, 3)`
   - `LoanTermsPenaltiesForm.tsx` – Late Charge % → `(v, 3)`; distribution % (Pro Rata) → `(v, 4)`
   - `FundingDetailForm.tsx`, `LoanFundingGrid.tsx`, `LenderDisbursementModal.tsx`, `AddFundingModal.tsx`, `FundingAdjustmentModal.tsx` – Pro Rata → `(v, 4)`
   - `PropertyDetailsForm.tsx` – LTV, CLTV, Protective Equity → `(v, 2)` (already 2dp; just route through helper so trailing-zero rule is consistent)
   - `LienDetailForm.tsx`, `PropertiesTableView.tsx`, `LienSectionContent.tsx` – any percent column → `(v, 2)` unless it's an interest rate (then 3)

6. **Distribution math** (`LoanTermsPenaltiesForm.tsx`, `FundingDetailForm.tsx`, allocation helpers in `loanAllocationValidation.ts`)
   - Replace remaining `parseFloat(...) + parseFloat(...)` percent sums with `Decimal` arithmetic so 33.3333 × 3 = 99.9999 (not 99.99999999…). Final compare uses `Decimal.eq` / tolerance `1e-4`.
   - Dollar distribution: keep computing from runtime dollar inputs (already does); ensure rounding only at final write with `roundDollarForStorage`.

7. **Document merge** (`supabase/functions/_shared/field-resolver.ts`, `formatting.ts`)
   - Percentage formatter switches to the smart-trim algorithm with the same per-field max table. Stored value (already 4dp) is the source — never re-derive from displayed.
   - No change to dollar formatting.

## Critical guarantees

- **No** schema migration, no new tables, no new APIs.
- Existing `setValue` / save paths untouched — only the value they receive changes (now `toFixed(4)` for percents).
- All UI layouts, components, labels, and order untouched.
- `decimal.js` is the only new dependency.

## Out of scope

- Changing field labels, ordering, locking behavior, or any non-percentage field.
- Backfilling historical values stored at 2dp — they’ll simply continue to display correctly (2dp is a valid prefix of 4dp).

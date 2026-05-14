# Platform-wide Financial Precision & Formatting Standard

## Current state (already in place)

- `src/lib/precisionFormat.ts` — Decimal.js-based helpers: `toDecimal`, `formatPercentDisplay`, `roundPctForStorage`, `roundDollarForStorage`, `sumPercents`, `computeAmortizedPayment`, `allocateDollarsByPercent`. All math uses `decimal.js` (no native floats).
- `supabase/functions/_shared/formatting.ts` — server-side `formatPercentage` mirroring the client smart-trim rule (min 2, strip-trailing-zero beyond 2nd decimal).
- Save path in `DealFieldInput.tsx` already calls `roundPctForStorage` for `percentage` data type → 4dp storage is enforced for dictionary-driven fields.
- Several rate components (LoanTermsDetailsForm, LoanTermsPenaltiesForm, LoanFundingGrid, FundingAdjustmentModal, LoanTermsBalancesForm) already use `formatPercentDisplay` with explicit `max` decimals.

So the building blocks exist. Remaining work is **categorization, audit, consistency, and tests** — no schema changes, no new APIs.

## Scope (what changes)

### 1. Add a category-aware helper layer

Append to `src/lib/precisionFormat.ts` (and mirror in `supabase/functions/_shared/formatting.ts`):

| Helper | Max display decimals | Use for |
|---|---|---|
| `formatInterestRate(v)` | 3 | Note Rate, Default Rate, Interest Guarantee Rate, Deferred Interest Rate |
| `formatProRata(v)` | 4 | Pro Rata %, Funding %, Lender allocation % |
| `formatRatio(v)` | 2 | LTV, CLTV, Protective Equity, ratio fields |
| `formatLateChargePct(v)` | 3 | Late Charge percent |
| `formatDollar(v)` | 2 (always) | Currency: `$1,000.00` with `,` separators and `$` prefix |

All percent helpers append `%`; all are wrappers over the existing `formatPercentDisplay`/Decimal logic so smart-trim behavior stays identical (`10.50%`, `10.875%`, `10.8756%`, `27.2727%`).

### 2. Field → category map

Extend `src/lib/legacyKeyMap.ts` (or a new sibling `src/lib/fieldPrecisionMap.ts`) with a single source of truth: field-key prefix/suffix → category. Used by `DealFieldInput`, grids, and the doc-gen formatter so every display site routes through the right helper without per-component hardcoding.

Examples:
- `*note_rate*`, `*default_rate*`, `*int_rate*`, `*interest_guarantee*`, `*deferred_interest*` → interestRate
- `*pro_rata*`, `*funding_pct*`, `*pct_owned*`, `lender_*_rate*` (the pro-rata column, not note rate) → proRata
- `ltv*`, `cltv*`, `protective_equity*` → ratio
- `late_charge*pct*`, `late_charge_percent*` → lateChargePct
- Else (data_type=`percentage`) → default to interestRate (3dp) so behavior is conservative.

### 3. Audit & route every percent display site

Replace direct `toFixed`, `parseFloat`, or `${value}%` patterns across these files (read-only audit list, then minimal targeted edits):
- `src/components/deal/LoanTermsDetailsForm.tsx`
- `src/components/deal/LoanTermsPenaltiesForm.tsx`
- `src/components/deal/LoanTermsBalancesForm.tsx`
- `src/components/deal/LoanTermsFundingForm.tsx`
- `src/components/deal/LoanTermsServicingForm.tsx`
- `src/components/deal/LoanFundingGrid.tsx`
- `src/components/deal/FundingDetailForm.tsx`
- `src/components/deal/AddFundingModal.tsx`
- `src/components/deal/FundingAdjustmentModal.tsx`
- `src/components/deal/PropertyDetailsForm.tsx`
- `src/components/deal/LienDetailForm.tsx`
- `src/components/deal/LienSectionContent.tsx`
- `src/components/deal/OriginationFeesForm.tsx`
- `src/components/deal/RE885ProposedLoanTerms.tsx`
- `src/components/deal/ChargesSectionContent.tsx`
- `src/components/contacts/{lender,broker,borrower}-detail/*Portfolio.tsx`
- `src/components/contacts/{lender,broker}-detail/*Charges.tsx`

Rule per site: lookup category from the field key map → call `formatInterestRate`/`formatProRata`/`formatRatio`/`formatLateChargePct`/`formatDollar` → render. On focus, show raw stored string (already the convention via `isFocused` ternaries).

### 4. Currency consistency

`formatDollar` becomes the single client-side currency formatter (`$` + `Intl.NumberFormat en-US` with min/max 2dp). Replace ad-hoc currency renderers in the same audit list. Storage already routes through `roundDollarForStorage` for `currency` data type — confirm and patch any direct `toFixed(2)` site.

### 5. Calculations use stored precision only

Audit `src/lib/calculationEngine.ts` and `src/lib/lienCalculationEngine.ts` to ensure inputs come from raw stored values (not display strings). Replace any `parseFloat(displayedString.replace('%',''))` patterns with `toDecimal(rawStored)`. Distributions already use `allocateDollarsByPercent` in `precisionFormat.ts`; extend to any waterfall/allocation site that doesn't.

### 6. Document merge field rule

In `supabase/functions/_shared/formatting.ts` and any caller in `supabase/functions/generate-document/index.ts`:
- Currency merge fields → server `formatCurrency` (already enforces 2dp).
- Percent merge fields → server `formatPercentage(value, maxByCategory)`. Add a `formatPercentByFieldKey(key, value)` that uses the same field→category map (duplicated in `_shared/` so edge fns don't import from `src/`).

This guarantees the doc reflects stored precision, never UI-rounded values.

### 7. Validation on input

In `DealFieldInput.tsx` `percentage` branch: cap typed precision at 4 decimals (truncate further input via the existing `numericInputFilter`). Already 4dp on save; add the input-time guard so users can't enter `5.123456`.

### 8. Tests

Add `src/lib/precisionFormat.test.ts`:
- Smart-trim cases for each category (the examples in the spec).
- Storage rounding (4dp percent, 2dp dollar).
- `sumPercents` no-drift across 100 rows.
- `allocateDollarsByPercent` total = original (within 1¢) when distributing.
- `computeAmortizedPayment` known-value spot checks.

Add `supabase/functions/_shared/formatting.test.ts`:
- Same percent display cases (parity with client).
- Currency formatting.

## Out of scope

- No DB schema or column changes.
- No new tables, no new endpoints.
- No changes to deal_field_values payload shape — all values continue to flow through existing save/update APIs as strings.
- No changes to UI layouts, colors, or component structure beyond swapping formatter calls.

## Verification

1. Spot-check the 6 example cases from the spec render identically in: form input (blurred), grid cell, detail page, generated docx merge field.
2. Edit → save → reload a Note Rate of `8.876%` and a Pro Rata of `27.2727%` — confirm DB stores `8.8760` / `27.2727`, displays trim correctly, and merge field uses raw stored value.
3. Run `bunx vitest run` to confirm all new unit tests pass.

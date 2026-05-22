# Platform-Wide Precision & Percentage Handling

## Current State

The platform already has a centralized precision utility at `src/lib/precisionFormat.ts` built on `decimal.js` that covers the entire spec surface:

- Storage: `roundPctForStorage` (4dp), `roundDollarForStorage` (2dp), `normalizeStoredPrecision`
- Display: `formatPercentage`, `formatRate` (3dp), `formatProRata` (4dp), `formatRatio`/`formatLtv` (2dp), `formatLateChargePct` (3dp), `formatCurrency`, `formatPercentByFieldKey`
- Math: `toDecimal`, `sumPercents`, `allocateDollarsByPercent`, `computeLtv`, `computeAmortizedPayment`

So this is **not** a "build the utility" task — it is an **audit + wiring** task to make sure every rate/percent/dollar callsite goes through this utility, never through native `toFixed`/`parseFloat` math, never through display-rounded values, and never with truncated storage.

## Scope

Bring every Rate / Percentage / Ratio / Funding / Dollar field on the platform onto the existing utility, with no behavior changes to working flows.

### 1. UI display audit
Replace ad-hoc `.toFixed(...)` / `Intl.NumberFormat` / template-string formatting in these files with the appropriate `formatRate` / `formatProRata` / `formatLtv` / `formatLateChargePct` / `formatPercentage` / `formatCurrency`:
- `LoanFundingGrid.tsx`, `AddFundingModal.tsx`, `FundingDetailForm.tsx`, `LenderDisbursementModal.tsx`
- `LoanTermsFundingForm.tsx`, `LoanTermsDetailsForm.tsx`, `LoanTermsBalancesForm.tsx`, `LoanTermsPenaltiesForm.tsx`, `LoanTermsServicingForm.tsx`
- `OriginationFeesForm.tsx`, `LienDetailForm.tsx`, `LienSectionContent.tsx`
- Trust ledger views (deal + borrower/lender/broker), Portfolio views, Charges views, History views, PropertiesTableView, attachment file-size formatters (leave file-size `toFixed` alone — not financial)

Use `formatPercentByFieldKey(fieldKey, value)` as the default in generic renderers (`DealFieldInput.tsx`, grid cells) so category is auto-resolved.

### 2. Edit ↔ display lifecycle
For every editable rate/percent input:
- On focus: show the raw stored value (4dp, no `%`, no commas) so the user can edit precisely.
- On blur: route through `normalizeStoredPrecision(value, 'percent' | 'dollar')` before persisting, and `formatPercentByFieldKey` for the display value.
- Never derive the persisted value from the formatted display string.

### 3. Calculation audit
Walk through every place that currently uses `parseFloat` / native `*` `/` `+` `-` on monetary or rate fields and route through `toDecimal` + Decimal arithmetic:
- `calculationEngine.ts`, `lienCalculationEngine.ts`, `interestValidation.ts`, `loanAllocationValidation.ts`, `fieldTransforms.ts`, `fieldValueResolver.ts`
- Funding distribution / pro-rata / lender allocation in `LoanFundingGrid`, `AddFundingModal`, `FundingDetailForm`, `LenderDisbursementModal`
- Interest/principal split, payment recalculation, override recalculation
- Charges / penalties / origination-fee totals
- Trust ledger interest accrual & payoff math

Rounding-adjustment rule: after Decimal allocation, compute the residual penny delta and assign it to a single lender (largest share, then earliest sequence as tiebreaker) so totals reconcile to the cent.

### 4. Storage / API boundary
- All write paths (`useDealFields`, funding save, trust ledger save, lien save) call `normalizeStoredPrecision` before persisting JSONB/`deal_section_values`/`deal_field_values`.
- Read path keeps the raw 4dp string; nothing should pre-round on load.
- DB columns already store as `numeric` (no precision cap) or as JSONB string — no migration needed. Add a one-time QA sweep to confirm no existing row was saved with truncated precision; if any are found, leave them (they were user input) but never re-truncate on edit.

### 5. Document merge / generation
In `supabase/functions/generate-document` and `supabase/functions/_shared/field-resolver.ts`:
- Merge tags resolve to the **stored** 4dp value, never the UI-formatted string.
- Add a small server-side mirror of `formatPercentByFieldKey` for any merge tag that explicitly wants a display-formatted variant (e.g. a `*_display` suffix); default tags emit the raw stored numeric.
- Existing RE851A/D pipelines and the questionnaire safety passes are not touched.

### 6. Tests
Extend `precisionFormat.test.ts` with the spec's QA matrix (10.0000→"10.00", 10.5000→"10.50", 10.8750→"10.875", 10.8756→"10.8756", 27.2727→"27.2727"), the 33.3333% / 27.2727% three-lender split reconciliation, and a merge-tag stored-vs-display test.

## Out of scope (do not touch)

- Override modal UX and recalculation flow (per minimal-change policy)
- Field dictionary schema, RLS, auth, or any other module
- File-size `toFixed` calls in attachment components — not financial
- Visual styling of any screen

## Technical Notes

- All new code imports from `@/lib/precisionFormat` (UI) and a thin Deno copy in `supabase/functions/_shared/precisionFormat.ts` (edge). Keep a single source of truth — no inline re-implementations.
- No new dependencies; `decimal.js` is already in the bundle.
- Each touched file gets surgical edits only (display call swap, normalize on persist, Decimal math in the one function that needed it).

## Deliverables

1. Wired callsites across the file list in section 1–3.
2. `normalizeStoredPrecision` enforced at every write boundary (section 4).
3. Edge-function `_shared/precisionFormat.ts` + merge-tag wiring (section 5).
4. Expanded `precisionFormat.test.ts` covering the 10-case QA matrix (section 6).

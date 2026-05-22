## Goal

Guarantee Lender Rate is never blank when Sold Rate is missing, by falling back to Note Rate everywhere (UI, persistence, reload, downstream calculations) while preserving manual overrides.

## Current state (already in place — will not change)

- `AddFundingModal` resolves Lender Rate as: Override value → Sold Rate (validated) → Note Rate (`isValidMortgageRate` guard, lines 395–432).
- Save path in `LoanFundingGrid.handleSaveFundingRecord` (lines 998–1012) already falls back to Note Rate when no sold/lender rate is present.
- Override tracking already persisted via `lenderRateOverride` + `lenderRateOverrideValue` on each funding record (this is the existing `isLenderRateOverridden` flag — no new column needed).
- Note Rate stored at 4dp, displayed via `formatPercentage(..., 3)` — precision rules already met.

## Gaps to fix (scope of this change)

1. **Grid display fallback** — `LoanFundingGrid` cell renderer for `lenderRate` (lines 621–639) shows a `-` placeholder with an "defaulting to Note Rate" tooltip when `hasLenderRate(record)` is false. It does not actually render the Note Rate value. Legacy/persisted records that never got a lenderRate value still appear blank to the user.
2. **Live Note Rate propagation to saved records** — When the deal-level Note Rate changes and a saved funding record has `lenderRateOverride !== true` AND no valid Sold Rate, the record's `lenderRate` is not refreshed. `recomputeLenderPayments` updates payments but leaves the rate field stale.
3. **Modal manual-edit protection** — The current modal effect (line 412–428) re-syncs `lenderRate` to `effectiveRate` whenever Note/Sold changes, even if the user typed a Lender Rate by hand without toggling Override. Per Rule 4 we must not overwrite a user-typed value; only auto-filled values should track Note Rate.

## Changes

### `src/components/deal/LoanFundingGrid.tsx`

- In the `lenderRate` cell renderer, when `hasLenderRate(record)` is false:
  - If a usable `noteRate` (or `record.rateNoteValue`) exists, render it via `formatPercentage(noteRateValue, 3)` with a small "auto" badge/tooltip ("Auto-filled from Note Rate").
  - Otherwise keep the existing `-` + warning tooltip.
- In the records-load/normalization path (around lines 480–520, where records are hydrated from props), when `record.lenderRate <= 0` and `record.lenderRateOverride !== true`, set the in-memory `lenderRate` to the numeric Note Rate so downstream calculations (Pro Rata, payment) are correct without forcing a save.
- Add an effect that, when the `noteRate` prop changes, walks records and updates `lenderRate` for any record where `lenderRateOverride !== true` AND `(record.rateSoldValue || soldRate)` is empty/invalid. This mirrors the new value into the row state and triggers `recomputeLenderPayments`.

### `src/components/deal/AddFundingModal.tsx`

- Tighten the sync effect (lines 395–432): only overwrite `prev.lenderRate` with `effectiveRate` when one of:
  - `overrideOn === true` (override controls the field), OR
  - `prev.lenderRate` is empty / equals the previous `linkedRate` (i.e. the field is still auto-filled, not user-edited).
- Track a transient `lenderRateUserEdited` flag in `formData` (set true on direct `lenderRate` input change) so the effect can distinguish "auto-filled" vs "manually edited without Override toggle". Reset on Override toggle and on save.
- When `lenderRateUserEdited` is true, also persist `lenderRateOverride = true` + `lenderRateOverrideValue = lenderRate` on save so reload behavior matches Rule 5/6.

### No changes

- No schema migration. The spec's `isLenderRateOverridden` requirement is satisfied by the existing `lenderRateOverride` boolean on each funding record (stored in `deal_section_values` JSONB under the funding section).
- No edge-function / document-generation changes.
- `LoanTermsFundingForm.tsx` save logic untouched — it already passes the resolved `lenderRate` through.
- Precision helpers (`precisionFormat.ts`) untouched.

## Files touched

- `src/components/deal/LoanFundingGrid.tsx`
- `src/components/deal/AddFundingModal.tsx`

## QA mapping (against the 12 test cases)

- TC1, TC3, TC4: covered by grid display fallback + load-time hydration.
- TC2, TC11: covered by existing save fallback + new hydration on reload.
- TC5, TC6, TC8: covered by `lenderRateUserEdited` → `lenderRateOverride` persistence.
- TC7: covered by the new noteRate-change effect in the grid.
- TC9: existing Sold Rate priority is unchanged.
- TC10: existing 4dp storage + `formatPercentage` display — no change needed.
- TC12: blank Lender Rate no longer reaches downstream consumers because the grid hydrates from Note Rate on load.

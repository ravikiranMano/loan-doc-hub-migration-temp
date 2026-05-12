## Scope

Three small, additive changes inside the **Enter File Data → Funding** screen and the **Loan Terms** sub-navigation. No new APIs, no schema changes, no removed/refactored functionality.

## Changes

### 1. `Pro Rata` input auto-syncs with the grid total

File: `src/components/deal/LoanTermsFundingForm.tsx`

- Compute the sum of `pctOwned` across **all** `fundingRecords` (not just the current page), reusing the same rounding-adjustment behaviour already implemented in `LoanFundingGrid.computedPctOwned` so the displayed total matches the grid column total exactly (i.e. resolves to 100.00 when an adjustment row is set).
- On every change to `fundingRecords`, push the rounded-to-2-decimals total into `loan_terms.pro_rata` via the existing `onValueChange('loan_terms.pro_rata', value)` flow and trigger the existing `saveDraft()` (same pattern already used for header field blurs). This persists through the existing `deal_section_values` save path — no new endpoint.
- Pass the computed value down as the `proRata` prop. The header `Pro Rata` input then always reflects the grid total. Keep the input disabled (read-only style) since it is fully derived; this preserves the field but prevents drift.

### 2. `Account` input auto-fills from `Previous Account Number`

File: `src/components/deal/LoanTermsFundingForm.tsx`

- Read `values['loan_terms.previous_account_number']` (already loaded into the same `values` bag through `useDealFields`).
- Extend the existing `derivedLoanNumber` / `loanNumberEdited` mirroring effect (around line 197–208): when the user has **not** edited the Account field and `loan_terms.previous_account_number` has a value, mirror it into `localLoanNumber` and call `onValueChange('Terms.LoanNumber', previousAccountNumber)` so it persists through the same save path used today. If the user types into Account, `loanNumberEdited.current = true` continues to block the auto-fill, preserving manual entry.
- No change to the input markup in `LoanFundingGrid` — the same `loanNumber` prop now carries the auto-filled value.

### 3. Rename the `Loan` sub-tab to `Loan Details`

File: `src/components/deal/LoanTermsSubNavigation.tsx`

- In `LOAN_TERMS_SECTIONS`, change the entry `{ key: 'details', label: 'Loan' }` to `{ key: 'details', label: 'Loan Details' }`. Key is unchanged so all routing/state continues to work.

## Persistence

- Pro Rata writes to `loan_terms.pro_rata` (existing field) via `onValueChange` + `saveDraft` — same pipeline as the current manual input.
- Account writes to `Terms.LoanNumber` / `loan_terms.loan_number` (existing field) via the same `handleLoanNumberChange` path used today.
- `loan_terms.previous_account_number` is read-only here; nothing new is written to it.

## Out of scope

- No DB migration, no new field_dictionary entries, no edge-function changes.
- No layout, styling, grid logic, or document-generation flow changes.
- No changes to other sub-tabs, other forms, or other deal sections.

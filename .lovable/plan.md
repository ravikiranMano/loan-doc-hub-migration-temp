# Add Disbursement Modal — Validation Hardening (Rules 1-15)

Target: `src/components/deal/LenderDisbursementModal.tsx` (407 lines, already wired
through `LoanFundingGrid.tsx` via `data.disbursements`). All persistence stays on
the existing `disbursements` array path — no schema, no new tables, no API rewiring.

## Current gaps vs. spec

The modal already handles auto-calc (Rule 5), read-only amount (Rule 13), `debitOf`
auto-default to NA at 0% (partial Rule 4), and min ≤ max sanity. It is missing
explicit per-rule error messages, debit % bounds, percentage 4-decimal precision,
plus negative guard, date-range bounds, duplicate-payee guard, total-disbursement
guard, and manual-override-with-reason flow.

## Changes (all inside `LenderDisbursementModal.tsx` unless noted)

### A. Per-field inline errors with spec-exact copy
Add a `touched` set and an `errors` object keyed by field. Show `<p
className="text-[10px] text-destructive ...">` under each affected row using the
spec's exact text:

| Rule | Field | Message |
|------|-------|---------|
| 1 | Payee | `Payee is required.` |
| 3 | Debit % > 100 | `Debit percentage cannot exceed 100%.` |
| 3 | Debit % < 0 | `Debit percentage cannot be negative.` |
| 4 | Debit Through unset when % > 0 | `Please select Debit Through option.` |
| 6 | Calc < Min (override mode) | `Calculated amount cannot be less than minimum amount.` |
| 7 | Calc > Max (override mode) | `Calculated amount cannot exceed maximum amount.` |
| 8 | Plus < 0 | (block via input filter + msg) `Plus amount cannot be negative.` |
| 9 | Start date invalid / out of [origination, maturity] | `Invalid disbursement start date.` |
| 10 | Same payee + same Debit Through already present | `Duplicate disbursement configuration already exists.` |
| 11 | Σ disbursements (incl. this one) > available payment | `Total disbursement exceeds available payment amount.` |
| 14 | Override reason blank when override on | `Override reason is required.` |

Save button stays disabled while any error is present (Rule 15 client-side guard);
on click, `handleSaveClick` re-validates and aborts to the first error if found.

### B. Input bounds & precision (Rules 3, 8, 12)
- `debitPercent`: clamp displayed range to `[0, 100]`, allow up to 4 decimals via
  regex `^(\d{0,3})(\.\d{0,4})?$`, strip on paste, store raw string. On blur,
  normalize to up to 4 decimals (suppress trailing zeros past 2 decimals).
- `plusAmount`, `minimumAmount`, `maximumAmount`: 2-decimal currency (already
  formatted on blur), reject negatives via filter.

### C. Date validation (Rule 9)
Read `loan_terms.origination_date` and `loan_terms.maturity_date` from the parent
through two new optional props (`loanOriginationDate?: string`,
`loanMaturityDate?: string`) supplied from `LoanFundingGrid.tsx` (already has
loan terms in scope via `useDealFields`). Pass them to the `EnhancedCalendar`'s
disabled-day predicate and validate on save.

### D. Duplicate prevention (Rule 10)
Add prop `existingDisbursements?: Array<{ accountId: string; debitThrough: string }>`.
Block save (with message) when `(accountId, debitThrough)` matches an existing
row other than the one being edited.

### E. Total disbursement guard (Rule 11)
Add prop `availablePayment?: number` (= per-lender share already computed in
`LoanFundingGrid.tsx`). Compute `Σ otherDisbursements + calculatedAmount` and
block if it exceeds `availablePayment`.

### F. Manual override (Rules 13, 14)
- Add `overrideEnabled: boolean` and `overrideReason: string` to
  `DisbursementFormData` and `emptyForm()`.
- Add a checkbox "Manual override" below the Amount row. When off → Amount stays
  read-only and uses the auto-calculated value (current behavior). When on →
  Amount becomes editable (currency-formatted), the auto-calc is shown as a
  hint, and a required "Override reason" text input appears. Save blocked
  until reason is non-empty.
- Persist `overrideEnabled` / `overrideReason` through the existing
  `onSubmit(data)` path — `LoanFundingGrid.tsx`'s `disbursements` row type
  already passes the form object through unchanged (line 1034) and the
  serializer spreads arbitrary keys (`...d`) at line 501.

### G. Parent wiring (`LoanFundingGrid.tsx`, minimal touch)
At the existing `<LenderDisbursementModal ... />` render site, add the four new
props sourced from already-computed values:
- `loanOriginationDate={loanTerms.origination_date}` / `maturityDate`
- `existingDisbursements={record.disbursements ?? []}`
- `availablePayment={record.lenderPayment}` (already computed)

No changes to save/update functions, payload shape, or `disbursements` columns.

### H. Logging
On every blocked save, `console.warn('[disbursement-validate]', { rule, field,
value })` so QA can trace failures without changing UX.

## Acceptance mapping

Test Cases 1-16 map 1:1 to the rules above. All copy strings are taken verbatim
from the spec. Rule 2 (name auto-populate) already works via `AccountIdSearch`
(line 174-180) — keep as-is; mark Name read-only when `accountId` is set.

## Out of scope (per "do not modify")
- Existing calculation formula in `useMemo` (Rule 5) — unchanged.
- DB schema, RLS, save/update endpoints — unchanged.
- Layout of unaffected rows; error messages are additive `<p>` elements.
- Audit-log persistence beyond storing `overrideReason` on the disbursement
  itself (no new audit table per "no schema changes").

## Origination Fees + RE 885 — Conformance Pass

Scope: audit & fix gaps only. No DB migrations, no new tables, no new field_dictionary rows. Existing `deal_section_values` JSONB storage and document merge-tags preserved.

### Files touched
- `src/pages/loan/origination/OriginationFeesForm.tsx`
- `src/pages/loan/origination/RE885ProposedLoanTerms.tsx`
- (read-only) `src/lib/precisionFormat.ts`, Decimal.js helpers

### Fixes

**1. Section subtotals + Grand Total → read-only computed**
Add `computeSectionTotals(values)` summing rows in 800 (801–812 + custom), 900, 1000, 1100, 1200, 1300 series. Replace the manual Subtotal/Total inputs (~lines 715–728) with read-only currency-formatted fields. Recompute on every change.

**2. 901 Per-Day → auto, read-only**
Formula: `perDay = loan_amount × (interest_rate / 100 / 365)` using Decimal.js, 2dp. Source `loan_amount` and `interest_rate` from `loan_terms.*`. Render read-only in `render901Description`.

**3. 901 Row Total (Paid to Others) → auto**
`interestForDays_others = days × perDay`, 2dp. Write on change to days or upstream loan values; read-only.

**4. RE 885 Proposed Loan Amount → seed from Loan tab**
On mount / when empty, populate from `loan_terms.loan_amount` (fallback `loan_terms.original_amount`). User can still override.

**5. RE 885 Interest Rate → seed from Loan tab**
On mount / when empty, populate from `loan_terms.interest_rate` (4dp). User can still override.

**6. RE 885 Initial Commissions/Fees (Page 1) → always = Section 800 total**
Pass computed `section800Total` from `OriginationFeesForm` into `RE885ProposedLoanTerms`. Render read-only, recompute live.

**7. RE 885 Cash at Closing → always write**
Remove the `abs > 0` gate (lines 117–126). On every change:
- `cash = loanAmount − section800Total − liensPayoff − otherDeductions` (per current spec)
- `cash > 0` → set `payable_to_you = cash`, clear `you_must_pay`
- `cash < 0` → set `you_must_pay = |cash|`, clear `payable_to_you`
- `cash = 0` → clear both

**8. Payment to Existing Liens → auto from Properties tab**
Read `property{N}.lien*` array (current_balance / payoff_amount per existing memory pattern). Populate row 1204-style label + amount; render read-only. Multiple liens → sum or list per existing Properties convention.

### Calc & precision rules
- Money 2dp, rates 4dp — use `src/lib/precisionFormat.ts`
- All arithmetic via Decimal.js (no native float)
- Currency display on blur; raw on focus (existing standard)

### Out of scope
- New SQL tables (`origination_fees`, `origination_reserves`, `re885_loan_terms`)
- New APR % field
- Impound checkbox behavior changes
- Unit tests
- Field dictionary additions

### Verification
- Manually verify each of the 8 fixes in `/deals/.../edit` → Loan → Other Origination → Origination Fees
- Confirm RE 885 card updates live as Section 800 rows change
- Confirm cash-at-closing sign flips correctly across zero
- Confirm no regression to existing saved deals (composite JSONB keys unchanged)

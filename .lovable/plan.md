# Loan Funding & Terms — Fix Plan

Scope: Loan → Terms & Balances, Loan → Funding grid, Add/Edit Lender Funding modal. No changes outside these screens.

## Files to inspect, then edit

- `src/components/deal/LoanTermsBalancesForm.tsx` — remove "Loan Amount" field; convert "Payment Due Date" to date picker.
- `src/components/deal/LoanFundingGrid.tsx` — remove top-level Pro Rata chip; bind summary Balance to Principal; recompute lender Pro Rata + Payment + Net Payment from Principal; under-funded/funded badge; block over-funding.
- `src/components/deal/AddFundingModal.tsx` (and/or `FundingDetailForm.tsx`) — same Pro Rata / Current Balance binding as grid row; Override checkbox gates Lender Rate; disbursements feed Net Payment.
- `src/components/deal/LenderDisbursementModal.tsx` — validate `disbursement ≤ lender payment`.
- `src/lib/precisionFormat.ts` — reuse `computeLtv`-style helpers; add a shared `computeProRata(currentBal, principal)` returning 6dp string; display via existing `formatPercentDisplay(..., 4)` / `formatDollar`.

## Calculation contract (single source of truth)

```
principal               = loan_terms.balances.principal            (2dp $)
totalBalance (summary)  = principal                                (live binding)
lenderPct(L)            = L.currentBalance / principal × 100       (store 6dp, show 4dp%)
lenderPayment(L)        = lenderPct(L)/100 × regularPI             (store full, show 2dp $)
netPayment(L)           = lenderPayment(L) − Σ L.disbursements     (store full, show 2dp $)
underfunded             = Σ L.currentBalance < principal
overfundedAttempt       → reject with toast + inline error
```

All math via `decimal.js` (already in `precisionFormat.ts`). No rounding until display.

## Section-by-section changes

1. **Terms & Balances**
   - Delete `Loan Amount` input + its field key from the rendered form. Keep `Original Amount` untouched.
   - Replace `Payment Due Date` text input with `EnhancedCalendar`-backed date picker, storing `yyyy-MM-dd`, displaying `MM/DD/YYYY` (project standard).
   - No changes to Note Rate / Sold Rate / Principal.

2. **Funding grid summary row**
   - Remove Pro Rata cell from header summary only (keep on lender rows).
   - Summary `Balance` reads `loan_terms.balances.principal` directly (no local copy).
   - Badge: `UNDER-FUNDED` if `Σ currentBalance < principal`, `FUNDED` if equal, hard-block + validation error if a row edit would push `Σ > principal`.

3. **Lender rows**
   - Pro Rata, Payment, Net Payment recomputed live from principal + regular P&I + disbursements via the shared helper.
   - Verified against given numbers: L-00002 → 6.8872% / $718.74, L-00026 → 0.6659% / $69.50.

4. **Add/Edit Lender Funding modal**
   - Pro Rata + Current Balance bound to the same lender record / helper as the grid (no separate state).
   - Override checkbox: unchecked → Lender Rate = Sold Rate (read-only); checked → editable.
   - Disbursements list writes to the same store the grid reads from, so Net Payment updates everywhere.
   - Validation: `disbursement ≤ lenderPayment` else inline error + toast "Disbursement cannot exceed lender payment amount".

5. **Precision**
   - Pro Rata: 6dp stored, 4dp `%` displayed.
   - $ values: full precision stored, 2dp `$` displayed via `formatDollar`.
   - Banker's rounding for currency display (switch `roundDollarForStorage`/`formatDollar` to `ROUND_HALF_EVEN` for display only; storage keeps HALF_UP per existing contract — confirm during edit).

## Code-review summary (Section 7)

Delivered as a numbered list in chat after edits, citing exact file/function/line for Pro Rata, Payment, Disbursement store/query, Net Payment, recalculation trigger, plus residual risks.

## Out of scope

Note/Lender/Spread logic, late charges, ACH, trust accounting, any other screen.

## Risks

- `LoanFundingGrid.tsx` is 1.1k lines and likely the integration nexus — most edits land here; behavior of dependent forms (e.g. `LoanTermsFundingForm.tsx`) will be checked but not refactored unless they share the same Pro Rata code path.
- Display-side banker's rounding may diverge by 1¢ from prior HALF_UP output in rare cases; will flag in the summary.
- If disbursements are currently free-typed strings, the over-disbursement guard could surface existing bad data — will validate on entry only, not retroactively.

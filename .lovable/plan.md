# RE 885 — Correct calculation + loan-scoped derivation

## Root causes (read first)

I traced every flagged defect in `src/components/deal/RE885ProposedLoanTerms.tsx`, `src/components/deal/OriginationFeesForm.tsx`, and `src/components/deal/LoanTermsBalancesForm.tsx`.

1. **Stale $2,812.50 in Section VII.** Two layers fail:
   - `vii_payment_amount` is only auto-written when the stored value is empty/zero (lines 327–334 of `RE885ProposedLoanTerms.tsx`). The first time the form ever sees a value (entered, seeded from a then-current Regular P&I, or carried over from when the principal was $450k), it sticks forever — principal/rate changes do not overwrite it.
   - The fallback that *does* recompute (`minMonthlyPayment`, lines 299–325) uses a standard fully-amortizing formula `P·r(1+r)^n / ((1+r)^n−1)` regardless of the loan's amortization method. For an interest-only loan that formula is wrong, and it is never reached anyway because the stored override always wins.
2. **Section III checkbox blank.** The rate-type seed (lines 191–206) returns early when both `loan_terms.rate_structure` and `loan_terms.variable_arm` are empty, so neither box is set. CA DRE form requires exactly one of Fixed / Initial Adjustable to be selected.
3. **Section VIII "33% / 0 Months".** `viii_rate_increase_pct` is seeded from `loan_terms.penalties.default_interest.flat_rate` (line 216–220) — the wrong source. The 33% is the Default Interest flat rate (a penalty, not a rate-cap). `viii_rate_increase_months` has no seed at all and is never cleared, so any stale value lingers. Nothing clears sections IV–IX when the loan is fixed-rate; the `opacity-40 pointer-events-none` wrapper only dims them visually.
4. **Multiple payment paths.** `LoanTermsBalancesForm.computedRegularPayment` (lines 147–170) always computes interest-only `loanAmount × noteRate / periods`. `RE885.minMonthlyPayment` (lines 299–325) always computes fully-amortizing. `lenderPaymentFormula.computeLenderRow` is per-tranche daily accrual for funding/servicing and is a separate concern. The borrower-scheduled payment has two parallel formulas that disagree by design.

## Amortization method confirmation

Loan Details exposes `loan_terms.amortization` with options including `interest_only`, `fully_amortizing`, `partially_amortizing`, `constant_amortization`. The correct Section VII formula depends on it:

```text
interest_only         → P × (rate/100) / 12
fully_amortizing      → P · r(1+r)^n / ((1+r)^n − 1),  r = rate/100/12, n = termMonths
partially_amortizing  → same monthly formula sized so PV at month n equals the balloon balance;
                        i.e. payment = (P − B/(1+r)^n) · r(1+r)^n / ((1+r)^n − 1)
                        where B = loan_terms.estimated_balloon_payment
constant_amortization → equal principal: P/n + interest on remaining balance for month 1
```

Whichever method `loan_terms.amortization` reports for a given loan is the one Section VII must use. The two example loans in the task ($700k @ 7.5% → $4,375.00 and $900k @ 9.5% → $7,125.00) are pure interest-only; the engine must produce those values when amortization is `interest_only`.

## Plan

### 1. Create one shared borrower-payment function

New `src/lib/borrowerPaymentFormula.ts` exporting `computeBorrowerScheduledPayment({ principal, annualRatePct, termMonths, amortization, balloonAmount, frequency })`. Uses Decimal.js, returns a number rounded to 2 dp, never throws, returns `null` when inputs are missing. Switches on `amortization` per the table above; `frequency` scales the periods (`monthly`, `quarterly`, `annually`, `semi_annually`, `weekly`, `bi_weekly`). Single source of truth.

Add `src/lib/borrowerPaymentFormula.test.ts` covering: $700k @ 7.5% IO, $900k @ 9.5% IO, fully-amortizing 30-yr at 6%, partially-amortizing 70-mo with balloon, and missing-input early returns.

### 2. Rewire Regular Payment in `LoanTermsBalancesForm.tsx`

Replace the hard-coded interest-only block (lines 147–186) with a `useMemo` that calls `computeBorrowerScheduledPayment` using:

- `principal` ← `loan_terms.loan_amount` (or `loan_terms.original_amount` fallback)
- `annualRatePct` ← `loan_terms.note_rate`
- `termMonths` ← derived from `loan_terms.number_of_payments` / `loan_terms.term_years` × 12 / `loan_terms.term_months`
- `amortization` ← `loan_terms.amortization`
- `balloonAmount` ← `loan_terms.estimated_balloon_payment` when amortization is `partially_amortizing`
- `frequency` ← `loan_terms.payment_frequency`

Keep the existing "sync stored value whenever live computation differs" effect so Regular Payment stays loan-scoped and never goes stale.

### 3. Make Section VII derive live

In `RE885ProposedLoanTerms.tsx`:

- Drop the "only seed when empty/zero" gate. Instead, treat Section VII like Regular Payment: continuously sync `vii_payment_amount` to the live derived value whenever it differs by > $0.005. Preserve user override only if we add an explicit `vii_payment_user_override` flag (deferred — current spec says payment must always reflect the loan).
- Replace the local `minMonthlyPayment` block with a single call to `computeBorrowerScheduledPayment`, passing the same loan inputs plus the new `upstreamAmortization` and `upstreamBalloonAmount` props.
- Remove the `upstreamRegularPI > 0 ? regularPI : compute` short-circuit; both must come from the same function so they cannot diverge.

Add to `OriginationFeesForm.tsx`:

- `upstreamAmortization={values['loan_terms.amortization'] || ''}`
- `upstreamPaymentFrequency={values['loan_terms.payment_frequency'] || ''}`
- `upstreamTermMonths` derived from the same number-of-payments / term-years/months chain already in scope.

### 4. Fix Section III (Fixed / Adjustable selection)

- Remove the early-return when both `upstreamRateStructure` and `upstreamVariableArm` are empty.
- Treat unknown rate structure as Fixed (CA DRE form requires a selection, and the deal's other tabs already default to fixed-rate behavior).
- Re-seed whenever `upstreamRateStructure` changes (current effect already keys on it; add the "no-prior-choice" guard plus a "force Fixed when loan flips back to fixed" branch so flipping the loan resets stale Adjustable selections).

### 5. Derive Sections IV–IX from the loan's adjustable settings, clear for fixed

Source of truth = the "Adjustable / Graduated Loan Details" block on Loan Details (field keys already in `field_dictionary`):

| RE 885 field                      | Loan source                                       |
| --------------------------------- | ------------------------------------------------- |
| IV `iv_adj_rate_months`           | `loan_terms.adj_initial_rate_months`              |
| V `v_fully_indexed_rate`          | `loan_terms.adj_fully_indexed_rate`               |
| VI `vi_max_interest_rate`         | `loan_terms.adj_max_interest_rate`                |
| VIII `viii_rate_increase_pct`     | `loan_terms.adj_rate_increase_percent`            |
| VIII `viii_rate_increase_months`  | `loan_terms.adj_rate_increase_months`             |
| IX `ix_payment_end_months`        | `loan_terms.adj_payment_options_end_months`       |
| IX `ix_payment_end_pct`           | `loan_terms.adj_payment_options_end_percent`      |

Changes in `OriginationFeesForm.tsx`: pass these seven new `upstreamAdj*` props. Changes in `RE885ProposedLoanTerms.tsx`:

- Remove the `viii_rate_increase_pct` seeding from `upstreamDefaultInterestRate` (wrong source, that's a penalty, not a rate cap). Drop the `upstreamDefaultInterestRate` prop.
- Add live-sync effects (same "overwrite when different" pattern as Regular Payment) for the 7 fields above when `isAdjustable`.
- When `isFixed`, run a one-time clearing effect that zeroes / clears all 7 stored values so a previously adjustable loan does not leave "33% / 0 Months" behind.

### 6. Section X (Balloon)

Keep current seed but only show / persist balloon balance when `loan_terms.balloon_payment === 'true'`. When the loan is flipped to no-balloon, clear `x_balloon_amount` and `x_balloon_due_months`.

### 7. Section I (already correct)

No formula changes. Confirm the existing `cashAtClosing = loanAmount − subtotal` effect remains; the spec calls it out as correct. No regression intended.

### 8. Sections XVII / XVIII

No changes — existing auto-population from Article 7 / Limited-No-Doc is correct.

## Technical details

- **File-by-file:**
  - `src/lib/borrowerPaymentFormula.ts` (new) — Decimal.js-based switch on amortization, frequency-aware, returns `number | null`.
  - `src/lib/borrowerPaymentFormula.test.ts` (new) — Vitest cases for IO / fully-amort / partially-amort / constant / missing-inputs.
  - `src/components/deal/LoanTermsBalancesForm.tsx` — replace `computedRegularPayment` and its sync effect.
  - `src/components/deal/OriginationFeesForm.tsx` — pass new `upstreamAmortization`, `upstreamPaymentFrequency`, `upstreamTermMonths`, and the 7 `upstreamAdj*` props; remove `upstreamDefaultInterestRate`.
  - `src/components/deal/RE885ProposedLoanTerms.tsx` — drop seed-when-empty for VII; add continuous sync; replace `minMonthlyPayment` with shared util; fix Section III default-to-Fixed; seed sections IV–IX from `upstreamAdj*` and clear them when fixed; remove default-interest seed.
- **No DB migration needed.** All field keys involved already exist in `field_dictionary` (the 11 adjustable entries were added in a prior turn).
- **Single calculation path.** The funding grid keeps `lenderPaymentFormula.computeLenderRow` (different concept: per-tranche servicing income). The borrower scheduled payment used by Regular Payment AND Section VII both call `computeBorrowerScheduledPayment`. No third path remains.
- **Override semantics.** Section VII becomes live-derived only — matches the spec ("must be loan-scoped and recompute when principal/rate/term/method change"). If a manual override is required later, gate by an explicit flag.

## Acceptance checks (post-implementation)

- `$700k @ 7.5%`, amortization=interest_only → Regular Payment and Section VII both show $4,375.00.
- `$900k @ 9.5%`, amortization=interest_only → both show $7,125.00.
- Change a loan's principal or note rate → Section VII updates within the same render; reload preserves the new value.
- Section I: `loanAmount − subtotal == cashAtClosing` to the cent on both loans (unchanged).
- Section III: exactly one of Fixed / Initial Adjustable is checked, matching `loan_terms.rate_structure` (defaults to Fixed when unknown).
- Fixed-rate loan: sections IV / V / VI / VIII / IX show empty / zero, never "33% each 0 Months".
- Adjustable-rate loan: sections IV–IX populate from `loan_terms.adj_*` fields, not from Default Interest.
- Vitest: `borrowerPaymentFormula.test.ts` passes for all 5 cases.
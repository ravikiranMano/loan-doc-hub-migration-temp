## Root cause (confirmed from code + DB)

The Lender Payment formula already includes rate scaling in two places, but a **third** computation path bypasses it and is the actual source of the bug. Where the formula uses Note Rate today:

1. **`src/components/deal/AddFundingModal.tsx`** lines 585–598 — write-side effect on Add:
   ```ts
   const share = (pct/100) × regPI   // ← no lender-rate scaling
   setFormData(prev => ({ ...prev, regularPayment: share }))
   ```
   `regPI` is the borrower Regular P&I, which is derived from the **Note Rate**. So the persisted `regularPayment` on every newly added or modal-edited lender row is implicitly **at Note Rate**, scaled only by Pro Rata.

2. **`src/components/deal/FundingDetailForm.tsx`** lines 85–96 — same unscaled write-side effect on every keystroke inside the per-row detail editor. Overwrites `regularPayment` to the Note-Rate amount before save.

3. **`src/components/deal/LoanTermsFundingForm.tsx`** `recomputeLenderPayments` (line 40) and **`src/components/deal/LoanFundingGrid.tsx`** `computedPaymentsArr` (line 405) — these **do** scale by `lenderRate / noteRate`, but contain a fallback (`useRateScaling = noteRateDec.gt(0)` else return base) that silently returns the unscaled base whenever the `noteRate` prop is empty. The prop is `values['loan_terms.note_rate']` — when Loan Terms hasn't hydrated yet (or for legacy rows), the recompute runs with `noteRate=''`, scaling is skipped, and the persisted Note-Rate value sticks.

DB confirms: deal `DL-2026-0294` has note_rate `9.5`, lender rows with `lenderRate: 7`, but stored `regularPayment` values match the unscaled `(pct × regPI)` formula. That's the Note-Rate result the user sees.

The display layer (`computedPaymentsArr`) re-derives correctly once the page is fully loaded, but the **persisted** value is at Note Rate — so the FundingAdjustmentModal, document generation (`src/lib/fieldValueResolver.ts:364`), and any export that reads the stored field show the wrong number.

---

## Part 1 — Single canonical formula, used everywhere

### A. Extract one helper

New module **`src/lib/lenderPaymentFormula.ts`**:

```ts
import { Decimal } from './precisionFormat';

export interface LenderRowInputs {
  originalAmount: number | string;
  lenderRate?: number | string;   // per-row
}
export interface LoanContext {
  loanPrincipal: number | string; // Σ originalAmount fallback
  regularPI: number | string;     // borrower scheduled P&I
  noteRate: number | string;      // loan-level
}

/** EXACT (un-rounded) per-row payment. Rate scaling is mandatory. */
export function computeLenderRowPaymentExact(
  row: LenderRowInputs, ctx: LoanContext
): Decimal;

/**
 * Compute the full array of per-row payments with rounding + the
 * rounding-adjustment lender absorbing the sub-cent remainder so the
 * sum reconciles to the cent. Returns numbers ready to persist.
 */
export function computeLenderPaymentsRounded(
  rows: Array<LenderRowInputs & { roundingAdjustment?: boolean }>,
  ctx: LoanContext
): number[];
```

Rules baked in:
- Parse strings with `replace(/[%$,]/g,'')`.
- If `loanPrincipal ≤ 0` or `regularPI ≤ 0`, throw a typed `LenderPaymentInputsMissingError` — **callers must handle**, never silently return base.
- If `lenderRate` is missing on a row, the row's effective rate is `noteRate` (legacy behaviour for unset Lender Rate) — **not** "skip scaling".
- If `noteRate` is missing, the helper **also throws** — callers (modals, recompute) must pass it explicitly. This kills the silent Note-Rate fallback.
- Banker's rounding to 2dp; rounding-adjustment row absorbs the diff. Decimal.js only.

### B. Re-wire every call site to the helper

| File | Lines | Change |
|---|---|---|
| `LoanTermsFundingForm.tsx` | 40–75 | `recomputeLenderPayments` becomes a thin wrapper around `computeLenderPaymentsRounded`; throws-aware (returns records unchanged + logs `console.warn` only when inputs genuinely missing). |
| `LoanFundingGrid.tsx` | 401–428 | `computedPaymentsArr` calls the same helper; no inline scaling. |
| `AddFundingModal.tsx` | 585–598 | Effect computes via helper using `noteRate` (passed via prop) and the row's `rateLenderValue || lenderRate`. No more `(pct/100) × regPI`. |
| `FundingDetailForm.tsx` | 85–96 | Same — helper instead of unscaled formula. Receives `noteRate` via existing `totalPayment`/loan props (already plumbed; add `noteRate?: string` to props). |

### C. Single-path guarantee

After the rewrite, the symbol `regularPI / 100 * pctOwned` (the unscaled formula) must not exist anywhere except the helper. Add a vitest `src/lib/lenderPaymentFormula.test.ts` covering: equal-rate no-op, Note=12 / Lender=6 halves payment, missing lenderRate falls back to noteRate, rounding-adjustment absorbs cents, sum reconciles.

---

## Part 2 — Recompute on edit + stale-value resolution

### Recommendation: derive-on-read (display) + recompute-on-write (persist)

Stored `regularPayment` becomes a **snapshot for exports/docs only**, never the truth for the grid. The grid already derives via `computedPaymentsArr` — keep that. To eliminate the "I changed a date and Payment didn't move" class of bug:

1. **Stop the modal write-side effects** from being the canonical computation. They will still call the helper, but only to keep the form's preview field in sync; the actual persisted value is recomputed at save time via the parent's `recomputeLenderPayments` (which now throws-aware uses the helper).

2. **Add a single sync effect** in `LoanTermsFundingForm.tsx` (right after `noteRate` / `totalPayment` / `fundingRecords` are read) that watches:
   - `noteRate`, `totalPayment`, `loanPrincipalBalance`
   - and any row-level `lenderRate`, `originalAmount`, `fundingDate`, `interestFrom`, `roundingAdjustment` change
   
   When the helper output differs from the stored array by > ½ cent on any row, persist the corrected array via the existing `directPersistFundingField('loan_terms.funding_records', …)` path. Debounce 400 ms to avoid save storms while typing.

3. **Hard guard**: if inputs are missing (the helper throws), the effect logs a warning and leaves storage untouched — no silent Note-Rate fallback writes.

This means: changing a date / rate / amount on any row immediately recomputes Payment (display), then persists within 400 ms. Reload shows the persisted-and-correct value.

---

## Part 3 — Backfill of existing records

### Step 1 — Dry-run report (no writes)

New edge function **`supabase/functions/audit-lender-payments/index.ts`**:

- Query every `deal_section_values` row where `section = 'loan_terms'` AND `field_values ? '4f76135d-042f-4367-bebc-5db66a06e0ae'` (the funding_records dict id).
- For each deal, parse `funding_records` JSON; pull loan-level `note_rate` (`969b2029…`), `loan_amount` (`163cd0b4…`), `total_payment`/`regular_payment` (resolve via field_dictionary at start-up).
- For each lender row, call `computeLenderPaymentsRounded` (same helper, copied to `supabase/functions/_shared/lenderPaymentFormula.ts` — pure Decimal.js, no DOM deps).
- Compare `stored.regularPayment` vs `corrected[i]`. Emit one CSV row per lender per deal: `deal_number, lender_account, lender_name, originalAmount, noteRate, lenderRate, storedPayment, correctedPayment, delta, reason`.
- **Skip + flag** with explicit `reason` codes (still emitted in the CSV, just under a separate `skipped_*` reason):
  - `skipped_equal_rates` — `noteRate === lenderRate` (no change expected).
  - `skipped_bad_date` — `interestFrom` or `fundingDate` parses to year < 2000 or > current_year + 10.
  - `skipped_manual_override` — row has `lenderRateOverride === true` **or** appears in `loan_terms.funding_adjustments` JSON for that lender after its last `funding_records` update.
  - `skipped_missing_inputs` — helper throws (no noteRate / no regPI).
- Write CSV to Storage bucket `audits/lender-payments/<runId>.csv` and return the signed URL + counts (`changed`, `unchanged`, `skipped_*` per code).

Trigger from a one-off admin page (`/admin/audits/lender-payments`) or call the function directly. **No DB writes in this step.** Plan stops here for human review.

### Step 2 — Apply (after explicit approval)

Edge function **`supabase/functions/apply-lender-payments-backfill/index.ts`**:

- Takes the same `runId` from Step 1 so it reads the exact CSV the user approved.
- For each affected deal, in a single transaction:
  1. `SELECT … FOR UPDATE` the `deal_section_values` row.
  2. Recompute via helper (idempotent — reads inputs fresh from the row, not the CSV, to handle concurrent edits; if recomputed values differ from the CSV's `correctedPayment` for a row, skip that row and add to `reapply-needed.csv` instead of writing stale).
  3. Insert an `activity_log` row: `action_type='funding_payment_backfill'`, `action_details = { runId, before: <full funding_records JSON>, after: <new>, changedRows: [...] }`. This is the reversal record.
  4. `UPDATE deal_section_values SET field_values = jsonb_set(field_values, '{<dict_id>,value_text}', to_jsonb(<new JSON string>))`.
- Idempotent: re-running on a corrected deal produces zero `activity_log` writes because the helper-recomputed array equals the stored array.
- Reversal: a separate `revert-lender-payments-backfill` function reads the `activity_log` entry and writes `before` back, also transactionally and audited.

### Coverage of "don't break"

- **Rounding-lender absorbs the cent**: the helper does this in the same pass that computes per-row payments. Sum of `corrected[]` reconciles to `regularPI × Σ(pct/100)` exactly.
- **Pro Rata / totals / Net Payment** in `LoanFundingGrid` derive from `originalAmount` and the corrected `regularPayment` array — no change needed; they update automatically.
- **Currency precision**: Decimal.js everywhere, banker's rounding, no native floats.

---

## Test plan

1. **Wide-spread test loan**: $1,200,000 / Note 12% / Lender 6%, clean 30-day → Payment shows ~$6,000/mo (not ~$12,000).
2. **Decisive input test**: open a funded row.
   - Change only Note Rate → grid Payment unchanged (display uses helper which scales by Note Rate denominator; doubled-numerator/doubled-denominator cancels because Regular P&I also rises 1:1 with Note Rate when re-derived by Loan Terms). ✅
   - Change only Lender Rate → Payment recomputes immediately (within 400 ms persist).
3. **$900k loan after backfill**: $835k lender row drops from $1,922.70 to ~$1,417; period accrual resolves at 7%.
4. **Equal-rate row** (Note == Lender): unchanged after backfill (`skipped_equal_rates`).
5. **Date edit**: change Interest From May → June on $900k loan → Payment changes; total + rounding reconcile to the cent.
6. **Reload**: persisted values survive refresh.
7. **Idempotent backfill**: second run reports zero deltas.
8. **Vitest**: new `lenderPaymentFormula.test.ts` covers all five cases above at the unit level.

---

## Deliverables checklist (mapped to user request)

- [x] (1) Current formula + location → AddFundingModal:589, FundingDetailForm:87, plus silent Note-Rate fallback in LoanFundingGrid:411 / LoanTermsFundingForm:54.
- [x] (2) Corrected formula in `src/lib/lenderPaymentFormula.ts`, applied to all 4 sites.
- [x] (3) Single-path guarantee enforced by removing inline formulas + new vitest.
- [x] (4) Recompute-on-edit via debounced effect in `LoanTermsFundingForm`; storage is a snapshot, grid is live.
- [x] (5) Dry-run audit edge function + CSV, then transactional apply edge function with `activity_log` audit trail and reversal function.
- [x] (6) Rounding-adjustment absorption baked into the shared helper.

No schema migrations. The only new tables touched are inserts into the existing `activity_log`. Two new edge functions and one new shared `_shared/lenderPaymentFormula.ts`. Four frontend files edited.
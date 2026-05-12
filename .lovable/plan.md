## Add missing fields to Loan → Terms & Balances

Add the fields shown in the screenshot that are not currently in the form. No DB schema changes — values persist via the existing `deal_section_values` JSONB store and existing save/update API. Existing fields, layout for current rows, and other forms remain unchanged.

### 1. New field keys (`src/lib/fieldKeyMap.ts` → `LOAN_TERMS_BALANCES_KEYS`)

Add under `loan_terms.*`:

- `shortPaymentHandling` — `loan_terms.short_payment_handling` (dropdown)
- `applyToPaymentParameters` — `loan_terms.apply_to_payment_parameters` ("%" | "$")
- `applyShortPayment` — `loan_terms.apply_short_payment` (dropdown)
- `unpaidInterestProcessing` — `loan_terms.unpaid_interest_processing` (dropdown)
- `payAutomatically` — `loan_terms.pay_automatically` (boolean)
- `calculateInterestOnInterest` — `loan_terms.calculate_interest_on_interest` (boolean)
- `fundingHoldbackAmount` — `loan_terms.funding_holdback_amount` (currency)
- `toReserves` — `loan_terms.to_reserves` (currency)
- `overpaymentsUnpaidInterest` — `loan_terms.overpayments_unpaid_interest` (currency)
- `overpaymentsShortPayments` — `loan_terms.overpayments_short_payments` (currency)
- `overpaymentsProcessingUnpaidInterest` — `loan_terms.overpayments_processing_unpaid_interest` (currency)

### 2. UI additions (`src/components/deal/LoanTermsBalancesForm.tsx`)

Terms column — add new "Shortpay / Overpay Handling" sub-header above existing "Accept Short Payments" block:
- Short Payment Handling — Select (options: Do Not Accept / Deposit to Suspense / Apply to Payment)
- Apply to Payment Parameters — `%` / `$` toggle (checkbox/segmented)
- Apply Short Payment — Select (options: Apply Short Pay / Unpaid Interest / Add to Principal)
- Unpaid Interest Processing — Select (options: Pay Automatically / Manual)
  - Pay Automatically — Checkbox sub-row
  - Calculate Interest on Interest — Checkbox sub-row

Funding Holdback row — add a `$` currency input next to the existing `Held By` dropdown (keep current dropdown intact).

Payments column — insert "To Reserves" currency row between "To Escrow Impounds" and "Default Interest" / "Total Payment".

Payments column — append "Overpayments Applied To" labeled group at the bottom with three currency rows:
- Unpaid Interest
- Short Payments
- Processing Unpaid Interest

### 3. Persistence

All new keys are read/written through the existing `values` / `onValueChange` props (already wired into `useDealFields` → `deal_section_values`). No new save logic, no edge function changes, no schema migration.

### 4. Constraints honored

- No changes to existing fields, labels, or layout for unchanged rows.
- No DB schema, RLS, or API changes.
- Reuses `renderCurrencyField`, `Select`, `Checkbox`, and `DirtyFieldWrapper` patterns already in the file.
- Uses existing `LABEL_CLASS` and column structure.

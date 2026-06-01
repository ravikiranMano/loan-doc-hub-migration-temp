# Fix non-editable fields on Loan Details

Two defects, same root cause for persistence: the underlying field keys are not in `field_dictionary`, so per the project's strict persistence contract any value the UI writes is silently dropped. The Send rows have a second defect on top of that: they're rendered with a hard `readOnly`/`disabled` input.

## Verified findings

- `src/components/deal/LoanTermsDetailsForm.tsx` line 1077 renders each Send row's Last Sent cell via `renderReadOnlyDateField(...)` (defined at line 817). That helper hardcodes `readOnly` + `disabled` + the `—` placeholder — that's why typing/clicking does nothing.
- The same file at line 1189–1203 renders the Penalties "Borrower must then make principal and interest payments of `$`" field bound to `FIELD_KEYS.adjFinalPaymentAmount` (`loan_terms.adj_final_payment_amount`). The input is wired to `handleCurrencyChange`/`handleCurrencyBlur`, but nothing persists.
- DB check confirms none of these keys exist in `field_dictionary`:
  - `loan.send_coupon_book_last_sent`
  - `loan.send_pmt_statement_last_sent`
  - `loan.send_late_notice_last_sent`
  - `loan.send_balloon_notice_last_sent`
  - `loan_terms.adj_final_payment_amount`
  - `loan_terms.adj_final_payment_months` (sibling field; also missing — include for consistency since it sits next to the $ field and shares the same row)

Per memory rule: "Data persistence is strictly governed by field_dictionary entries; missing UI keys are skipped." → without dictionary rows, even a fully editable input cannot save or reload.

The standard editable date pattern already in this file is `TypableDateField` (`renderInlineDateField`, line 325). All other date fields on the page use it.

## Changes

### 1. Send block — make Last Sent fields editable (UI)
File: `src/components/deal/LoanTermsDetailsForm.tsx`

- Replace the call to `renderReadOnlyDateField(row.last, …)` at line 1077 with an editable date input using the existing `TypableDateField` component, sized to match the current `w-[110px]` slot so layout is unchanged:
  - `value={getValue(row.last) || ''}`
  - `onChange={(iso) => setValue(row.last, iso)}`
  - `disabled={disabled}` (form-level disable only — no internal disable)
  - `inputClassName="h-8 text-xs w-[110px]"`
- Wrap each in its own `DirtyFieldWrapper fieldKey={row.last}` (inside the existing checkbox wrapper or as a sibling) so the dirty tracker picks the date edit up.
- Keep `renderReadOnlyDateField` helper in place — still used by other read-only date fields elsewhere on the page. Do NOT touch `renderReadOnlyNumberRow` (NSF / 30-days Plus stay read-only as required).
- No layout, spacing, label, or checkbox changes.

### 2. Penalties — verify the $ field renders correctly (UI)
File: `src/components/deal/LoanTermsDetailsForm.tsx`, lines 1189–1203

- No code change required to the JSX — it's already correctly wired to `handleCurrencyChange`/`handleCurrencyBlur` and matches every other `$` input on the page (same pattern as line 754).
- The reason it appears "not accepting input" is purely the missing dictionary entry (see below): values written via `setValue` are dropped before they reach storage, so the displayed `formatCurrencyDisplay(getValue(...))` always re-reads as empty after blur.

### 3. Database — register the 5 keys in `field_dictionary` (migration)

Insert rows for:

| field_key | section | data_type | label |
|---|---|---|---|
| `loan.send_coupon_book_last_sent` | `loan_terms` | `date` | Coupon Book Last Sent |
| `loan.send_pmt_statement_last_sent` | `loan_terms` | `date` | Payment Statement Last Sent |
| `loan.send_late_notice_last_sent` | `loan_terms` | `date` | Late Notice Last Sent |
| `loan.send_balloon_notice_last_sent` | `loan_terms` | `date` | Balloon / DIF Notice Last Sent |
| `loan_terms.adj_final_payment_amount` | `loan_terms` | `currency` | Borrower must then make principal and interest payments of |
| `loan_terms.adj_final_payment_months` | `loan_terms` | `number` | Remaining months (final payment) |

(Section name and enum values will be matched to the existing rows for sibling `loan.send_*` checkboxes already in `field_dictionary` so behavior aligns.)

Idempotent `INSERT … ON CONFLICT (field_key) DO NOTHING` so re-running is safe.

## Out of scope

- No change to checkbox keys / behavior.
- No change to NSF Previous 12 Months or 30-days Plus (stay read-only).
- No change to label text anywhere.
- No restyle of existing inputs.

## Acceptance verification

1. Type a date into each of the 4 Send Last Sent fields → reload → value persists in MM/DD/YYYY.
2. Empty Send Last Sent fields show MM/DD/YYYY placeholder (TypableDateField default).
3. Checking/unchecking the Send checkboxes does not change the date value.
4. Type a dollar amount into "Borrower must then make principal and interest payments of" → blur formats with commas/2dp → reload re-displays the saved value.
5. NSF Previous 12 Months and 30-days Plus remain disabled.

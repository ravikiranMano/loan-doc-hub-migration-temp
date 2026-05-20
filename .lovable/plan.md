## Plan: populate `{{ld_fd_fundingAmount}}` in generated documents

### Problem

The merge tag `{{ld_fd_fundingAmount}}` (Lender → Funding → Funding Amount) renders empty in generated documents for deals like `DL-2026-0250`, even though the UI shows a funding record with a valid Original/Funding Amount.

### Root cause

In `supabase/functions/generate-document/index.ts` (lines 2452–2462), the existing bridge for `ld_fd_fundingAmount` only looks at three keys:

- `lender.funding.amount`
- `ln_p_loanAmount`
- `loan_terms.loan_amount`

None of these are persisted for this deal. The actual lender funding amount lives inside the funding records array stored under `loan_terms.funding_records` (also mirrored as `ln_p_fundingRecord`), where each record has an `originalAmount` field — exactly the same source the neighboring `ld_fd_baseFee` bridge (lines 2498–2527) already reads to compute its sum.

Verified for DL-2026-0250: `funding_records[0].originalAmount = 100000`, but `ld_fd_fundingAmount` is unset, so the merge tag resolves to empty.

### Fix (scoped, generation-only)

Edit only `supabase/functions/generate-document/index.ts`. Update the `ld_fd_fundingAmount` bridge (lines 2452–2462) to:

1. Keep the existing no-overwrite guard — only populate when `ld_fd_fundingAmount` is empty.
2. New resolution order (first non-empty wins):
   a. `lender.funding.amount` (existing)
   b. **NEW**: sum of `originalAmount` across `loan_terms.funding_records` / `ln_p_fundingRecord` (parse JSON the same way the `ld_fd_baseFee` bridge already does)
   c. `ln_p_originalAmount` (newly added — this is the canonical Loan Terms → Original Amount that is already bridged earlier in the same function)
   d. `ln_p_loanAmount` / `loan_terms.loan_amount` (existing fallback)
3. Store as `{ rawValue: String(value), dataType: "currency" }` so existing currency formatting handles it.
4. Add a debugLog line matching the existing style.

No changes to:
- UI, form bindings, save flow, validations, calculations, session handling
- Database schema, RLS, APIs
- Template files or document layout
- Any other bridge, alias, or per-property logic
- `ld_fd_baseFee` and other neighbouring bridges

### Validation

- Deploy only `generate-document`.
- Regenerate a document for `DL-2026-0250` and confirm `{{ld_fd_fundingAmount}}` renders `$100,000.00`.
- Confirm `ld_fd_baseFee`, `ln_p_originalAmount`, `ln_p_loanAmountDivByEstimateValue`, and the RE851D appraiser logic are unaffected.

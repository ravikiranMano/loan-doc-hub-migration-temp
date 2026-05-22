# Loan → Terms & Balance: Funding Holdback fix

## Scope (only these two things)

1. UI sizing: make the Funding Holdback amount input the same width as the input above (Impounded Payments) and the Held By select below it.
2. Persistence: registered the 4 Funding Holdback field keys in `field_dictionary` so the existing save flow actually stores their values. No new tables, no schema change, no API change.

## What is happening today

- `LoanTermsBalancesForm.tsx` renders the Funding Holdback `$` input inside a narrow `w-[110px]` wrapper while the surrounding rows (Prepaid Payments, Impounded Payments, Held By select) use `flex-1` / `w-full`. Visually inconsistent.
- The form already calls `setValue` / `handleCurrencyChange` for:
  - `loan_terms.funding_holdback_enabled`
  - `loan_terms.funding_holdback_amount`
  - `loan_terms.funding_holdback_held_by`
- `field_dictionary` currently contains **zero** rows for `loan_terms.funding_holdback*` (verified via SQL). Per the project's persistence rule (only keys registered in `field_dictionary` are written through `deal_section_values`), every Funding Holdback edit is silently dropped on save — which is why the value disappears after reload.

## Changes

### 1. UI — `src/components/deal/LoanTermsBalancesForm.tsx` (Funding Holdback block, ~lines 515–527 only)

- Replace the `w-[110px]` wrapper around the amount input with `flex-1` (or `w-full`) so the input stretches to the same width as the Impounded Payments input above and the Held By select below.
- Keep `$` icon, currency formatting, focus/blur handlers, disabled state, and all other markup untouched.

No other UI, layout, label, ordering, or component change.

### 2. Persistence — register the 4 dictionary entries (data insert, not schema change)

Insert into existing `field_dictionary` table the following rows (idempotent `ON CONFLICT (field_key) DO NOTHING`):

| field_key | label | section | data_type |
|---|---|---|---|
| `loan_terms.funding_holdback_enabled` | Funding Holdback Enabled | loan_terms | boolean |
| `loan_terms.funding_holdback_amount` | Funding Holdback Amount | loan_terms | currency |
| `loan_terms.funding_holdback_held_by` | Funding Holdback Held By | loan_terms | text |
| `loan_terms.funding_holdback` | Funding Holdback | loan_terms | text |

This unblocks the existing `useDealFields` / `deal_section_values` save+load pipeline already used by every other Loan Terms field — no new save logic, no new API.

## Out of scope (explicitly not touched)

- No other field, label, ordering, or section.
- No change to `fieldKeyMap.ts`, `legacyKeyMap.ts`, save/load hooks, RLS, or APIs.
- No document-generation or merge-tag changes.
- No schema migration; only `field_dictionary` row inserts.

## Verification

1. Reload the form → Funding Holdback `$` input visually matches Impounded Payments input width and Held By select width.
2. Enter checkbox + amount + Held By value → Save → reload page → all three values still populated.

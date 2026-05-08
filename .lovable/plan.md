## Scope
Remove the **Tax ID Type**, **TIN**, and **TIN Verified** fields from the Lender forms under CONTACTS and from the Add Lender modal. UI-only removal. No backend, no schema, no API changes — existing save/update flow continues unchanged (omitted fields simply stop being written; previously stored values remain in `contacts.contact_data` untouched).

## Files & Exact Changes

### 1. `src/components/contacts/CreateContactModal.tsx` (Add Lender modal)
Lines 534–565 — the entire "Tax Info" section in the lender column 1:
- Remove the `<h3>Tax Info</h3>` header
- Remove **Tax ID Type** label + Select + error line
- Remove **TIN** label + Input (with SSN/EIN formatting) + error line
- Remove **TIN Verified** checkbox (`renderCheckbox('TIN Verified', 'tin_verified')`)

Result: the Tax Info subsection disappears completely; surrounding sections (DOB above, Primary Address column to the right) are unchanged.

### 2. `src/components/contacts/ContactLenderDetailForm.tsx` (Lender contact detail edit form)
Lines 185–189 — in the "Financial / Compliance" section:
- Remove the **TIN** label + Input grid cell
- Remove the adjacent empty `<div />` spacer (since the grid no longer needs it)

ACH / Send 1099 / Agreement on File checkboxes remain. (`Tax ID Type` and `TIN Verified` are already not present in this form.)

### 3. `src/components/contacts/lender-detail/LenderTaxReporting.tsx` (Tax Reporting sub-tab)
- Remove the **TIN Number + TIN Type** two-column block (lines 169–206)
- Remove the **TIN Verified** checkbox block (lines 208–217)
- Remove now-unused imports/helpers tied solely to those fields:
  - `formatTIN`, `maskTIN`, `validateTIN`, `stripTINInput` from `@/lib/tinValidation`
  - The `tinNumber`, `tinType`, `tinVerified`, `mappedTinKind`, `tinFocused`, `tinTouched`, `tinError`, `tinDisplay`, `handleTinChange` locals and related `useState`/`useMemo` hooks
  - Remove `tinNumber`, `tinType`, `tinVerified` keys from the `K` constant
- Keep: Designated Recipient, Issue 1099 (auto-populate logic intact), Alternate Reporting, Notes — and all entity-type / 1099 derivation logic.

## Out of Scope (left untouched per minimal-change policy)
- `src/components/contacts/lender-detail/Lender1099.tsx` — the IRS 1099 form has its own legally-required TIN/TIN Type fields and is a separate feature ([1099 Reporting memory](mem://features/contacts/1099-reporting-system)). Not removed.
- `src/components/deal/LenderTaxInfoForm.tsx` — deal-level (not under "Contacts > Lender").
- `src/components/contacts/lender-detail/LenderDashboard.tsx` — read-only display panel, not a form. TIN value continues to display when present.
- `src/pages/contacts/ContactLendersPage.tsx` grid columns (`tax_id_type`, `tax_id`, `tin_verified`) — already `visible: false`, no UI impact.
- Database schema, save/update APIs, field_dictionary entries — all unchanged. Persisted values for these keys remain in JSONB but are no longer written or read by these forms.

## Validation
- Add Lender modal opens with no Tax Info subsection.
- Lender detail "Financial / Compliance" section shows only ACH / Send 1099 / Agreement on File.
- Lender detail "Tax Reporting" sub-tab shows only Designated Recipient, Issue 1099, Alternate Reporting, Notes.
- Saving a lender works without errors (no required-field regressions because none of the three were required at the API layer).
- 1099 form continues to function unchanged.
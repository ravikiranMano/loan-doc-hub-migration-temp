## Goal

In **CONTACTS → Authorized Party**, when a row is opened, the **Borrower** sidebar tab currently renders `BorrowerPrimaryForm` (full borrower profile). Replace it (only in the Authorized Parties context) with the existing `BorrowerAuthorizedPartyForm`, whose 4-column layout (Name / Address / Phone / Preferred + Delivery / Send / Details / FORD) already matches the attached screenshot 1:1.

No schema, API, sidebar, navigation, or other tab is changed. Persistence continues to use the existing `borrower.authorized_party.*` keys via the same `onSave` flow already wired in `ContactAuthorizedPartiesPage` (which already mirrors prefixed keys to canonical via `mirrorPrefixedToCanonical`).

## Changes (minimal, scoped)

### 1. `src/components/contacts/borrower-detail/ContactBorrowerDetailLayout.tsx`
- Add a new optional prop `borrowerSectionVariant?: 'primary' | 'authorized_party'` (default `'primary'`).
- In `renderContent()` `case 'borrower':`, if `borrowerSectionVariant === 'authorized_party'`, render `<BorrowerAuthorizedPartyForm … />` (already imported at line 10) using the existing `values` / `handleValueChange` / `isReadOnly` props. Otherwise keep current `BorrowerPrimaryForm`.
- No other case, save logic, dirty tracking, or sidebar entry is touched.

### 2. `src/pages/contacts/ContactAuthorizedPartiesPage.tsx`
- In `<ContactBorrowerDetailLayout … />` (line 82), pass `borrowerSectionVariant="authorized_party"`.
- Nothing else changes — `handleSave` already hydrates + mirrors `borrower.authorized_party.*` keys, so persistence keeps working through the existing update API.

## What is NOT changed
- `BorrowerAuthorizedPartyForm` itself — already matches the screenshot.
- Field keys / `BORROWER_AUTHORIZED_PARTY_KEYS` / `fieldKeyMap.ts`.
- `useContactsCrud`, `updateContact`, `mirrorPrefixedToCanonical`, `hydratePrefixedFromCanonical`.
- Sidebar items, sub-nav, routing, grid columns, filters, RLS, DB schema.
- Borrowers page, Co-Borrowers page, Additional Guarantors page (they continue to use `BorrowerPrimaryForm` on the Borrower tab).

## Verification
1. Open CONTACTS → Authorized Parties → click a row → "Borrower" tab now shows the screenshot layout (Name/Address/Phone/Preferred header row + Delivery Options/Send/Details/FORD bottom row).
2. Edit Capacity, First/Middle/Last, Address, Phones, Preferred radio, Delivery checkboxes, Send checkboxes, Details textarea, and the 6 FORD inputs → click Save → reload row → values persist (stored under `borrower.authorized_party.*` and mirrored to canonical top-level fields for the grid).
3. Borrowers page and Additional Guarantors page Borrower tab unchanged.

## Goal

In the Contacts area, display the "Agreement on File" date in `MM/DD/YYYY` format wherever it appears, persist the value through the existing save/update API, and have the saved value populate back into the form after save. No schema/API changes.

## Current State

- The only editable Agreement on File date input lives in `src/components/contacts/CreateContactModal.tsx` (line 564–569, Broker form), implemented as a native `<Input type="date" />`. Native date inputs always render in the browser locale (often `YYYY-MM-DD`), not `MM/DD/YYYY`.
- Storage uses key `agreement_on_file_date` inside `contact_data` JSONB, persisted via the existing `useContactsCrud` create/update path. No backend changes needed.
- The detail forms (Borrower / Lender / Broker) currently only render the Agreement checkbox, not the date — so nothing to change there for this request.
- Grid columns (`ContactBrokersPage`, `ContactBorrowersPage`, `ContactLendersPage`) read `agreement_on_file_date` (broker) / `servicing_agreement_on_file_date` (lender) and display whatever raw string is in `contact_data` — currently `YYYY-MM-DD`.

## Change (single file: `src/components/contacts/CreateContactModal.tsx`)

Replace the native `<Input type="date">` at lines 564–569 with the standard `EnhancedCalendar` popover pattern already used elsewhere in the project (per the `mem://ui/forms/enhanced-calendar-standard` and `mem://ui/forms/standard-date-display-format` memories):

- Trigger button shows the value formatted as `MM/DD/YYYY` (or placeholder when empty), using `format(parseDateOnly(value), 'MM/dd/yyyy')` from `@/lib/dateOnly` + `date-fns`.
- Popover contains `EnhancedCalendar`; selection writes back to state via `set('agreement_on_file_date', formatDateOnly(date, 'yyyy-MM-dd'))` so the backend value stays the canonical `yyyy-MM-dd` string and existing save/update APIs continue to work unchanged.
- Keep the existing checkbox + label layout, width classes, and height (`h-7 text-xs flex-1`) so the surrounding UI is untouched.

## Grid display

In the three grid pages where `agreement_on_file_date` / `servicing_agreement_on_file_date` columns are rendered, format the cell value with `parseDateOnly(...) → format(..., 'MM/dd/yyyy')` so the saved value populates back as `MM/DD/YYYY`. Files:
- `src/pages/contacts/ContactBrokersPage.tsx` (column `agreement_on_file_date`)
- `src/pages/contacts/ContactBorrowersPage.tsx` (column `agreement_on_file_date`)
- `src/pages/contacts/ContactLendersPage.tsx` (column `servicing_agreement_on_file_date`)

Only the render formatter is touched — column id, label, visibility, sorting, and filter logic stay as-is.

## Persistence

No new state, hook, table, or endpoint. Save flows through the existing `useContactsCrud` mutation that already writes `agreement_on_file_date` into `contact_data`. After save, the modal closes and the grid/detail re-renders the saved value (now formatted via the grid formatter above).

## Out of Scope

- Detail forms (Borrower / Lender / Broker) are not modified — they don't currently expose this date field.
- No changes to `field_dictionary`, RLS, edge functions, document generation, or any other module.
- No changes to other date inputs (e.g. `date_authorized` on line 790) — only the Agreement on File date per the request.

## Verification

1. Open Create Contact → Broker, click Agreement on File date → calendar opens, pick a date → trigger displays `MM/DD/YYYY`.
2. Save the contact → modal closes, broker grid row shows the date as `MM/DD/YYYY`.
3. Reopen the broker (refresh) → value still present and `MM/DD/YYYY` formatted.
4. Borrower and Lender grids show their respective agreement dates in `MM/DD/YYYY` when present.

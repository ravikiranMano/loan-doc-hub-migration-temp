## Scope
CONTACTS → Lender. Two narrow UI changes only. No schema, no API, no business-logic changes.

## 1. Align DOB input in Lender Info

File: `src/components/deal/LenderInfoForm.tsx` (DOB block, ~line 332–359)

Today the DOB date-picker `Button` is wrapped directly in `<Popover><PopoverTrigger asChild>`, which does not pick up `flex-1` from the parent flex row. Email above it uses `EmailInput`, which internally renders `<div className="flex flex-col flex-1">`, so its input fills the column.

Change: wrap the DOB `Popover` in a `<div className="flex flex-col flex-1">` (same shape as `EmailInput`) so the date button stretches to match the Email field width and right-edge alignment under the 120px label. No other DOB behavior, validation, or value handling changes.

## 2. Add DOB to "Add Lender" modal (Create New Contact Lender)

File: `src/components/contacts/ContactLenderModal.tsx`

Add a DOB field next to Email, matching the Lender Info pattern:
- New `dob: ''` in `emptyForm()` and in the `ContactLender` form shape used by the modal (string, MM/DD/YYYY).
- New row in the existing 2-column "Contact" grid: `Label "DOB"` + `Popover` + `EnhancedCalendar`, mirroring the Lender Info DOB control (same icon, same placeholder `mm/dd/yyyy`, same clear/today actions).
- Future dates blocked (consistent with `CreateContactModal` DOB validation).
- Persist via the existing `onSubmit` payload — no new endpoint, no schema work. The value flows through the same `ContactLender` save path used today; downstream consumers that already read `dob` (Lender Info form) will pick it up. No DB migration.

Type update:
- File: `src/pages/contacts/ContactLendersPage.tsx` — add optional `dob?: string` to the `ContactLender` interface so the modal payload type-checks. No grid column changes (DOB column visibility already exists at line 53 and stays default-hidden).

## Out of scope
- No changes to Lender Info layout, fields, or save APIs beyond the DOB wrapper div.
- No mirroring of the full 4-column Lender Info form into the modal (Status, Capacity, Mailing, FORD, Vesting, 1099 etc. remain only in Lender Info).
- No changes to `LenderDashboard`, sub-nav, or any other lender screens.
- No DB schema, RLS, or edge function changes.

## Validation
- Visually confirm in preview that the DOB picker right-edge aligns with the Email input under the same 120px label column in Lender Info.
- Open Add Lender modal → set DOB → Create → reopen the new lender → DOB shows on Lender Info.

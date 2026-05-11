## Goal
Make the "Select" placeholder option always available in every State dropdown so users can re-select it to clear the value, consistent with the existing pattern already used in PropertyDetailsForm, LenderInfoForm, BrokerInfoForm, etc.

## Current state
Most State dropdowns already render a leading `<SelectItem value="__select__">Select</SelectItem>` and translate `"__select__"` back to empty string on change (see `PropertyDetailsForm.tsx`, `LenderInfoForm.tsx`, `BrokerInfoForm.tsx`, `InsuranceDetailForm.tsx`, `OriginationEscrowTitleForm.tsx`, `OriginationServicingForm.tsx`, `OriginationPropertyForm.tsx`, `LoanTermsServicingForm.tsx`, `BrokerModal.tsx`, `InsuranceModal.tsx`, `LenderAuthorizedPartyForm.tsx`).

The dropdowns missing this pattern (where "Select" disappears once a state is chosen) are:

1. `src/components/contacts/CreateContactModal.tsx` — 4 State Selects (lines ~590, ~624, ~826, ~852)
2. `src/components/contacts/ContactLenderDetailForm.tsx` — 2 State Selects (lines ~219, ~269)
3. `src/components/contacts/lender-detail/Lender1099.tsx` — 1 State Select (line ~185)
4. `src/components/contacts/broker-detail/Broker1099.tsx` — 1 State Select (line ~200)

## Changes
For each Select listed above:
- Prepend `<SelectItem value="__select__">Select</SelectItem>` inside `SelectContent` (above the `US_STATES.map(...)`).
- Wrap the existing `onValueChange` so `"__select__"` is normalized to `""` (empty string) before being passed to the existing setter / `onValueChange` handler.
- Leave `value` binding, placeholder text, and surrounding layout exactly as-is.

No changes to:
- The existing translation/persistence logic — the empty string is already the cleared value used by current save/update APIs.
- `DealsPage.tsx`, admin pages (`PacketManagementPage.tsx`, `TemplateManagementPage.tsx`) — those are filter/search controls (not data-entry State dropdowns) and out of scope.
- Database schema, RLS, APIs, document generation, or any other UI/component.

## Verification
- Open Create Contact modal → pick a state → reopen the dropdown → confirm "Select" still appears at top and choosing it clears the value.
- Repeat for Contact → Lender Detail (mailing + 1099 addresses), Lender 1099, Broker 1099.
- Save the form → reload → confirm cleared state remains empty (using existing save APIs, no schema change).

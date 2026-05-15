## Goal
Remove the read-only **Current Principal Bal.** display row from the Valuation column in Property Details.

## What to change
In `src/components/deal/PropertyDetailsForm.tsx` (lines 599–615), delete the block that renders the read-only "Current Principal Bal." field and its associated negative-balance error message.

## What stays
- The `currentPrincipalBalance` state and `loan_history` fetch logic remain — it still drives the **Current LTV** calculation.
- The `currentBalanceInvalid` flag logic stays (guards the calc), but the inline error message under the removed row can also be removed since there is no field to anchor it to.

## Out of scope
No other UI or calculation changes.
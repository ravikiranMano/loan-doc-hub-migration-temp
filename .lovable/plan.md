## Goal
Align the existing **Tax Reporting** card (used across Lender, Borrower, Co-borrower, Broker 1099 left-nav screens) with the attached screenshot — same UI and functionality everywhere.

## Scope
File: `src/components/contacts/shared/TaxReportingCard.tsx` (single reusable component already wired to all 4 screens — no layout files need changes).

## UI changes to match screenshot

1. **Header** → rename `Tax Reporting` to `Tax reporting`.
2. **Add entity-type dropdown** as the first row inside the card:
   - Label is party-aware: `Lender type` / `Borrower type` / `Co-borrower type` / `Broker type`.
   - Bound to the existing `{prefix}type` field (same source already used for Issue 1099 auto-population) — read/write via `onValueChange`, no new keys, no schema changes.
   - Options: existing entity-type list (`Individual`, `Joint`, `Family Trust`, `LLC`, `Investment Fund`, `C Corp / S Corp`, `IRA / ERISA`, `401K`, `Foreign Holder W-8`, `Non-profit`).
   - Editing this field continues to drive the Issue 1099 auto-default (already implemented).
3. **Field labels** → lowercase second word per screenshot: `Designated recipient`, `Issue 1099`, `TIN number`, `TIN type`, `W-9 on file`, `TIN verified`, `Alternate reporting`, `Notes`.
4. **TIN number input** → add placeholder `XX-XXXXXXXX`.
5. **W-9 on file row** → remove the duplicated `X  W-9 on File` secondary label next to the checkbox (screenshot shows just checkbox + single label on the left).
6. **Layout** → keep the existing label-left / input-right two-column grid, full-width Notes textarea at the bottom, bordered Card container (already matches).

## Functionality (unchanged)
- Same persistence keys `{prefix}tax_info.*` via existing save/update API.
- Issue 1099 auto-population + manual-override flag preserved exactly.
- No new tables, no schema changes, no new APIs.
- All 4 screens (Lender / Borrower / Co-borrower / Broker) automatically inherit the updated UI because they already render `TaxReportingCard`.

## Out of scope
- No changes to layouts, sidebars, save/load logic, or any other component.
- No changes to deal-side `LenderTaxInfoForm` (different module).

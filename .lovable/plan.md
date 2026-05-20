## Issue

`{{br_p_vesting}}` does not populate in generated documents even though the Borrower's Vesting field contains data in CSR → Contact → Borrower.

## Root Cause

There are TWO storage paths for borrower vesting, and the template tag the user wrote (`{{br_p_vesting}}`, full) only lines up with one of them:

1. **CSR Contact value** (`contacts.contact_data.vesting`)
   - Published by `injectContact` in `supabase/functions/generate-document/index.ts` (line ~696) as `br_p_vesting` (full) and `borrower.vesting` / `borrower1.vesting`.
   - Only runs if the borrower contact is a resolved deal participant.

2. **Deal-section value** (`deal_section_values`, UI key `borrower.vesting`)
   - Field dictionary canonical key is `br_p_vestin` (truncated — see `src/lib/legacyKeyMap.ts:58`: `'borrower.vesting' → 'br_p_vestin'`).
   - Loaded into `fieldValues` as `br_p_vestin` only — never mirrored to `br_p_vesting`.

The tag resolver (`resolveFieldKeyWithBackwardCompat` in `supabase/functions/_shared/field-resolver.ts`) does NOT collapse `br_p_vesting` → `br_p_vestin` because:
- `br_p_vesting` is not a `validFieldKey` (dictionary stores `br_p_vestin`)
- It is not in `field_key_migrations` or `canonical_key` maps
- Trailing-underscore stripping (line 211) does not strip a trailing letter

So `{{br_p_vesting}}` only resolves when `injectContact` ran AND `contact_data.vesting` is non-empty. In every other scenario (deal-only vesting, contact missing the field, contact not in participants for this generation) the tag stays blank.

The lender side already has the equivalent bridge at lines 4948–4952 (`ld_p_vesting` ↔ `ld_p_vestin`); borrower has no such bridge.

## Fix

Add a small, additive borrower-vesting bridge in `supabase/functions/generate-document/index.ts`, right after the existing `br_p_fullName` bridge block (around line 3010), modeled exactly on the existing reverse-bridge pattern used there. **No publisher rewrite, no schema change, no UI change, no removal of any existing logic.**

The bridge resolves the vesting value once by checking, in order:
1. `br_p_vesting` (already published by `injectContact` from contact_data)
2. `br_p_vestin` (the truncated dictionary key, populated by deal_section_values)
3. `borrower.vesting`
4. `borrower1.vesting`

The first non-empty value is then mirrored, **only when the target key is missing or empty** (using the same `setIfEmpty`-style guard already used by the `br_p_fullName` bridge), into all four aliases:
- `br_p_vesting`
- `br_p_vestin`
- `borrower.vesting`
- `borrower1.vesting`

This guarantees `{{br_p_vesting}}`, `{{br_p_vestin}}`, `{{borrower.vesting}}`, and `{{borrower1.vesting}}` all render the same value, regardless of which path supplied it.

## Files Changed

- `supabase/functions/generate-document/index.ts` — add ~15 lines after the existing `br_p_fullName` reverse-bridge block (~line 3010). No other file is touched.

## What Stays Untouched

- Field dictionary / canonical keys (`br_p_vestin` stays the canonical dictionary key)
- `src/lib/legacyKeyMap.ts` mapping
- `injectContact`, deal-section value loaders, `tag-parser.ts`, `field-resolver.ts`
- Lender vesting pipeline (lines 856–869, 4934–4952)
- Co-borrower / guarantor vesting sync logic in `BorrowerSectionContent.tsx`
- Document templates and any other tag

## Verification

1. Generate the user-uploaded `Assignment_of_Rents_and_Profits_Agreement_With_Field_Codes.docx` for a deal where borrower B-00053 (Sunset Equity Holdings LLC, `contact_data.vesting = "4"`) is the primary borrower. `{{br_p_vesting}}` should render `4`.
2. Repeat with a deal where vesting was edited only in the deal's Borrower section (not on the contact). `{{br_p_vesting}}` must still render the value.
3. Regression: confirm `{{br_p_vestin}}`, `{{borrower.vesting}}`, and `{{borrower1.vesting}}` still render correctly on existing templates that use those forms (e.g., legacy templates).

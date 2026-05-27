## Goal

For the 14 named templates, ensure the document generator emits **only primary (Lender 1) data** — no `lender_2_*`, `lender_3_*`, `lendersN.*` (N>1), `additionalLenders*.*`, `lender_count > 1`, or `has_multiple_lenders = true` aliases. The existing post-render signature-append exclusion stays as a second safety net.

## Scope

Single file: `supabase/functions/generate-document/index.ts`.

No changes to:
- Database schema, field_dictionary, merge_tag_aliases
- UI, deal data, participants, lender records
- Borrower / broker / property / loan publishing
- Other templates (multi-lender continues to work everywhere else)

## Technical changes

### 1. Reuse the existing exclusion list as a single source of truth

The `LENDER_APPEND_EXCLUDED: RegExp[]` array currently lives inside the signature-append block (~line 7838). Hoist it to module scope as `MULTI_LENDER_DISABLED_TEMPLATES` and add a helper `isMultiLenderDisabled(templateName: string): boolean`. Signature-append block keeps calling the same helper (no behavior change there).

The 14 patterns already cover: Agency Disclosure CA DRE, Assignment of Rents, Borrower Certification of Facts, Borrower Certification of Loan Purpose, Continuing Authorization for Release of Information, Declaration of Oral Disclosure, hazardous, Limited Power of Attorney to Correct Documents, Mortgage_Broker_Agency_Disclosure, Personal Guaranty by Third Party, re851a, RE851D, Re885, Servicing Fee Paid by Borrower Addendum.

### 2. Cap the lender publisher loop at 1 for these templates

In the indexed lender alias publisher (~lines 1229–1351 in `index.ts`) — the block that iterates lenders and calls `setAlias` for `lender_N_*`, `lendersN.*`, and `additionalLenders${a}.*`:

- Compute `const multiLenderDisabled = isMultiLenderDisabled(tName)` once before the loop (template name is already in scope as `tName` / `templateName` — verify exact variable in that scope while editing).
- If `multiLenderDisabled`:
  - Iterate only the primary lender (index 1). Skip publishing any `lender_2_*`, `lender_3_*`, `lenders2.*`, `lenders3.*`, etc.
  - Skip the entire `additionalLenders${a}.*` block (it only fires for a ≥ 2 anyway, so this is naturally suppressed when the loop is capped).
  - Force `setAlias("lender_count", "1")`.
  - Force `setAlias("has_multiple_lenders", "false")`.
  - Force `setAlias("additional_lender_count", "0")`.
  - Log: `[generate-document] template=${tName} MULTI_LENDER_DISABLED — published lender 1 only`.
- Otherwise: existing behavior unchanged.

### 3. Keep the signature-append guard

The existing `LENDER_APPEND_EXCLUDED` check at ~line 7856 already short-circuits the per-lender XML cloner. Leave intact (using the hoisted constant) as defense-in-depth, even though step 2 already prevents `lender_count` from exceeding 1 for these templates.

### 4. Nothing else changes

- `{{lender1.*}}` / `{{ld_p_*}}` / `{{ld_fd_*}}` primary aliases continue to be published.
- Borrower, broker, property, loan terms publishers are untouched.
- Templates that contain `{{#each lenders}}` will simply iterate a 1-element collection.
- For other templates not in the exclusion list, multi-lender publishing and appending continue to work exactly as today.

## Verification

1. Deploy `generate-document`.
2. On a deal with 3 lenders, generate one excluded template (e.g., **re851a**) and one non-excluded template (e.g., a multi-lender note). Confirm:
   - Excluded template: only Lender 1 appears; logs show `MULTI_LENDER_DISABLED`.
   - Non-excluded template: all 3 lenders render as before.
3. On a single-lender deal, regenerate one excluded template to confirm no regression.

## Out of scope

- Removing `{{#each lenders}}` literals from template DOCX files — not required; the loop will just render once.
- Refactoring the alias publisher beyond the cap-at-1 branch.
- Any UI, schema, or admin changes.

# Fix: `{{br_p_emailAddres}}` and `{{br_p_homePhone}}` not populating in "Borrower TCPA and E-Consent"

## Findings

- Template `Borrower TCPA and E-Consent.wbk` contains two clean merge tags inside single text runs:
  - `{{br_p_emailAddres}}` → maps to field_dictionary `br_p_emailAddres` (label "Email Address", section `borrower`)
  - `{{br_p_homePhone}}` → maps to field_dictionary `br_p_homePhone` (label "Home Phone", section `borrower`)
- In `deal_section_values` the values are actually persisted under multi-borrower **composite keys** with an `indexed_key`:
  - `borrower1::63f87fd8-…` → `indexed_key: "borrower1.email"`
  - `borrower1::4a5935ca-…` → `indexed_key: "borrower1.phone.home"`
- In `supabase/functions/generate-document/index.ts` (≈ lines 448-491) the loader sets `fieldValues["borrower1.email"]` / `"borrower1.phone.home"` (from `indexed_key`) and then the indexed→non-indexed bridge produces `"borrower.email"` / `"borrower.phone.home"` — but nothing publishes the canonical **field_dictionary** keys (`br_p_emailAddres`, `br_p_homePhone`) reliably for every deal, so the bare TCPA tags resolve to blank.
- Other identical-pattern tags (e.g. `br_p_firstName`) are populated only because they have explicit publishers elsewhere; email / home phone have none (`rg` for `br_p_email|br_p_homePhone` in `supabase/functions` returns nothing).

## Fix

Add a small alias publisher in `supabase/functions/generate-document/index.ts`, in the same block where other `br_p_*` bridges live (right after the indexed→non-indexed bridge near line 1491), that copies the resolved borrower value into the canonical field_dictionary keys when those keys are empty.

Pseudocode:

```text
publishBrAlias("br_p_emailAddres", [
  "br_p_emailAddres",
  "borrower1.email",
  "borrower.email",
]);

publishBrAlias("br_p_homePhone", [
  "br_p_homePhone",
  "borrower1.phone.home",
  "borrower.phone.home",
]);

// Optional safety net — same pattern, keeps existing behavior unchanged:
publishBrAlias("br_p_workPhone", [
  "br_p_workPhone",
  "borrower1.phone.work",
  "borrower.phone.work",
]);
```

`publishBrAlias(target, sources)` walks the sources in order, takes the first non-empty `rawValue`, and writes it into `fieldValues` under the `target` key with `dataType: "text"` **only if `target` is currently empty**. This is the same defensive pattern already used for `ln_p_loanNumber` (≈ lines 1519-1546) and matches the project's existing minimal-change publisher convention.

No template edits, no DB migration, no schema change. Backward compatible: existing `borrower.email` / `borrower1.email` consumers continue to resolve unchanged.

## Verification

1. Redeploy `generate-document`.
2. Generate "Borrower TCPA and E-Consent" against a deal where `borrower1.email` and `borrower1.phone.home` are set (e.g. `7d77727b-e686-4f62-a9c4-d0ba01c55069` — values `sabir@yopmail.com` / `988125544`, or `d697d055-…` — `rajesh.kumar@example.com` / `214-555-7890`).
3. Open the generated `.docx`, confirm the Email and Home Phone cells now show the borrower values.
4. Regression-check one prior template that already used `borrower.email` / `borrower1.email` to confirm nothing else changed.

## Files touched

- `supabase/functions/generate-document/index.ts` — add the 3-key publisher block (~15 lines, single location).

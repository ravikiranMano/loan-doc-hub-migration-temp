## Goal
Add a new calculated field in the field dictionary that computes `pr_li_lienCurrenBalanc - li_lt_existingPaydownAmount`, and surface its value in document generation (RE851D) via a merge tag.

## Changes

### 1. Database — `field_dictionary` (migration, INSERT)
Insert a new row:
- `field_key`: `pr_li_balanceAfterPaydown`
- `label`: `Balance After Paydown`
- `section`: `property`
- `data_type`: `currency`
- `is_calculated`: `true`
- `calculation_formula`: `{pr_li_lienCurrenBalanc} - {li_lt_existingPaydownAmount}`
- `calculation_dependencies`: `{pr_li_lienCurrenBalanc, li_lt_existingPaydownAmount}`
- `is_repeatable`: `false`
- `allowed_roles`: `{admin, csr}` (default), `read_only_roles`: `{}` (default)
- `description`: `Auto-calculated: Lien Current Balance minus Existing Paydown Amount`

The existing `calculationEngine.ts` already supports the `{a} - {b}` pattern (parser line 87, executor lines 184–193), so no engine changes are required. The hook `useDealFields.ts` (lines 783–814 + the saveDraft compute pass at 826–830) already runs calculated fields automatically and persists their results into `deal_section_values`, so the value will be written to storage on every save.

### 2. Database — `merge_tag_aliases` (INSERT)
Insert one row binding a Word merge tag to the new field:
- `tag_name`: `pr_li_balanceAfterPaydown`
- `field_key`: `pr_li_balanceAfterPaydown`
- `tag_type`: `merge_tag`
- `is_active`: `true`
- `description`: `Lien Current Balance minus Existing Paydown Amount`

Author the RE851D template tag as `{{pr_li_balanceAfterPaydown}}` (or the existing single-brace convention used in the template — I'll mirror whatever RE851D uses today).

### 3. No edge-function code changes
Document generation already resolves placeholder values via `merge_tag_aliases → field_key → deal_section_values`. Once the calculated field persists and the alias exists, the tag will populate automatically on the next generation. No edits to `supabase/functions/generate-document/index.ts` or the shared tag parser.

## Out of scope
- No UI form changes (calculated field is derived, not user-edited).
- No template binary edits — the user/admin places `{{pr_li_balanceAfterPaydown}}` in RE851D where they want it to appear.
- No changes to per-property/per-lien repeatable indexing (the source fields are non-repeatable in the dictionary).

## Open item
Confirm the merge-tag spelling you want in the Word template. Default proposed: `pr_li_balanceAfterPaydown`. If you want a different tag name (e.g. `pr_li_remainingAfterPaydown`), say so and I'll use that exact tag in `merge_tag_aliases`.
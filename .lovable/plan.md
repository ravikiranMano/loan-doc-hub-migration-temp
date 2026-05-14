## Problem

The merge tag `{{pr_p_descript}}` (Property Description) renders blank in **RE851A** generations even though CSR data is saved.

## Root cause

CSR `PropertyDetailsForm` saves the description under composite JSONB keys like `property1::<dict_id>` / `property2::<dict_id>` (verified in DB for the affected deal — values "Borrower Property", "Ronit Roy", …). On generation, the existing per-property publisher and `propertyN.<suffix>` bridging that turns those composite keys into a usable `pr_p_descript` / `pr_p_descript_N` value lives **inside** the `if (/851d/i.test(template.name))` block in `supabase/functions/generate-document/index.ts` (~line 1244).

For an **RE851A** template the publisher never runs, so:
- `pr_p_descript` may be set inconsistently (only when the property1 entry happens to have no `indexed_key`, depending on `forEach` order vs. property2/3 entries).
- `pr_p_descript_N` is never set at all (the `_N` rewrite block at line 4940 is also gated to RE851D / `isEncumbrancePipeline`).

Result: the tag resolves to empty.

## Fix (narrow, RE851A only)

Edit only `supabase/functions/generate-document/index.ts`. No schema, UI, or other template changes.

1. **Always publish `pr_p_descript` for the primary property in RE851A.**
   After the existing `fieldValues` build (around line 410, before the RE851D block), if the template name matches `/851a/i`, read the description value from the first available source in this order and write it to `pr_p_descript`:
   - `property1.description` (bridged value)
   - any `property{N}.description` where N is the lowest property index present
   - the bare canonical `description` field

2. **Also publish `pr_p_descript_1`** with the same value, so RE851A templates that author the tag as `{{pr_p_descript_1}}` (mirrors RE851D) also resolve.

3. **Do not touch** the RE851D publisher, the `_N` rewrite block, the anti-fallback shield list, or any other tag families. Behavior for RE851D and other templates stays bit-for-bit identical.

## Verification

- Regenerate the RE851A doc on deal `236b605e-967e-403d-b880-5004c15ccdd6` and confirm the Property Description block now prints "Borrower Property".
- Edge function logs should show one new line: `[RE851A] published pr_p_descript="Borrower Property" (source=property1.description)`.
- RE851D regression check: regenerate any RE851D doc and confirm `pr_p_descript_1..N` still match per-property values (publisher path unchanged).

## Out of scope

- No new database columns, dictionary entries, or UI changes.
- No changes to currency/percent formatting work done in earlier turns.
- No refactor of the existing publisher / shield / rewrite logic.

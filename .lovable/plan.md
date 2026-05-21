## Plan

1. **Rewrite the active RE870 Investor Questionnaire template structure**
   - Update the template DOCX XML so the `{{#each lenders}} ... {{/each}}` block wraps one full lender-specific RE870 form section.
   - Keep `BROKER ACKNOWLEDGEMENT` outside the loop so it renders once at the end.
   - Insert the lender-to-lender page break inside the loop using the existing Handlebars-style marker:
     ```text
     {{#unless @last}}<w:br w:type="page"/>{{/unless}}
     ```
   - Preserve all existing Word XML formatting/runs; only insert loop marker paragraphs/page-break XML at structural boundaries.

2. **Fix `tag-parser.ts` repeater expansion for RE870**
   - Extend `processEachBlocks` so `{{#each lenders}}` can clone a complete block of DOCX XML, not only a small paragraph/row region.
   - Add support for `@last` within each iteration so the page break appears between lender forms, not after the final lender.
   - Keep cloning at paragraph/table/body-child boundaries to avoid invalid DOCX XML.
   - Preserve existing generic repeater behavior for all other templates/collections.

3. **Fix lender conditional/name resolution**
   - Ensure each lender clone resolves against its own scoped keys: `lenders1.*`, `lenders2.*`, etc.
   - Treat `isIndividual` as true only when the lender type is exactly `Individual` after trimming.
   - For non-Individual lenders, set/display `displayName` and `INVESTOR NAME` from `vesting` only.
   - Never fall back to concatenating name fields for non-Individual lender display names, preventing outputs like `Lender Horizon Capital LLC` or duplicated name pieces.

4. **Remove/neutralize the old backend “improvised” additional-lender output for RE870**
   - Ensure the auto-append additional lender signature fallback does not run for RE870 when the template has a real `{{#each lenders}}` block.
   - Leave the fallback intact for non-RE870 backward compatibility.

5. **Validate with DL-2026-0266**
   - Generate a fresh RE870 Investor Questionnaire for the 4-lender deal.
   - Confirm the output has:
     - 4 complete lender forms
     - Correct lender-specific investor names
     - `NAME OF ENTITY` as vesting for non-Individual and `-` for Individual
     - Page breaks between lender forms
     - One shared `BROKER ACKNOWLEDGEMENT` at the end
     - No raw Handlebars tags
     - Unique `wp:docPr` IDs so Word opens the file cleanly

## Technical scope

Files expected to change:
- `supabase/functions/_shared/tag-parser.ts`
- `supabase/functions/generate-document/index.ts` only if needed for RE870-specific alias/fallback handling
- `supabase/functions/rewrite-re870-multi-lender/index.ts` or a one-shot template rewrite function to apply the corrected template XML safely

No database schema, UI, API contracts, permissions, document-generation order, or dependencies will be changed.
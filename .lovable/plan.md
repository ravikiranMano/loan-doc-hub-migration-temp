## Issue

The uploaded source template is valid and opens structurally: the ZIP archive and all XML parts pass validation. The corruption is happening after generation, not in the uploaded template.

The likely failure is in the guaranty post-render step: it injects `ag_p_fullName` into the `Guarantor:` signature line after the normal DOCX processor has already validated the file. That guaranty fallback currently relies on the same late-pass cache/flush machinery built for RE851D, so a generated guaranty DOCX can be marked successful even if the final uploaded package is not Word-openable.

## Plan

1. **Make guaranty signature population part of the safe DOCX pipeline**
   - Update `generate-document` so `Guarantor: {{ag_p_fullName}}` is resolved by the normal merge-tag renderer.
   - Remove or narrow the late guaranty XML injection fallback so it does not mutate an already-rendered DOCX unless absolutely necessary.

2. **Add final validation for all post-render mutated DOCX files**
   - Ensure any document that uses late XML passes, including guaranty templates, validates `word/document.xml`, headers, and footers immediately before upload.
   - If validation fails, generation should return an error instead of saving a corrupt `.docx` as “success”.

3. **Handle the split Word tag in this template**
   - The uploaded template stores the tag as separate Word runs: `{{` + `ag_p_fullName` + `}}` with proof/bookmark markup between them.
   - Keep/adjust the fragmented-tag normalization so it consolidates this into `{{ag_p_fullName}}` before replacement.

4. **Repair or supersede the bad generated file**
   - After code changes, regenerate `Personal Guaranty by Third Party` for the current deal.
   - Verify the regenerated DOCX archive and XML are valid, then confirm the `Guarantor:` line contains the Additional Guarantor name.

## Files to change

- `supabase/functions/generate-document/index.ts`
- Possibly `supabase/functions/_shared/tag-parser.ts` if the split `{{ ag_p_fullName }}` paragraph is not being consolidated before rendering.

## Validation

- Validate the uploaded template remains valid.
- Generate a new version for deal `504012b0-c5f8-46a4-91d7-95adac80cde9`.
- Inspect the generated DOCX XML and confirm it opens structurally before marking it fixed.
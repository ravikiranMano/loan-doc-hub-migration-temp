## Plan

1. **Normalize broken RE851D template text before rendering**
   - In the existing RE851D pre-render sanitization block in `supabase/functions/generate-document/index.ts`, add a small helper scoped to Word text runs that:
     - collapses multiline/split Handlebars expressions inside `{{ ... }}` into one-line expressions,
     - repairs malformed closes like `{{/if}` to `{{/if}}`,
     - repairs broken RE851D encumbrance field suffixes such as `_N_S`, `_(N)_(S)`, `(N)(S)`, and split `S)` variants,
     - keeps this limited to RE851D/document-template text and existing field families only.

2. **Replace the broken Balloon Payment row safely**
   - Add a targeted RE851D cleanup around `BALLOON PAYMENT?` rows so any broken/raw balloon Handlebars fragments are reduced to clean checkbox output without changing business logic.
   - Use the already-published boolean fields (`pr_li_rem_*` / `pr_li_ant_*`) and existing post-render winner logic to force exactly one of YES / NO / UNKNOWN.
   - Avoid inserting literal malformed expressions and avoid hardcoded `☒`.

3. **Clean the known corrupted phrase**
   - Add a narrow replacement for `Additional remaininARE TAXES DELINQUENT?g` to `Additional remaining, expected, or anticipated encumbrances...` during RE851D XML sanitization.

4. **Fix the actual integrity error shown in logs**
   - Recent backend logs show the current failure is:
     - `expected </w:p> before </w:sdtContent>`
     - context shows nested/duplicated checkbox SDT wrappers: `</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`.
   - Add a conservative final repair in `supabase/functions/_shared/docx-processor.ts` to unwrap/remove invalid nested checkbox SDT structure when it appears inside an outer SDT content block, preserving the visible checkbox glyph and surrounding runs.
   - Call that repair in the existing RE851D final flush before `validateContentXmlPart`.

5. **Add targeted regression coverage**
   - Add or extend a Deno test under `supabase/functions/_shared` that validates:
     - multiline Handlebars are normalized,
     - `{{/if}` is repaired/removed correctly,
     - broken balloon field keys normalize to usable keys,
     - nested SDT corruption no longer fails `validateContentXmlPart` after repair.

6. **Validate with the real function path**
   - Run the focused edge-function tests.
   - Deploy the changed backend functions.
   - Trigger or inspect `generate-document` for the RE851D template again and confirm no `word/document.xml` integrity failure appears in logs.
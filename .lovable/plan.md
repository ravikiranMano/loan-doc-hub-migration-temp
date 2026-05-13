## Plan: stabilize RE851D document generation

### What I found
- The uploaded `RE851D-V12.1-4.docx` starts XML-balanced, but it contains malformed dynamic expressions that can break paragraph/run boundaries during generation.
- Concrete template issues present in `word/document.xml` include:
  - Unsupported encumbrance placeholders using `(N)`, `(S)`, `{N}`, `{S}`.
  - Malformed balloon conditionals like `{{#ifpr_li_ant_balloonYes_(N)_(S)}}` with missing whitespace after `#if`.
  - One incomplete closing tag: `{{/if}`.
  - Broken eq syntax such as `{{#if (eq pr_p_performeBy_N"Broker")}}`.
- The current generator already has RE851D-specific logic, but the normalization is too narrow for mixed-case/underscore encumbrance fields and does not safely sanitize all malformed control fragments before merge evaluation.

### Changes to implement

1. **Add a RE851D template-sanitization pass before rendering**
   - Normalize unsupported index syntax:
     - `pr_li_rem_*_(N)_(S)` → `pr_li_rem_*_N_S`
     - `pr_li_ant_*_{N}_{S}` → `pr_li_ant_*_N_S`
   - Use a broader field-name matcher that handles camelCase, underscores, and mixed field names.
   - Normalize malformed control openers:
     - `{{#ifpr_li_ant_balloonYes_(N)_(S)}}` → `{{#if pr_li_ant_balloonYes_N_S}}`
   - Convert incomplete `{{/if}` fragments to valid `{{/if}}` only when safe, or strip them when they are orphaned.

2. **Harden conditional parsing for malformed-but-recoverable inline expressions**
   - Update the tag parser to tolerate missing whitespace in simple `#if` openers only when the field key is otherwise valid.
   - Normalize `(eq FIELD"Value")` into `(eq FIELD "Value")` before condition evaluation.
   - Keep this scoped and conservative so unrelated templates are not affected.

3. **Make RE851D balloon checkbox cleanup deterministic**
   - For malformed anticipated/remaining encumbrance balloon checkbox rows, remove broken `{{#if...}}`, `{{else}}`, and `{{/if...}}` control text while preserving visible checkbox glyphs.
   - Let the existing post-render encumbrance safety pass set the actual Yes/No/Unknown checkbox state from `pr_li_ant_*` / `pr_li_rem_*` values.

4. **Improve final integrity diagnostics**
   - When validation fails, log the unbalanced tag type, open/close counts, and a compact nearby XML/text snippet around suspicious paragraph/table boundaries.
   - Keep the user-facing error concise, but make future backend logs actionable.

5. **Validate with the uploaded template**
   - Add a focused diagnostic/test path for `RE851D-V12.1-4.docx` using the same normalization and integrity validation logic.
   - Confirm `word/document.xml` remains well-formed and has balanced `<w:p>`, `<w:r>`, `<w:t>`, `<w:tc>`, `<w:tr>`, `<w:tbl>`, and `<w:sdt>` tags after processing.

### Files expected to change
- `supabase/functions/generate-document/index.ts`
- `supabase/functions/_shared/tag-parser.ts`
- Possibly one focused test/diagnostic file under `supabase/functions/_shared/` or `supabase/functions/generate-document/`

### What will not change
- No database/schema changes.
- No UI changes.
- No broad refactor of document generation beyond the RE851D-safe normalization and integrity safeguards.
## Issue confirmed

Generation is failing after the RE851D post-render passes with:

```text
DOCX_INTEGRITY: word/document.xml has unbalanced <w:p> tags (open=1739, close=1744)
```

The uploaded RE851D template itself is XML-well-formed, but it contains malformed placeholder/control syntax that becomes unsafe during generation:

- Unsupported encumbrance placeholders like `{{pr_li_rem_priority_(N)_(S)}}` and `{{pr_li_ant_priority_{N}_{S}}}`.
- Broken balloon conditional fragments like `{{#if ... pr_li_ant_balloonYes_(N)_(S)}}{{else}}☐{{/if}}`, including one incomplete `{{/if`.
- Some conditional expressions with spacing errors, e.g. `{{#if (eq pr_p_performeBy_N"Broker")}}`.
- Template text/control fragments are mixed with Word paragraph/table XML inside the same runs, so a replacement pass can leave extra closing paragraphs.

## Plan

1. **Harden RE851D template pre-normalization**
   - Extend the existing RE851D preprocessing in `generate-document` to normalize all unsupported `{N}/{S}` and `(N)/(S)` encumbrance tag variants before merge replacement.
   - Include mixed-case field names and non-simple field names currently missed by the existing `[A-Za-z]+` matcher.
   - Normalize malformed `#if (eq FIELD"Value")` spacing to valid `#if (eq FIELD "Value")` for RE851D-safe field families.

2. **Sanitize malformed balloon conditionals before post-render passes**
   - Add a RE851D-only cleanup for balloon checkbox runs that removes broken `{{#if ...}}`, `{{else}}`, and incomplete `{{/if` fragments when they reference `pr_li_rem_balloon*` or `pr_li_ant_balloon*`.
   - Preserve the visible checkbox glyphs so the existing balloon safety pass can still force the correct Yes/No/Unknown state.

3. **Fix the unsafe post-render replacement ordering**
   - In the RE851D encumbrance post-render pass, apply replacements before insertions, or recompute insertion offsets after replacements.
   - This prevents replacements from shifting later insertion positions and cutting into Word XML, which matches the observed extra `</w:p>` count.

4. **Improve final integrity diagnostics**
   - When final validation fails, log a compact count of unbalanced tags and a small XML context around the first suspicious paragraph/table boundary.
   - Keep the user-facing error clean, but make future failures diagnosable from logs.

5. **Validate with the uploaded template**
   - Add or run a focused test/diagnostic using `RE851D-V12.1-3.docx` against the same normalization and final validation path.
   - Confirm `word/document.xml` passes balance checks and the generated DOCX opens without XML parsing errors.

## Files expected to change

- `supabase/functions/generate-document/index.ts`
- Potentially `supabase/functions/_shared/tag-parser.ts` only if the shared parser needs a narrow generic guard for incomplete control tags.

No database/schema changes are needed.
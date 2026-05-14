## Plan

1. **Stop the corruption at the source**
   - Update only the RE851D encumbrance balloon-payment post-render pass in `supabase/functions/generate-document/index.ts`.
   - Keep the existing field keys and business logic unchanged.
   - Change the balloon replacement logic so it never replaces an existing `<w:sdt>`/content-control block or spans across paragraph/control boundaries.
   - Only rewrite safe standalone checkbox glyph runs (`☑`, `☐`, `☒`) and strip duplicate raw Handlebars balloon-token text runs.

2. **Remove risky XML “healing” dependency**
   - Keep final validation, but avoid relying on broad repair logic to make corrupted XML pass.
   - Add a small targeted guard before applying queued RE851D encumbrance edits: if a replacement boundary is not exactly a complete `<w:r>...</w:r>` text run, skip it instead of splicing XML.

3. **Preserve expected output**
   - For every BALLOON PAYMENT? row, force exactly one checked option based on existing published booleans:
     - `pr_li_*_balloonYes_N_S`
     - `pr_li_*_balloonNo_N_S`
     - `pr_li_*_balloonUnknown_N_S`
   - Output remains: `☑ YES ☐ NO ☐ UNKNOWN` (or the matching option), with no literal `#if` / `{{...}}` text.

4. **Validate with the same failure signal**
   - Run the targeted document-generation function test/invocation for the failing deal/template if available.
   - Confirm logs no longer show `expected </w:p> before </w:sdtContent>` and final `word/document.xml` integrity validation passes.
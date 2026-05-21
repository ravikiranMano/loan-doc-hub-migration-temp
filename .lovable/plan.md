## Plan

1. **Add a global pre-parse XML consolidation pass**
   - Implement a focused helper in `supabase/functions/_shared/tag-parser.ts` that runs before normal merge parsing.
   - It will remove `<w:proofErr .../>` elements inside tag-bearing paragraphs and consolidate fragmented Handlebars tags split across Word XML runs.
   - It will explicitly support split simple tags, split `#if`, split `#each`, split `else`, and split closing control tags.
   - It will drop `<w:br/>` only when it appears inside a single `{{ ... }}` tag span, so normal user-visible line breaks remain untouched.

2. **Make consolidation safe for all templates**
   - Keep the pass paragraph-scoped and tag-scoped so it does not rewrite normal document content.
   - Reuse the existing `normalizeWordXml()` first-step pipeline so every document template benefits before `processEachBlocks`, `processConditionalBlocks`, or simple merge replacement runs.
   - Avoid broad table/cell rewrites globally to preserve all non-RE870 document layouts.

3. **Fix the RE870 INVESTOR NAME cell structure without changing other fields**
   - Update `rewrite-re870-multi-lender/index.ts` to rebuild only the true `INVESTOR NAME` table cell.
   - The rewritten cell will contain exactly:
     - Paragraph 1: `INVESTOR NAME:`
     - Paragraph 2: one clean `<w:t>` containing `{{#each lenders}}{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}{{/each}}`
   - This removes the currently corrupted run/proofErr/line-break fragments from that cell only.

4. **Prevent invalid XML when the RE870 each-loop expands**
   - Adjust the `{{#each}}` expansion path so the inline RE870 lender list can safely render multiple lenders as separate lines without emitting orphaned `</w:t>` / `<w:br/>` fragments.
   - Preserve existing behavior for paragraph-based loops and unrelated templates.

5. **Add targeted regression coverage**
   - Add a small shared test fixture for fragmented Word XML tags, covering:
     - `{{#if isIndividual}}`
     - `{{firstName}}`
     - `{{#each lenders}}`
     - `<w:proofErr/>` and `<w:br/>` inside tag spans
   - Verify the normalized XML contains clean, parseable tags and no broken XML structure.

6. **Deploy and apply the template rewrite**
   - Deploy the updated backend functions.
   - Run the RE870 rewrite with `force: true` for the active Investor Questionnaire template(s).
   - Then regenerate/check logs for the failed document job to confirm the integrity error is gone.
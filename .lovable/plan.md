## Goal
Make the generated RE870 doc's "INVESTOR NAME:" paragraph match the original v1 template exactly: left indent 475, sz=18 run (sz=16 paragraph mark), yellow highlight, no bold, with a `<w:br/>` between the label and the lender loop.

## Root cause
`wrapInvestorNameCell` in `supabase/functions/rewrite-re870-multi-lender/index.ts` rebuilds the cell by reusing the source paragraph's `<w:pPr>` and the source run's `<w:rPr>`. On already-touched live templates, that source paragraph is the broken one (`<w:ind w:left="2"/>`, `<w:jc w:val="left"/>`, `<w:b/>`, `<w:sz w:val="20"/>`), so the "fix" persists the wrong formatting and drops the yellow highlight + `<w:br/>`.

The template's canonical paragraph (from `Investor_Questionnaire_v1__1_.docx`):

```text
<w:pPr>
  <w:ind w:left="475"/>
  <w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:highlight w:val="yellow"/></w:rPr>
</w:pPr>
<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">INVESTOR NAME: </w:t></w:r>
<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:br/></w:r>
<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>{{#each lenders}}…{{/each}}</w:t></w:r>
```

## Changes (single file: `supabase/functions/rewrite-re870-multi-lender/index.ts`)

1. Replace `normalizeInvestorParagraphPr` so it returns a fixed canonical pPr, ignoring any prior pPr from the source cell:
   ```text
   <w:pPr><w:ind w:left="475"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:highlight w:val="yellow"/></w:rPr></w:pPr>
   ```
   This guarantees `w:left="475"`, removes injected `<w:jc w:val="left"/>`, drops bold, and restores the yellow highlight on the paragraph mark.

2. In `wrapInvestorNameCell`, stop deriving `rPr` from the source run. Use two fixed run-property blocks:
   - Label run rPr: `<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>` (no `<w:b/>`).
   - Loop run rPr: `<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` (matches the v1 template's loop run size).

3. Emit ONE paragraph (matching v1 structure) instead of two, with a `<w:br/>` between label and loop:
   ```text
   <w:p>{canonicalPPr}
     <w:r>{labelRPr}<w:t xml:space="preserve">INVESTOR NAME: </w:t></w:r>
     <w:r>{labelRPr}<w:br/></w:r>
     <w:r>{loopRPr}<w:t xml:space="preserve">{{#each lenders}}…{{/each}}</w:t></w:r>
   </w:p>
   ```
   Then continue to blank the remaining `<w:p>` siblings in the cell as today.

4. Keep `normalizeInvestorNameCellGeometry` (gridSpan removal + preferred width) unchanged.

5. Bump version marker (e.g., `V9_MARKER`) so the rewrite re-runs unconditionally on already-touched live templates.

## Validation
1. Deploy `rewrite-re870-multi-lender`.
2. Re-run with `force: true` for the 3 RE870 templates.
3. `debug-fetch-doc` the rewritten templates and confirm:
   - `<w:ind w:left="475"/>` is present on the INVESTOR NAME paragraph.
   - No `<w:b/>` and no `<w:jc w:val="left"/>` on that paragraph.
   - `<w:highlight w:val="yellow"/>` present on the pPr's rPr.
   - Exactly one `<w:br/>` between `INVESTOR NAME:` and the `{{#each lenders}}` loop.
   - Label run uses `<w:sz w:val="18"/>`; loop run uses `<w:sz w:val="20"/>`.
4. Generate a doc for deal `DL-2026-0266` and re-extract the same XML in the output to confirm parity with the v1 template.

## Out of scope
- No changes to `_shared/tag-parser.ts` or other functions.
- No changes to the lender loop expression itself.

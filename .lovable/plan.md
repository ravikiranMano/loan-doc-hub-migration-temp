## Findings

The mapping change is not the reason generation is still failing. The latest backend logs show the DOCX render itself now completes quickly:

- `processDocx` completes in about 144ms after cleanup.
- The function is killed immediately after that with `CPU Time exceeded`.

So the current failure is happening after the main render, in the RE851D-specific post-render safety passes and/or final packaging/upload path. The uploaded `RE851D-V12.1-8.docx` also still contains malformed placeholder variants that the current normalizer does not fully cover, including split keys like:

- `property_type_sfr_owner _N`
- `property_type_land_income_N }`
- `pr_li_sourceOfPayment_ N } }`
- `propertytax.source _of_information_N`
- `pr_pt_actual_N_ glyph`
- `pr_p_m ultipleProperties_no_glyph`
- `pr_li_rem_priority _(N)_(S)`

## Plan

1. **Move RE851D malformed-token repair earlier**
   - Extend the existing RE851D template preprocessing block to normalize the uploaded template’s split/space-corrupted placeholders before rendering.
   - Keep this strictly scoped to RE851D field families and the known malformed variants above.

2. **Stop expensive post-render passes from rebuilding projections repeatedly**
   - Replace the repeated RE851D post-render scans with a single combined pass over `word/document.xml` where practical.
   - Reuse one visible-text projection and property-region map for all RE851D checkbox safety operations.
   - Avoid invalidating/rebuilding the full projection after each small glyph change; collect rewrites first, then apply them once.

3. **Flush the DOCX once**
   - Keep the existing shared unzip/cache approach, but ensure dirty XML parts are encoded and zipped only once after all RE851D post-render mutations are collected.
   - Add timing logs around: preprocessing, render, combined post-render pass, final zip/upload/PDF conversion so the next log clearly identifies any remaining bottleneck.

4. **Add a safer fallback for this template class**
   - If RE851D still approaches the CPU budget, skip nonessential cosmetic post-render safety passes and return the generated DOCX rather than failing the entire generation.
   - Preserve required data replacement and document integrity validation.

5. **Validate against the uploaded DOCX**
   - Run a local extraction/normalization check on `RE851D-V12.1-8.docx` to confirm malformed placeholders are repaired before render.
   - Verify no unresolved `_N`, malformed single-brace tags, or corrupted key fragments remain in the processed XML path.

## Expected outcome

Generation should no longer die after the main render. If a remaining timeout exists, the new stage logs will identify the exact post-render/finalization step instead of leaving it ambiguous.
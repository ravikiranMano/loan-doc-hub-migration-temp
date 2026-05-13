## Plan to fix RE851D generation performance

### What I found
- The app already returns a `generation_jobs` job ID immediately and uses background processing, but the heavy work still runs inside the same backend function CPU budget.
- Recent logs show the generic DOCX merge phase is relatively fast, but RE851D still times out after rendering because the function performs many RE851D-specific template rewrites and post-render safety passes over a ~4.4MB `word/document.xml`.
- The uploaded RE851D template still contains generic `_N` placeholders, unsupported `(N)_(S)` encumbrance placeholders, and conditionals; the backend currently compensates with expensive runtime scans.

### Implementation steps

1. **Add a RE851D flat variable builder**
   - Create a dedicated backend helper in `generate-document/index.ts` for RE851D that builds all required `*_1` through `*_5` keys before DOCX rendering.
   - Populate every missing property slot with safe defaults:
     - text/amount fields: `''`
     - unchecked glyph fields: `☐`
     - mutually exclusive yes/no glyphs: deterministic `☑` / `☐` where applicable.
   - Include the known RE851D families already referenced by the template: property values, property tax fields, property type glyphs, occupancy glyphs, lien delinquency glyphs, source-of-information glyphs, encumbrance rows, and additional-property glyphs.

2. **Pre-resolve RE851D conditionals into values before render**
   - Convert known RE851D conditional logic into flat keys such as:
     - `pr_p_occupancyYesGlyph_1..5`
     - `pr_p_occupancyNoGlyph_1..5`
     - `pr_p_performedByBrokerText_1..5`
     - property tax delinquent yes/no glyphs.
   - Add these keys to the render data so the generic renderer does not need to evaluate repeated `{{#if (eq ...)}}` blocks for RE851D.

3. **Normalize the RE851D template once before rendering**
   - Keep the existing `_N` expansion, but make it a single deterministic pre-render pass.
   - Also translate legacy encumbrance placeholders like `_(N)_(S)` into concrete `_property_slot` keys before the merge engine sees them.
   - Replace known RE851D inline checkbox conditionals with direct flat glyph placeholders or already-resolved literal glyphs.

4. **Reduce or bypass expensive RE851D post-render safety passes**
   - Once glyphs and conditionals are pre-resolved, remove the need for repeated full-document scans for owner-occupied, multiple-properties, remain-unpaid, cure-delinquency, 60-day, encumbrance-of-record, and attachment checkbox fixes.
   - Keep a lightweight final validation/repair pass only, so malformed XML is still caught before upload.
   - Leave existing non-RE851D behavior unchanged.

5. **Add short-lived generation caching**
   - Use a 5-minute cache key based on `dealId + templateId + template version/file path + outputType`.
   - If the same RE851D document was generated successfully moments ago, return the cached/generated document result instead of recomputing.
   - Prefer using existing `generated_documents` records where possible; add a minimal cache table only if needed for reliable template-version matching.

6. **Tighten timeout and job handling**
   - Keep async job behavior, but add a 60-second logical timeout guard around the generation task so failures are recorded cleanly instead of leaving jobs stuck as `running`.
   - Note: this does not raise the backend CPU limit; the real fix is the RE851D fast path above.

7. **Validate with the uploaded RE851D template**
   - Run a local/template-level DOCX inspection against `RE851D-V12.1-5.docx` to verify placeholders normalize correctly.
   - Confirm generated `word/document.xml` is well-formed and no unresolved `_N`, `(N)`, or broken conditional markers remain.
   - Check logs show the RE851D render path avoids the repeated post-render scans and completes before the CPU limit.
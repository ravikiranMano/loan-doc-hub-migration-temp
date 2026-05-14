## Plan

1. **Stop treating this as only a checkbox-indent issue**
   - The mismatch in `RE851D_v90` is caused by the encumbrance question block being split by page/column breaks and by extra `<w:br>`/keep artifacts.
   - The generated file shows the first question text stranded at the bottom of one page and the YES/NO rows starting on the next page, while the reference keeps the whole question block together.

2. **Replace the existing narrow rewrite with a block-level normalization**
   - Update `supabase/functions/rewrite-re851d-encumbrance-layout/index.ts` so it normalizes the full RE851D encumbrance mini-block per property, not just the two YES/NO paragraphs.
   - For each property block, force the same paragraph sequence used by the reference:
     - encumbrance-of-record question paragraph
     - blank spacer
     - 60-days-late question paragraph
     - encumbrance YES/NO row
     - blank spacer
     - 60-days-late YES/NO row
     - continuous 2-column section break holder
   - Preserve all existing merge tags/checkbox controls and field keys; only paragraph/run formatting changes.

3. **Remove layout artifacts that are causing the page split**
   - Strip leading `<w:br>` runs from the encumbrance question paragraphs so the question no longer gets pushed to the page bottom.
   - Remove injected `<w:keepNext/>`/`<w:keepLines/>` from this block where they differ from the original template.
   - Ensure the section break remains on the same blank paragraph position as the reference.

4. **Match reference paragraph properties**
   - Apply the reference indents, spacing, tab stops, and font sizes to the affected paragraphs:
     - question: left indent `360`, before `93`, 10pt
     - 60-day list question: left `718`, hanging `358`, tab `718`, 10pt
     - YES/NO rows: left indent `86`, tab `986`, 10pt, correct spacing
   - Keep the two YES/NO rows in the right-side column like the original.

5. **Validate against the uploaded documents**
   - Re-run the formatter locally against `RE851D_v90.docx` as a dry-run artifact.
   - Convert the result to page images and compare the encumbrance pages to `re851d - LPDS Multi-property`, confirming the two flagged lines no longer split across pages and the YES/NO rows align like the original.
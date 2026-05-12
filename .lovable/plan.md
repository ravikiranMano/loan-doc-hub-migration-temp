## Problem to fix
The latest RE851D generation is marked successful, but Microsoft Word reports `Xml parsing error` in `/word/document.xml` around column `666465`. The important clue is that the main `processDocx` integrity check currently runs **before** the RE851D-specific post-render safety passes. Those later passes can still mutate `document.xml` and upload a corrupted file without being revalidated.

## Plan
1. **Add a final DOCX integrity gate after RE851D post-render flush**
   - Validate the final mutated XML immediately before upload.
   - Check XML well-formedness more strictly than the current open/close count checks:
     - root presence/truncation
     - balanced `w:p`, `w:r`, `w:t`, `w:tc`, `w:tr`, `w:tbl`, `w:sdt`
     - no leaked placeholder markers or illegal replacement chars
     - `w14` namespace present when `w14:*` is used
   - If validation fails, mark generation as failed instead of saving a broken DOCX.

2. **Repair the likely corruption source in the RE851D post-render flush path**
   - Harden the post-render mutation helpers so every dirty content part is validated after the final zip cache flush.
   - Add a small XML repair sweep for required table-cell paragraph structure after all RE851D mutations, not only during the earlier tag-parser phase.
   - Guard the visible-text offset rewrite path so stale offsets cannot write inside tags/attributes.

3. **Validate the fix against the current failing RE851D template/deal**
   - Regenerate/test the same `dealId` + RE851D `templateId` path.
   - Confirm the function no longer reports success for invalid XML.
   - If it succeeds, inspect the generated `document.xml` for the previous error region and confirm the final document package is structurally safe.

## Files to change
- `supabase/functions/_shared/docx-processor.ts`
- `supabase/functions/generate-document/index.ts`

## Expected outcome
The app should stop producing “successful” RE851D DOCX files that Word cannot open; either the final DOCX opens cleanly, or generation fails with a specific integrity message that points to the remaining invalid XML location.
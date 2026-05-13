## Plan to restore RE851D document generation

### Goal
Make RE851D generate a downloadable DOCX again while keeping the Word-openability protection that prevents corrupt files from being marked as successful.

### What I found
- The latest RE851D jobs now fail before upload with:
  - `word/document.xml is not well-formed XML`
  - `expected </w:rPr> before </w:p> at offset 343087`
- This is happening after the RE851D post-render safety passes, not during the initial template render.
- The prior fix correctly prevents bad DOCX files from being saved as “success,” but generation now needs a repair pass for this specific malformed run/property block.
- Other documents can still generate; I saw a recent `re851a` success, so the failure is scoped to RE851D.

### Implementation steps
1. **Add a targeted malformed-run repair before final validation**
   - In the RE851D post-render flush step, run a small repair pass only on dirty Word content XML parts.
   - Repair the exact invalid shape: a paragraph closes while Word XML is still inside `<w:rPr>`.
   - The repair will close the dangling `<w:rPr>` before `</w:p>` rather than disabling validation.

2. **Improve integrity diagnostics without exposing noisy user-facing errors**
   - Keep the strict final XML check.
   - Add a short internal context log around the failing offset so future XML issues can be diagnosed quickly.
   - Keep the UI failure message concise.

3. **Re-run RE851D generation for the current deal/template**
   - Trigger the same single-document generation for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` and template `RE851D`.
   - Confirm the job reaches `success` and creates a new `generated_documents` record.

4. **Validate the generated DOCX structure**
   - Download the newly generated DOCX from storage.
   - Parse `word/document.xml` locally to confirm it is well-formed.
   - Confirm no old `mc:Fallback` orphan issue remains.

### Technical details
- Files to update:
  - `supabase/functions/_shared/docx-processor.ts`
  - `supabase/functions/generate-document/index.ts`
- No database schema changes.
- No frontend/UI changes.
- No changes to field mapping or document data persistence.
- The existing safety validation stays enabled; the fix repairs malformed XML before the validation gate instead of bypassing it.
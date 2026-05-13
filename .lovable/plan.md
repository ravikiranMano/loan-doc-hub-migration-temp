Root cause: the RE851D template is still too large/noisy for the current backend function CPU budget. The actual DOCX merge render is fast (~127ms), but the function is killed immediately after that because it also runs several RE851D-specific pre/post-processing passes on a ~4.4MB `word/document.xml`. The uploaded template contains heavy Word authoring noise (`mc:Fallback`, `rsid`, `proofErr`) and fragmented placeholders, so updating field mappings alone will not fix it.

Plan:
1. Route template uploads through the existing `upload-template` backend function instead of direct browser-to-storage uploads, so cleanup runs before the template is saved.
2. Tighten the template cleanup to fully remove authoring bloat and preserve merge tags, reducing RE851D runtime work before generation.
3. Add timing logs around RE851D pre-processing, post-render flush, storage upload, and document record creation so future failures show the exact stage.
4. Add a safer stale-job sweep on the documents page so old `Running` jobs are marked failed even when the user does not start a new retry.
5. Deploy the changed backend functions and validate by checking that generation no longer reaches the CPU kill point.

Technical notes:
- Files to update: `src/pages/admin/TemplateManagementPage.tsx`, `src/pages/csr/DealDocumentsPage.tsx`, `supabase/functions/upload-template/index.ts`, `supabase/functions/generate-document/index.ts`, and likely `supabase/config.toml` to expose the upload function.
- No schema change is required unless the stale-job sweep needs a backend endpoint; if a database change becomes necessary, I will keep it separate for approval.
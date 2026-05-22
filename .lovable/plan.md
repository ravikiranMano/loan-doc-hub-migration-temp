Root cause found:
- The active RE851D template is `1779290469775_RE851D-V12.1.docx`, but the prior rewrite function defaulted to the older path `1778746922135_RE851D-V12.1.docx`.
- The uploaded generated document still contains 5 literal `BPO Performed by Broker` / `N/A` appraiser values and no `{{pr_p_appraiserName_*}}` or `{{pr_p_appraiserAddress_*}}` tags.
- The hardcoded appraiser text is not in the “next table cell” layout assumed by the prior rewrite; it is embedded in the same paragraph/run area after the `NAME OF APPRAISER (IF KNOWN TO BROKER)` label. That is why it keeps populating.

Plan:
1. Update only the RE851D hardcoded-appraiser one-shot function.
   - Change the default template path to the active template: `1779290469775_RE851D-V12.1.docx`.
   - Add a narrowly scoped paragraph/run rewrite that handles the current V7/V12.1 structure:
     - replace the literal value after `NAME OF APPRAISER (IF KNOWN TO BROKER)` with `{{pr_p_appraiserName_K}}`
     - replace the literal value after `ADDRESS OF APPRAISER` with `{{pr_p_appraiserAddress_K}}`
     - assign K by occurrence order, supporting all 5 property sections.
   - Keep the existing table-cell rewrite as a fallback for older template layouts.

2. Deploy and run the function against the active RE851D template.
   - Verify the function reports 5 name rewrites and 5 address rewrites, or confirms the template is already clean on re-run.

3. Regenerate/check the document output behavior.
   - Confirm the template no longer contains hardcoded `BPO Performed by Broker` / `N/A` in appraiser value positions.
   - Confirm generated output now depends only on `propertyN.appraisal_performed_by` via existing `pr_p_appraiserName_N` / `pr_p_appraiserAddress_N` publishers.

No UI, database schema, unrelated document fields, calculations, validations, session handling, or other document-generation flow will be changed.
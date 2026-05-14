## Plan

1. **Confirm the active RE851D template target**
   - Use the active `templates` record for RE851D, currently `1778782063756_RE851D-V13.5.docx`.
   - Avoid the stale V12 default path used by the existing one-shot rewrite function.

2. **Update the stored RE851D DOCX template**
   - Run the existing RE851D template rewrite function against the active V13.5 template path, or adjust its default/fallback so it targets the active `templates.file_path` instead of the old V12 file.
   - Replace appraiser conditionals in all property slots with plain merge tags:
     - Name: `{{pr_p_appraiserName_1}}` through `{{pr_p_appraiserName_5}}`
     - Address: `{{pr_p_appraiserAddress_1}}` through `{{pr_p_appraiserAddress_5}}`
   - Do not add any new `{{#if}}` logic to the DOCX template.

3. **Keep server-side pre-resolution intact**
   - Preserve the existing `generate-document` logic that sets:
     - `pr_p_appraiserName_N = "BPO Performed by Broker"` when performed by Broker, otherwise entered appraiser name or blank.
     - `pr_p_appraiserAddress_N = "N/A"` when performed by Broker, otherwise joined appraiser address or blank.
   - Make only minimal comments/code cleanup if needed; no data model or business logic changes.

4. **Deploy and verify**
   - Deploy any changed backend function if needed.
   - Invoke the rewrite against the active RE851D template.
   - Generate RE851D for the current deal/template and inspect the output/logs to confirm:
     - No raw `#if`/`{{#if}}` appears.
     - Broker property renders `BPO Performed by Broker` and `N/A`.
     - Non-Broker or empty property slots render blank appraiser name/address.
     - All five property sections remain independent.
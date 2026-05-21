## Plan

1. **Fix the template source**
   - Download the current `Certification of Purpose, Occupancy, Material Facts V6 - Entity (1)` DOCX template from the private template storage.
   - Inspect `word/document.xml` and replace only the hardcoded text run:
     ```xml
     <w:t xml:space="preserve"> Adtn Guarantor Marc Boucher</w:t>
     ```
     with:
     ```xml
     <w:t xml:space="preserve"> {{ld_p_authorizedFirst}} {{ld_p_authorizedMiddle}}{{ld_p_authorizedLast}}</w:t>
     ```
   - Repackage and upload the corrected DOCX back to the same template record/path so the template keeps merge tags, not resolved values.

2. **Fix the data source in document generation**
   - In `supabase/functions/generate-document/index.ts`, remove the Certification-of-Purpose override that currently replaces `ld_p_authorizedFirst`, `ld_p_authorizedMiddle`, and `ld_p_authorizedLast` with Additional Guarantor values.
   - Keep the existing lender authorized-party publisher, which already maps Lender → Authorized Party values into those `ld_p_authorized*` tags.
   - Ensure the affected template resolves these tags from the lender participant’s authorized party data only.

3. **Add a hardcoding guard for this template**
   - Add a narrow pre-render XML safeguard for this specific template/name that replaces the known hardcoded Authorized Signer value with the correct merge-tag sequence if it ever appears in the source template again.
   - This guard will not write resolved values back into storage; it only normalizes the in-memory template XML before generation.

4. **Validate only the requested behavior**
   - Confirm the stored template XML contains `{{ld_p_authorizedFirst}} {{ld_p_authorizedMiddle}}{{ld_p_authorizedLast}}` and no `Adtn Guarantor Marc Boucher` text in that field.
   - Confirm the resolver no longer routes these `ld_p_authorized*` fields to Additional Guarantor values.
   - Deploy the updated document generation function.

## Expected result

For loan `DL-2026-0257`, the generated document should show:

```text
Authorized Signer: Len Auth David JBecham
```

Note: the requested template text has no space between `{{ld_p_authorizedMiddle}}` and `{{ld_p_authorizedLast}}`, so the rendered output follows that exact spacing unless you want the template changed to include a space before last name.
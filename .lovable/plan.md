Plan to fix the Borrower TCPA / E-Consent phone field:

1. Update document-generation phone alias logic
   - Change `br_p_cellPhone` so it can resolve from the borrower’s preferred phone selection, not only `borrower1.phone.mobile`.
   - Priority will be:
     1. `preferred.home` -> `phone.home`
     2. `preferred.home2` -> `phone.home2`
     3. `preferred.work` -> `phone.work`
     4. `preferred.cell` -> `phone.cell` / `phone.mobile`
     5. fallback to home, home2, work, cell/mobile if no preferred flag is set
   - This matches the screenshot where Home is selected as preferred, so the “Mobile Number” merge tag will output the Home phone number.

2. Keep existing tags compatible
   - Preserve `br_p_homePhone`, `br_p_workPhone`, and email aliases.
   - Add `phone.cell` as a source because the UI stores Cell under `phone.cell`, while the current publisher only checks `phone.mobile`.

3. Verify the uploaded v4 template
   - Inspect `Borrower TCPA and E-Consent_v4.docx` to confirm the Mobile Number cell contains the expected merge tag.
   - If the template still has an empty cell or wrong tag, patch it to use the same supported tag, likely `{{br_p_cellPhone}}`.

4. Deploy the updated document-generation function
   - Redeploy the backend document-generation function so new generated documents use the corrected preferred-phone logic.

No database schema changes are needed.
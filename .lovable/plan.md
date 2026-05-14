## Plan

1. **Strengthen server-side pre-resolution in `generate-document`**
   - Ensure all 5 property slots always publish these exact strings before rendering:
     - `pr_li_encumbranceOfRecord_N_yes_glyph` / `_no_glyph`
     - `pr_li_delinqu60day_N_yes_glyph` / `_no_glyph`
     - `pr_li_currentDelinqu_N_yes_glyph` / `_no_glyph`
     - `pr_li_delinquencyPaidByLoan_N_yes_glyph` / `_no_glyph`
     - `pr_li_sourceOfPayment_N`
     - `pr_p_delinquHowMany_N`
   - Default missing/null booleans to `☐ YES / ☑ NO`; default text/number fields to `""`.
   - Preserve the existing per-property lien aggregation rules and avoid cross-property fallback.
   - Add compatibility aliases only where needed for the template variants that use shortened/bare names, so raw names cannot leak.

2. **Add a permanent RE851D template rewrite for the encumbrance section**
   - Extend the existing one-shot template rewrite approach or create a narrowly scoped rewrite pass for `RE851D-V12.1`.
   - For each of the 5 property sections, replace the four inline question/checkbox paragraph patterns with two-column table rows:
     ```text
     | Question text + dotted fill | {{pr_li_*_N_yes_glyph}} YES  {{pr_li_*_N_no_glyph}} NO |
     ```
   - Right-align the second cell, keep the first cell left-aligned, and use stable widths around 75% / 25%.
   - Apply row/paragraph keep rules (`keepNext` / `cantSplit` equivalent XML) so the question and YES/NO pair do not split across a page break.
   - Leave unrelated RE851D sections untouched.

3. **Keep runtime safety net minimal and scoped**
   - Keep the existing `_N → _1.._5` region rewrite for these tags.
   - Add a targeted fallback for fragmented/bare encumbrance glyph tags only, not a broad DOCX rewrite.
   - Do not introduce `{{#if}}` conditionals.

4. **Deploy and apply the fix**
   - Deploy the updated backend functions.
   - Invoke the RE851D template rewrite once against the stored mapped template path.
   - Regenerate RE851D for deal `DL-2026-0250`.

5. **Verify against the uploaded generated output issues**
   - Inspect the regenerated DOCX XML and rendered document text to confirm:
     - no raw `{{...}}`, `_N`, `undefined`, `null`, `true`, or `false` appears in the encumbrance section;
     - all four YES/NO pairs are in a right-aligned table cell for each property;
     - question A no longer separates from its checkbox pair at page breaks;
     - values remain independent for PROPERTY #1 through PROPERTY #5.
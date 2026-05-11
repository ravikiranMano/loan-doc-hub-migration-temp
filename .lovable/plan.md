Implement a focused backend optimization for `generate-document` without changing UI behavior or document field logic.

1. Template-aware RE851D preprocessing
   - Inspect the uploaded/generated DOCX XML before running RE851D `_N` expansion.
   - Run the RE851D `_N` rewrite only when the template content actually contains indexed placeholders such as `_N`, `_N_S`, `_(N)`, or `_{N}`.
   - Pre-filter the RE851D indexed tag list once per XML part and avoid repeated set construction inside region resolution.

2. Remove redundant field-dictionary work for RE851D
   - Stop loading the full `field_dictionary` via `getValidFieldKeys()` for RE851D.
   - Build `effectiveValidFieldKeys` from only:
     - template field-map keys,
     - field keys already present in the deal payload,
     - RE851D computed aliases (`ln_p_remainingEncumbrance_N`, `ln_p_expectedEncumbrance_N`, `ln_p_totalEncumbrance_N`, `ln_p_amountOfEquity_N`, `pr_netPropertyValue`, etc.).
   - Keep the existing full dictionary path for non-RE851D templates.

3. Single-pass lightweight DOCX rendering for large RE851D templates
   - Add a RE851D-specific processing option in the shared DOCX/tag parser path to skip nonessential post-render validation loops for large `word/document.xml`.
   - Keep the main merge-tag/conditional render pass intact.
   - Avoid duplicate normalization of `word/document.xml` after RE851D `_N` preprocessing when it was already normalized.

4. Consolidate RE851D post-render checkbox safety work
   - Replace the many separate RE851D post-render full-document passes with one shared pass over cached `word/document.xml`/content XML.
   - Build visible-text/property anchors once per XML version.
   - Gate each safety operation by cached anchor presence before doing regex/control scans.
   - Preserve existing checkbox outcomes for:
     - owner occupied,
     - multiple/additional securing property,
     - remain unpaid,
     - cure delinquency / paid by loan,
     - 60-day delinquency,
     - encumbrance of record,
     - additional encumbrance addendum,
     - encumbrance grid inserts.

5. Keep calculation logic but avoid repeated loops
   - Reuse one collected property/lien index model for RE851D calculations.
   - Compute and publish `ln_p_remainingEncumbrance_N`, `ln_p_expectedEncumbrance_N`, `ln_p_totalEncumbrance_N`, `ln_p_amountOfEquity_N`, `li_lt_anticipatedAmount`, and `pr_netPropertyValue` once.
   - Skip empty property/lien records early.

6. Job handling hardening
   - Keep the existing duplicate running-job guard.
   - Tighten stale-job cleanup for the same deal + template so CPU-killed jobs are marked `failed` and the UI does not stay on `Running`.
   - Return the existing in-flight job instead of starting duplicates.

7. Validation
   - Deploy the updated `generate-document` backend function.
   - Check backend logs for the provided deal/template and confirm no `CPU Time exceeded`/`Memory limit exceeded` entry for the new run.
   - Verify generated output succeeds and key fields resolve: `li_lt_anticipatedAmount`, `ln_p_amountOfEquity_N`, and `pr_netPropertyValue`.
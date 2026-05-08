Root cause found

1. The stored data exists and is valid for this deal:
   - `propertytax1.annual_payment = 24234`
   - `propertytax1.tax_confidence = Estimated`
   - `propertytax1.property = Test property 1 - MG Road, Noida, 98454`
   - Property #1 has `MG Road, Noida, 98454`, so the address bridge should route the tax row to Property #1.

2. The previous publisher creates runtime-only aliases like:
   - `pr_pt_annualTaxes_1`
   - `pr_pt_actual_1_glyph`
   - `pr_pt_estimated_1_glyph`

3. The issue is later in the render pipeline:
   - `pr_pt_*` aliases are generated in memory but are not fully registered in the RE851D valid-key seed list.
   - `pr_pt_actual_N_glyph` / `pr_pt_estimated_N_glyph` use the index in the middle of the tag (`actual_N_glyph`), but the post-render rewriter only handles middle-index suffixes for `_yes/_no` patterns, not generic `_glyph` patterns.
   - If the template uses static checkbox glyphs next to ACTUAL/ESTIMATED instead of direct glyph merge tags, there is no RE851D tax-specific safety pass anchoring those glyphs.

Plan

1. Fix RE851D alias registration
   - Add `pr_pt_annualTaxes`, `pr_pt_actual`, `pr_pt_actual_glyph`, `pr_pt_estimated`, and `pr_pt_estimated_glyph` to the RE851D suffixed valid-key seed list.
   - This ensures `{{pr_pt_annualTaxes_1}}`, `{{pr_pt_actual_1_glyph}}`, and `{{pr_pt_estimated_1_glyph}}` resolve directly to the publisher-set values and do not fall through to dictionary/canonical fallback behavior.

2. Fix `_N_glyph` rewrite handling
   - Extend the RE851D `_N` rewriter so tags ending in `_N_glyph` become `_<propertyIndex>_glyph`.
   - Keep existing `_N_yes_glyph`, `_N_no_glyph`, `_N_yes`, and `_N_no` behavior unchanged.
   - Scope this to the RE851D rewrite path only.

3. Add a narrow RE851D Annual Property Taxes safety pass
   - In each detected PROPERTY #K block, find the “ANNUAL PROPERTY TAXES” / “ACTUAL” / “ESTIMATED” area.
   - If the template has static checkbox glyph runs instead of merge tags, force exactly one or zero checkboxes based on `pr_pt_actual_K` / `pr_pt_estimated_K`:
     - Actual => ACTUAL checked, ESTIMATED unchecked
     - Estimated => ACTUAL unchecked, ESTIMATED checked
     - Blank confidence => both unchecked
   - Do not change amounts except through the existing `pr_pt_annualTaxes_K` merge tag.

4. Add diagnostics that always log for this path
   - Emit a compact RE851D tax state line for properties 1–5 showing annual amount, confidence, actual, and estimated.
   - This will confirm whether the values reach `processDocx` before rendering.

5. Validate after implementation
   - Deploy/test the `generate-document` function.
   - Regenerate RE851D for deal `db7517e9-f124-4031-98c8-3e0f33caf889`.
   - Check logs for the RE851D tax state line.
   - Confirm the latest generated document no longer leaves Annual Property Taxes blank for the matched property.
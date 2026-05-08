
## RE851D — Annual Property Taxes (Multi-Property) Population

### What already exists (confirmed)

The edge function `supabase/functions/generate-document/index.ts` already publishes per-property RE851D Annual Property Taxes aliases (lines ~1197–1229) and they are listed in the `_N` rewrite registry (lines ~3585–3590).

Existing field keys (use these in the template):

| Purpose | Field Key (template tag) | Source |
|---|---|---|
| Annual tax amount (currency) | `pr_pt_annualTaxes_N` | `propertytax{N}.annual_payment` (after address-bridge) → fallback `property{N}.annual_property_taxes` / `.annual_tax` / `.propertytax_annual_payment` |
| ACTUAL checkbox glyph (☑/☐) | `pr_pt_actual_N_glyph` | `propertytax{N}.tax_confidence` == "Actual" |
| ESTIMATED checkbox glyph (☑/☐) | `pr_pt_estimated_N_glyph` | `propertytax{N}.tax_confidence` == "Estimated" |
| Bare boolean variants | `pr_pt_actual_N`, `pr_pt_estimated_N` | (for `{{#if …}}` conditionals) |

`_N` is rewritten per property index 1..N at generation time. Values are mutually exclusive; if `tax_confidence` is null both checkboxes render ☐. If `annual_payment` is blank the amount tag resolves to empty.

### Why nothing is populating in the user's deal

Inspection of deal `24d10982-…459ef`: the deal currently has **zero** `propertytax{N}.*` keys saved in `deal_section_values` and no `property{N}.annual_property_taxes` value, so the publisher correctly produces empty output. The mapping itself is wired; the deal just has no Property Tax data entered yet for either property.

There is also one robustness gap: if the CSR enters tax data via the Property Tax sub-section but the row's `property` field (address) does NOT match a Property's `address` exactly (or as a substring), the address-bridge skips it and per-property aliases are never emitted for that property index.

### Plan

1. Register the three publisher tags in **Field Dictionary** (read-only, calculated, no UI input) so admins can see/discover them and so they pass any "must exist in dictionary" lookups when added to a template:
   - `pr_pt_annualTaxes` — label "Annual Property Tax (per property)", section `property`, data_type `currency`, `is_calculated=true`, `is_repeatable=true`.
   - `pr_pt_actual` — label "Annual Tax Confidence — ACTUAL", section `property`, data_type `boolean`, `is_calculated=true`, `is_repeatable=true`.
   - `pr_pt_estimated` — label "Annual Tax Confidence — ESTIMATED", section `property`, data_type `boolean`, `is_calculated=true`, `is_repeatable=true`.

2. In `supabase/functions/generate-document/index.ts` per-property publisher (around lines 1197–1229) tighten the resolution chain so values still populate when no `propertytax{N}` record exists or address-bridge misses:
   - Amount fallback order: `propertytax{N}.annual_payment` → `property{N}.annual_property_taxes` → `property{N}.annual_tax` → `property{N}.propertytax_annual_payment` → (when only one tax record exists overall) `propertytax1.annual_payment`.
   - Confidence fallback order: `propertytax{N}.tax_confidence` → `property{N}.tax_confidence` → (single-record) `propertytax1.tax_confidence`.
   - Keep mutual exclusivity & null-safe behavior already in place.
   - No change to `pr_pt_*` output names.

3. Verify with a small log line that, for each `idx`, the resolved `(annual, confidence, actualGlyph, estimatedGlyph)` is what we expect.

4. Document the three tags in the Admin → Field Dictionary description so the CSR/template author knows the exact merge tag names.

### Validation

- Property 1: Annual = 4.00, Confidence = Estimated → template renders `$4.00` + ESTIMATED ☑, ACTUAL ☐.
- Property 2: Annual = 10000, Confidence = Actual → `$10,000.00` + ACTUAL ☑, ESTIMATED ☐.
- Confidence null → both ☐.
- Annual blank → amount tag empty.
- No data mixing across `_N` indices (per-index isolation already enforced).

### Out of scope

- No new tables / schema changes.
- No UI changes to PropertyTaxForm or PropertyTaxModal.
- No changes to other RE851D sections.

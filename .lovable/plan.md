## Goal
Populate the "ANNUAL PROPERTY TAXES" section in RE851D per-property (N-indexed), driven by CSR → Property → Property Tax (Annual Payment + Confidence). Add three new template field keys with strict per-property isolation.

## New Field Keys (to add to Admin → Field Dictionary)

| Field Key | Source | Type | Behavior |
|---|---|---|---|
| `pr_pt_annualTaxes_N` | `propertytax{K}.annual_payment` (matched to property{N}) | currency | Formatted currency (e.g. `$10,000.00`); blank if empty |
| `pr_pt_actual_N_glyph` | `propertytax{K}.tax_confidence` | text | `☑` if Confidence == "Actual", else `☐` |
| `pr_pt_estimated_N_glyph` | `propertytax{K}.tax_confidence` | text | `☑` if Confidence == "Estimated", else `☐` |

Also publish boolean siblings `pr_pt_actual_N` and `pr_pt_estimated_N` (`"true"`/`"false"`) for `{{#if}}` template use.

`N` aligns with the property sequence already used by other RE851D pr_p_* aliases (1, 2, 3 …).

## Implementation (single file)

**File:** `supabase/functions/generate-document/index.ts`

### Change 1 — Bridge `tax_confidence` along with existing tax fields
In the existing RE851D propertytax address-keyed pre-bridge block (around line 1060), extend `TAX_FIELDS` to include `tax_confidence`:
```ts
const TAX_FIELDS = ["annual_payment", "delinquent", "delinquent_amount", "source_of_information", "tax_confidence"];
```
This ensures `propertytax{srcIdx}.tax_confidence` is copied to `propertytax{destIdx}.tax_confidence` so per-property lookup by the property's index works.

### Change 2 — Per-property publisher block
Inside the existing `for (const idx of sortedPropIndices)` loop (right after the existing `propertytax_annual_payment_${idx}` publisher around line 1146), add a new isolated block:

```ts
// RE851D ANNUAL PROPERTY TAXES — per-property publisher
{
  // Annual Payment → currency
  const annual =
    fieldValues.get(`propertytax${idx}.annual_payment`) ||
    fieldValues.get(`${prefix}.annual_property_taxes`) ||
    fieldValues.get(`${prefix}.annual_tax`);
  if (annual?.rawValue !== undefined && annual.rawValue !== null && String(annual.rawValue) !== "") {
    fieldValues.set(`pr_pt_annualTaxes_${idx}`, {
      rawValue: annual.rawValue,
      dataType: "currency",
    });
  }

  // Confidence → ACTUAL / ESTIMATED checkboxes
  const conf = String(
    fieldValues.get(`propertytax${idx}.tax_confidence`)?.rawValue ||
    fieldValues.get(`${prefix}.tax_confidence`)?.rawValue ||
    ""
  ).trim().toLowerCase();

  const isActual    = conf === "actual";
  const isEstimated = conf === "estimated";

  fieldValues.set(`pr_pt_actual_${idx}`,          { rawValue: isActual    ? "true" : "false", dataType: "boolean" });
  fieldValues.set(`pr_pt_estimated_${idx}`,       { rawValue: isEstimated ? "true" : "false", dataType: "boolean" });
  fieldValues.set(`pr_pt_actual_${idx}_glyph`,    { rawValue: isActual    ? "☑" : "☐",        dataType: "text" });
  fieldValues.set(`pr_pt_estimated_${idx}_glyph`, { rawValue: isEstimated ? "☑" : "☐",        dataType: "text" });
}
```

### Change 3 — Anti-fallback shield
Add `pr_pt_actual_`, `pr_pt_estimated_`, `pr_pt_annualTaxes_` to the existing RE851D anti-fallback shield list (the block that defaults unpublished `pr_*_N` glyphs to `☐` so empty per-index tags don't bleed from idx=1). For `_glyph` defaults publish `☐`; the boolean form defaults to `"false"`; `pr_pt_annualTaxes_N` stays empty (no fallback).

## Validation Rules (encoded in logic)
- Confidence null/empty → both checkboxes `☐` (mutual exclusivity guaranteed since only one branch can match).
- Annual Payment blank → `pr_pt_annualTaxes_N` not published (template renders blank).
- Per-property isolation enforced by the existing address-keyed bridge — no cross-index bleed.
- Currency formatted via the existing `dataType: "currency"` pipeline.

## Template usage (for the Word template)
```
$ {{pr_pt_annualTaxes_1}}    {{pr_pt_actual_1_glyph}} ACTUAL    {{pr_pt_estimated_1_glyph}} ESTIMATED
$ {{pr_pt_annualTaxes_2}}    {{pr_pt_actual_2_glyph}} ACTUAL    {{pr_pt_estimated_2_glyph}} ESTIMATED
...
```

## Out of Scope
- No UI changes.
- No DB schema / migration changes.
- No changes to existing aliases (`propertytax_annual_payment_N` remains for backward compatibility).
- No changes to other document templates.
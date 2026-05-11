## RE851D — Per-property "Multiple Properties" YES/NO glyphs

### Current state
The publisher at `supabase/functions/generate-document/index.ts` lines 1116–1138 already computes a global "multiple properties" decision and writes four global aliases:
- `pr_p_multipleProperties_yes` / `_no` (booleans)
- `pr_p_multipleProperties_yes_glyph` / `_no_glyph` (☑ / ☐)

It uses `realPropertyCount = realPropertyIndices.length` (only counts properties with at least one non-empty identifier field — exactly what the requirement calls "CSR Property collection, no hidden/empty rows").

What's missing: the **`_{N}`-suffixed** variants the template expects:
- `{{pr_p_multipleProperties_yes_glyph_1}}`, `_2`, `_3`, …
- `{{pr_p_multipleProperties_no_glyph_1}}`, `_2`, …

### Change (additive, single block)
Inside the same `{ ... }` block (≈ lines 1129–1138), after the four global aliases are set, loop over `sortedPropIndices` and publish the same four values per index:

- `pr_p_multipleProperties_yes_${idx}`        → boolean
- `pr_p_multipleProperties_no_${idx}`         → boolean
- `pr_p_multipleProperties_yes_glyph_${idx}`  → "☑" / "☐"
- `pr_p_multipleProperties_no_glyph_${idx}`   → "☑" / "☐"

Every index gets the **same** value (driven by the global `isMultiple` flag), so all property sections render YES when count > 1 and NO when count ≤ 1, matching the requirement table.

Also publish a global `total_property_count` numeric so templates can use `{{#if (gt total_property_count 1)}}…{{/if}}` if preferred.

### Files touched
- `supabase/functions/generate-document/index.ts` — extend the existing `pr_p_multipleProperties` block only. No template, dictionary, schema, UI, or other doc-gen changes.

### Validation
After deploy, regenerate RE851D for deals with 1, 2, and 3 properties:
- 1 property → property #1 shows ☐ YES / ☑ NO
- 2 properties → both #1 and #2 show ☑ YES / ☐ NO
- 3 properties → all three show ☑ YES / ☐ NO
- Edge logs still print the existing `[RE851D] multipleProperties: realCount=…` line; no extra noise.

### Note on template
You don't need to change the template. The existing `{{pr_p_multipleProperties_yes_glyph_{N}}}` / `_no_glyph_{N}` tags will resolve once the per-index values are published. If you want to consolidate to a single conditional, `{{#if (gt total_property_count 1)}}` will also work after this change.

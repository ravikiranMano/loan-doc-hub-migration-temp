## Plan — RE851D Property Income Mapping (Yes/No + Annual $)

Scope: `supabase/functions/generate-document/index.ts` only. RE851D template gating; no UI, schema, or other-template impact.

### 1. Publish per-property income aliases
Inside the existing RE851D-gated per-property publisher loop (after the `propertyN.net_monthly_income` re-bridge already runs), for each `idx` in `sortedPropIndices`:

- Read raw value from `property{idx}.net_monthly_income` (already bridged by lines 311–316).
- Parse to a clean number (strip `$`, commas; treat null/blank/invalid as `0`).
- Publish three aliases, strictly per-index, no cross-property fallback:
  - `pr_p_netMonthlyIncome_{N}` → numeric string (raw monthly value)
  - `pr_p_incomeGenerating_{N}` → `"Yes"` if `net > 0`, else `"No"` (plain text, NOT boolean, NOT glyph)
  - `pr_p_grossAnnualIncome_{N}` → `net * 12` as a plain numeric value (no `$`, no formatting — template prefixes `$` literal)

### 2. Allow `_N → _K` rewrite
Add to `RE851D_INDEXED_TAGS` (line 3655+):
- `pr_p_netMonthlyIncome_N`
- `pr_p_incomeGenerating_N`
- `pr_p_grossAnnualIncome_N`

This lets templates author the bare `_N` form inside repeating PROPERTY #K blocks and have the existing rewriter substitute the property index.

### 3. Anti-fallback shield
Add the same three bases to the `SHIELD_BASES` list (line 1776+) so unpublished indices receive an empty string and cannot fall back through `canonical_key` to property #1's value.

### 4. Diagnostic log
Add a single `console.log` per property of the form:
`[RE851D] income prop#{N}: netMonthly={raw} → incomeGenerating={Yes|No} grossAnnual={net*12}`

### 5. Validation
- Regenerate RE851D for a deal with mixed properties (some with income, some blank/zero).
- Confirm each PROPERTY #K block renders the correct `Yes`/`No` and numeric annual amount, with no cross-property bleed and no stray `{{pr_p_incomeGenerating_N}}` literals.

### Out of scope (will NOT touch)
- UI / Property Details form
- Field dictionary / migrations
- Existing checkbox/glyph publishers
- Any other RE851D mappings or other templates

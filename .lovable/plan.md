## Backend-only calculated field: `oo_netAnnualIncome`

Mirrors the existing `oo_totalIncome` / `oo_totalExpenses` pattern — backend-only, hidden from UI, available to templates as `{{oo_netAnnualIncome}}`.

### Formula
```
oo_netAnnualIncome = ((oo_totalIncome || 0) * 12) - (oo_totalExpenses || 0)
```
Null/empty inputs are treated as 0; output is currency-formatted.

### Changes

1. **Migration** — `field_dictionary` insert
   - `field_key`: `oo_netAnnualIncome`
   - `label`: "Net Annual Income"
   - `section`: `origination_fees`
   - `data_type`: `currency`
   - `is_calculated`: `true`
   - `allowed_roles`: `{}` (hidden from UI, same as the other two)
   - `calculation_dependencies`: `{oo_totalIncome, oo_totalExpenses}`
   - `calculation_formula`: `((oo_totalIncome || 0) * 12) - (oo_totalExpenses || 0)`
   - Plus matching `merge_tag_aliases` row so `{{oo_netAnnualIncome}}` resolves.

2. **`supabase/functions/generate-document/index.ts`**
   Immediately after the existing `oo_totalIncome` and `oo_totalExpenses` injection blocks, add a third block that:
   - Reads the just-published numeric values for `oo_totalIncome` and `oo_totalExpenses` from `fieldValues` (defaulting missing/non-numeric to 0).
   - Computes `net = (income * 12) - expenses`.
   - Sets `fieldValues.set("oo_netAnnualIncome", { rawValue: net, dataType: "currency" })`.
   - Logs `[generate-document] Computed oo_netAnnualIncome = income*12 − expenses = …`.
   - Then redeploy the edge function.

### Constraints honored
- No UI surface (no form, list, or admin screen touched).
- No change to existing income/expense calculations or any other field.
- No schema changes beyond the additive dictionary + alias row.
- Backward compatible — purely additive.

### Validation
Regenerate any document containing `{{oo_netAnnualIncome}}`:
- Both totals empty → `$0.00`
- Income only (e.g. 1,000) → `$12,000.00`
- Income + expenses (e.g. 1,000 / 500) → `$11,500.00`
- Edge logs show the computed line.

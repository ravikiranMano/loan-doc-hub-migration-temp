## Root cause

The UI persists the eight values under different dictionary keys than the RE885 template expects.

| Template tag | UI persists under (dictionary alias) |
|---|---|
| `of_int_days` | `of_int_days` (via `origination_fees.901_interest_for_days_days`) — alias exists |
| `of_int_pd` | `of_int_pd` (via `origination_fees.901_interest_for_days_per_day`) — alias exists |
| `of_haz_mon` | `of_fe_hazardInsuraMonths` (`origination_fees.1001_hazard_insurance_months`) — **mismatch** |
| `of_haz_amt` | `of_fe_hazardInsuraPerMonth` (`origination_fees.1001_hazard_insurance_per_month`) — **mismatch** |
| `of_mi_mon` | `of_fe_mortgageInsuraMonths` (`origination_fees.1002_mortgage_insurance_months`) — **mismatch** |
| `of_mi_amt` | `of_fe_mortgageInsuraPerMonth` (`origination_fees.1002_mortgage_insurance_per_month`) — **mismatch** |
| `of_tax_mon` | `of_fe_coProperTaxesMonths` (`origination_fees.1004_co_property_taxes_months`) — **mismatch** |
| `of_tax_amt` | `of_fe_coProperTaxesPer` (`origination_fees.1004_co_property_taxes_per_month`) — **mismatch** |

The UI saves correctly; the template tags simply don't resolve because no one publishes the short `of_haz_*`/`of_mi_*`/`of_tax_*` aliases at generation time. The `of_int_*` pair is already aliased via `legacyKeyMap.ts`, but we'll defensively re-publish from the dotted form too.

## Fix (single, minimal, additive)

In `supabase/functions/generate-document/index.ts`, inside the existing **RE885 alias publisher** block (around line 719–795), add one new section that resolves the source value for each of the 8 fields and publishes the short alias (only when not already present, matching the pattern used for `of_re_estimatedClosing`, `of_fe_creditLifediInsuraLabel`, etc.).

For each of the 8 outputs, source resolution order:

1. The short alias itself (already populated → no-op).
2. The current dictionary alias (e.g. `of_fe_hazardInsuraMonths`).
3. The dotted UI key (e.g. `origination_fees.1001_hazard_insurance_months`).

Mapping table to publish:

| Output alias | Dictionary alias source | Dotted UI key source | dataType |
|---|---|---|---|
| `of_int_days` | `of_int_days` | `origination_fees.901_interest_for_days_days` | number |
| `of_int_pd` | `of_int_pd` | `origination_fees.901_interest_for_days_per_day` | currency |
| `of_haz_mon` | `of_fe_hazardInsuraMonths` | `origination_fees.1001_hazard_insurance_months` | number |
| `of_haz_amt` | `of_fe_hazardInsuraPerMonth` | `origination_fees.1001_hazard_insurance_per_month` | currency |
| `of_mi_mon` | `of_fe_mortgageInsuraMonths` | `origination_fees.1002_mortgage_insurance_months` | number |
| `of_mi_amt` | `of_fe_mortgageInsuraPerMonth` | `origination_fees.1002_mortgage_insurance_per_month` | currency |
| `of_tax_mon` | `of_fe_coProperTaxesMonths` | `origination_fees.1004_co_property_taxes_months` | number |
| `of_tax_amt` | `of_fe_coProperTaxesPer` | `origination_fees.1004_co_property_taxes_per_month` | currency |

Add a single `console.log` line summarizing the eight resolved values (mirroring the existing RE885 publisher log) for production traceability.

## Constraints honored

- **No UI changes.** Forms, save flow, and field dictionary entries stay exactly as-is.
- **No DB schema changes.** No migrations, no new tables/columns, no edits to `field_dictionary` rows.
- **No template changes.** RE885 docx is untouched.
- **No impact on other doc fields.** Aliases are written only when the target key is empty, mirroring every existing publisher in this block.
- **Idempotent & safe**: missing/null source values → no alias published (so SDT defaults / blanks behave as today).

## Files touched

- `supabase/functions/generate-document/index.ts` — one additive block inside the existing RE885 alias publisher region (~15–25 lines).

## Validation

1. Open an existing deal with values entered in Origination Fees rows 901, 1001, 1002, 1004.
2. Generate RE885.
3. Inspect edge function logs — new line shows all 8 resolved values.
4. Confirm the 8 placeholders in the produced .docx render the typed values, and that other RE885 fields are unchanged.


## Scope

Add exactly 2 blank custom rows to the bottom of HUD-1 sections **800**, **900**, and **1100** in `Other Origination → Origination Fees`. Each row uses the existing 7-column grid (HUD-1 # blank, Description, Comment slot, Paid to Others, Paid to Broker, Include in APR, Paid to Company). Persist via the existing dictionary/JSONB pipeline (no new tables) and expose merge tags so document templates can pick them up without affecting any existing template that doesn't reference them.

No other UI, schema, or generation logic changes.

## 1. UI — `src/components/deal/OriginationFeesForm.tsx`

- Extend `FIELD_KEYS` with 6 rows × 5 fields each (description + 2 currency + 2 booleans). Storage keys follow the existing convention:
  - `origination_fees.800_customN_description | _others | _broker | _apr | _paid_to_company`
  - `origination_fees.900_customN_description | ...`
  - `origination_fees.1100_customN_description | ...`
- In the JSX, immediately after row 812 (line 630), row 905 (line 640), and row 1108 (line 657), add 2 calls to the existing `renderFeeRow(...)` helper:
  - HUD # cell → empty string `''`
  - `labelKey` arg → the new `_description` key (renders the "Enter Description" text input in the Item Description cell exactly like all other rows)
  - `commentKey` arg → `undefined` (the screenshot rows show no separate comment column for custom rows; the description field is the single free-text input as specified)
  - `keys` → others / broker / apr / paidToCompany pointing at the 4 new keys
- No new components, styling, or layout changes — reusing `renderFeeRow` guarantees identical column structure, spacing, and behavior (currency mask, checkbox, DirtyFieldWrapper, disabled state).

## 2. Persistence — field_dictionary seed migration

Per the project's storage contract (composite `{prefix}::{field_dictionary_id}` JSONB keys in `deal_section_values`), each new UI key MUST have a `field_dictionary` row or it is silently skipped on save.

Add one migration that inserts 30 dictionary rows (6 rows × 5 fields) into `field_dictionary` under section `origination_fees`:

| field_key | label | data_type |
|---|---|---|
| `origination_fees.800_custom1_description` | 800 Custom Row 1 Description | text |
| `origination_fees.800_custom1_others` | 800 Custom Row 1 Paid to Others | currency |
| `origination_fees.800_custom1_broker` | 800 Custom Row 1 Paid to Broker | currency |
| `origination_fees.800_custom1_apr` | 800 Custom Row 1 Include in APR | boolean |
| `origination_fees.800_custom1_paid_to_company` | 800 Custom Row 1 Paid to Company | boolean |
| …repeat for `800_custom2`, `900_custom1/2`, `1100_custom1/2` | | |

Migration uses `ON CONFLICT (field_key) DO NOTHING` so it is idempotent and touches no existing rows. No new tables, no schema changes, no GRANT changes (existing `field_dictionary` grants apply).

This automatically gives us: save on file save, persistence across logout/refresh/draft/reopen/status change, and correct restore of currency and checkbox state — all through the existing `useDealFields` / `deal_section_values` plumbing already used by every other row in this form.

## 3. Document generation — merge tags

The spec requires merge field names like `hud800_custom1_description`, etc. The platform already supports surfacing dictionary values under alternate tag names via `merge_tag_aliases`.

Add a second small data-seed migration that inserts 30 rows into `merge_tag_aliases`:

| tag_name | field_key | tag_type |
|---|---|---|
| `hud800_custom1_description` | `origination_fees.800_custom1_description` | merge_tag |
| `hud800_custom1_paid_to_others` | `origination_fees.800_custom1_others` | merge_tag |
| `hud800_custom1_paid_to_broker` | `origination_fees.800_custom1_broker` | merge_tag |
| `hud800_custom1_include_apr` | `origination_fees.800_custom1_apr` | merge_tag |
| `hud800_custom1_paid_to_company` | `origination_fees.800_custom1_paid_to_company` | merge_tag |
| …repeat for the other 5 rows (`hud800_custom2_*`, `hud900_custom1/2_*`, `hud1100_custom1/2_*`) | | |

Also idempotent (`ON CONFLICT DO NOTHING`). Because the resolver only acts when a template literally contains one of these tag names, **no existing template's output changes** — this is the explicit "do not affect current document generation logic" guarantee.

No edge-function code changes. The existing tag-parser and field-resolver already handle alias→dictionary→`deal_section_values` lookups and apply standard currency/boolean formatting via `_shared/formatting.ts`, matching what is used by every other 800/900/1100 row today.

## 4. Out of scope (explicitly NOT changing)

- No changes to Subtotal/Total calculations, RE 885 page, Compensation to Broker, Payment of Other Obligations, Payment to Existing Liens, 1000/1200/1300 sections.
- No changes to existing field keys, dictionary rows, aliases, or templates.
- No changes to RLS, grants, edge functions, or `recomputeLenderPayments`.

## Files touched

- `src/components/deal/OriginationFeesForm.tsx` — add keys + 6 `renderFeeRow` calls.
- New migration: insert 30 `field_dictionary` rows.
- New migration: insert 30 `merge_tag_aliases` rows.

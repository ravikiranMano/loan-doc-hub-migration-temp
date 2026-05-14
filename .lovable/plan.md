## Diagnosis (DL-2026-0250)

The "ARE TAXES DELINQUENT?" YES/NO renders against the wrong property because the per-property publisher reads `propertytax{idx}.delinquent` positionally. Each Property Tax record actually carries a `propertytax{N}.property` dropdown that binds it to a specific Property by display string (e.g. `"Test property 2 - MG Road, Noida, CA, 98454"`).

For this deal:

| Tax record | Linked property | delinquent | amount |
|---|---|---|---|
| propertytax1 | Property **2** | true  | 6578  |
| propertytax2 | Property **1** | false | —     |
| propertytax3 | Property **4** | true  | 23844 |
| propertytax4 | Property **5** | false | —     |
| (none)       | Property **3** | —     | —     |

So `pr_pt_delinquent_2` must come from `propertytax1`, not `propertytax2`. Same problem affects `pr_pt_delinquentAmount_${idx}` and the YES/NO glyph aliases.

## Code change — single file

`supabase/functions/generate-document/index.ts`, lines 1491–1515 (per-property delinquent publisher only — no other publisher is touched).

### 1. Build a one-time `propertyIndexByTaxIndex` map (once, before the per-property loop)

For tax indices 1..N (scan up to 10 to be safe), read `propertytax{T}.property` (string) and match it against each `property{P}` record using a normalized fingerprint built from the same fields the UI uses to render the dropdown label:
- `property{P}.description`, `property{P}.street`, `property{P}.city`, `property{P}.state`, `property{P}.zip`

Match strategy (in order, all case-insensitive, whitespace-collapsed):
1. Exact match of full label `"{description} - {street}, {city}, {state}, {zip}"`.
2. Substring match where label contains `description` AND (`street` OR `zip`) of a property — disambiguates partial labels.
3. If still unresolved, leave that tax record unmapped (do NOT fall back to positional — that's the current bug).

Result: `Map<taxIdx:number, propertyIdx:number>` plus the inverse `Map<propertyIdx, taxIdx>`.

Add a debugLog summarizing the resolved mapping (e.g. `[RE851D] propertytax→property mapping: {1→2, 2→1, 3→4, 4→5}`).

### 2. Rewrite the per-property delinquent publisher (lines 1491–1515)

Inside the existing `for (const idx of realPropertyIndices)` loop, replace the block that currently reads `propertytax${idx}.delinquent` with a lookup via the inverse map:

```ts
const taxIdx = propertyToTax.get(idx); // number | undefined
const delinqRaw = taxIdx !== undefined
  ? fieldValues.get(`propertytax${taxIdx}.delinquent`)?.rawValue
  : fieldValues.get(`${prefix}.delinquent`)?.rawValue; // legacy property{N}.delinquent fallback only
```

Same change for `propertytax${taxIdx}.delinquent_amount`. The `${prefix}.delinquent` / `${prefix}.delinquent_amount` legacy fallbacks remain in place for back-compat with deals that have no tax dropdown set.

The glyph emission, empty-slot defaults loop (lines 1920–1928), `_N` key registration (line 4929), and `SUFFIXED_BASES` (line 6310) remain unchanged — they already handle missing/false correctly.

### 3. No other publishers, schema, UI, template, or DOCX changes.

## Verification

After deploy and regeneration of RE851D for DL-2026-0250:
- PROPERTY #1 (Sunset Plaza)  → ☐ YES   ☑ NO  (from propertytax2)
- PROPERTY #2 (Test property 2) → ☑ YES   ☐ NO  + amount $6,578.00  (from propertytax1)
- PROPERTY #3 (Property 3)    → ☐ YES   ☑ NO  (no tax record)
- PROPERTY #4 (Property 4)    → ☑ YES   ☐ NO  + amount $23,844.00  (from propertytax3)
- PROPERTY #5 (Property 5)    → ☐ YES   ☑ NO  (from propertytax4)

Edge function logs should show the `propertytax→property mapping` debugLog with the resolved map.

## Out of scope

- UI / Property Tax form changes.
- Schema, field_dictionary, or DOCX template edits.
- Any other publisher (annual_payment, actual/estimated confidence, etc.) — those will be revisited in a follow-up if the user reports the same wrong-property symptom there. This change is strictly limited to delinquent + delinquent_amount.

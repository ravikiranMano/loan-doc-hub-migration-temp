## RE851D — Fix "Is there Additional Securing Property?" checkbox count

### Current state

`supabase/functions/generate-document/index.ts` already publishes `pr_p_multipleProperties_yes/_no/_glyph` aliases (line ~1063) and runs a question-anchored safety pass (line ~4384). Both derive the count from `propertyIndices`, a `Set<number>` populated by scanning every `property{N}.*` key in `fieldValues` (line ~984).

### Problem

`propertyIndices` counts an index as soon as **any** `property{N}.<field>` key exists in `fieldValues` — even if every value for that property is empty/blank. Stale or never-populated property slots (common when a property record is removed from CSR but the section row leaves zeroed keys behind) inflate the count, so YES is checked when only one real property exists.

Additionally, `propertyIndices.add(1)` (line 992) unconditionally seeds index 1, which is correct for address auto-compute but means the count is never below 1 — that's fine for the NO branch but should not affect multi-detection.

### Fix

Introduce a single derived `realPropertyCount` based on properties that have at least one non-empty meaningful identifier field, and use it for both the publisher and the safety pass.

1. After `propertyIndices` is built (around line 992), compute:
   ```ts
   const PROP_PRESENCE_FIELDS = ["address", "street", "city", "state", "zip", "county", "legal_description"];
   const realPropertyIndices = [...propertyIndices].filter((idx) => {
     const prefix = `property${idx}`;
     return PROP_PRESENCE_FIELDS.some((f) => {
       const v = fieldValues.get(`${prefix}.${f}`)?.rawValue;
       return v !== undefined && v !== null && String(v).trim() !== "";
     });
   }).sort((a, b) => a - b);
   const realPropertyCount = realPropertyIndices.length;
   ```

2. Update the publisher block (lines 1063–1071):
   - `isMultiple = realPropertyCount > 1`
   - `isSingle  = realPropertyCount <= 1` (covers both 0 and 1 → NO checked, per spec table "≤ 1 → NO ✅")
   - Keep the same four alias keys and dataTypes so the template binding is unchanged.

3. Update the safety pass (line ~4391):
   - Replace `[...propertyIndices].sort(...).slice(0,5).length` with `realPropertyCount`.
   - Keep all anchor regex / overlap guards unchanged.

4. Add a single debug log line: `RE851D multipleProperties: realCount=<n> rawIndices=<list> realIndices=<list> → YES=<bool> NO=<bool>`.

### Out of scope

- No UI changes, no schema changes, no template edits.
- `addressToPropIndex`, per-property publishers, lien/tax mappings, and all other RE851D logic remain untouched.
- Mutual exclusivity is already guaranteed by deriving both flags from the same boolean.

### Validation

- 0 properties → YES ☐, NO ☑
- 1 property  → YES ☐, NO ☑
- 2+ properties → YES ☑, NO ☐
- Stale empty `property2.*` keys with no address/street/etc. → counted as 1, NO ☑.

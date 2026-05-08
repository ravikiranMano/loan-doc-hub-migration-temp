## RE851D — Annual Property Taxes Per‑Property Population Fix

### Root cause (verified against this deal)

Deal `db7517e9…` has:
- 3 Property records: `property2.street = "M .G Road Pune"`, `property3.street = "Ring road"`, `property4.street = "Aishbhag"`.
- 1 Property Tax record: `propertytax1.annual_payment = 24234`, `tax_confidence = "Estimated"`, `propertytax1.property = "Test property 1 - MG Road, Noida, 98454"`.

What the edge function does today (`supabase/functions/generate-document/index.ts`):
1. Auto‑computes `property{N}.address` from street/city/state/zip (lines 1011‑1030).
2. Builds `addressToPropIndex` from `property{N}.address` and tries to bridge `propertytax{srcIdx} → propertytax{destIdx}` by exact / substring address match (lines 1101‑1158).
3. Per‑property publisher (lines 1214‑1248) reads `propertytax{idx}.annual_payment` / `.tax_confidence`. If missing, falls back to `property{idx}.*`, then to a global single‑record fallback (`singleTaxRecord` → always uses `propertytax1.*`).

Two bugs cause the user‑reported behavior:

- **B1 — Address bridge too strict.** The tax row's `propertytax1.property` value is the UI dropdown label (e.g. `"Test property 1 - MG Road, Noida, 98454"`), which contains a **prefix** before the address and may also include borrower name. The current code only checks `taxString.includes(propertyAddress)`. It never tries the reverse direction or partial token overlap (street + city / street + zip), so legitimate matches between the tax row and a property are silently dropped.
- **B2 — Single‑record fallback is global, not per‑property.** When only one tax record exists, the publisher applies its values to **every** property index in the loop (P1, P2, P3 …). This violates the user's spec ("each property renders independently; unmatched ⇒ blank"), and on this deal it would put `24234 + Estimated` on all three properties even though the tax row clearly references only one of them.

When **B1** fires (no match) and **B2** is then disabled, the output is blank everywhere — exactly what the user is seeing — because the tax row also points at an address none of the surviving properties has.

### Fix (edge function only — no UI, schema, template, or new field keys)

All changes confined to `supabase/functions/generate-document/index.ts`, RE851D path only (already gated by `/851d/i.test(template.name)`).

1. **Strengthen the address bridge (B1)** in the block at lines 1101‑1158:
   - Build the property address index using the **already‑computed** `property{N}.address` plus a tokenized form (street + city, street + zip, street alone) — all normalized via the existing `normAddr`.
   - For each `propertytax{srcIdx}.property` value, try in order:
     a. exact normalized match,
     b. property address is a substring of the tax row string (current behavior),
     c. tax row string is a substring of the property address (handles cases where tax row stores only the street),
     d. token overlap: street **and** (city OR zip) both appear in the tax row string.
   - First match wins; ties resolved by lowest property index. Log every bridged pair (already done) and every unbridged tax row with the candidate property addresses considered, so future data issues are diagnosable from edge logs.

2. **Make the per‑property publisher strict (B2)** at lines 1214‑1248:
   - Remove the global `singleTaxRecord` fallback that uses `propertytax1.*` for every index.
   - Resolution chain per property index becomes:
     1. `propertytax{idx}.annual_payment` / `.tax_confidence` (set directly or copied in by the bridge),
     2. `property{idx}.annual_property_taxes` / `.annual_tax` / `.propertytax_annual_payment` and `property{idx}.tax_confidence` (legacy in‑property storage).
   - If neither yields a value, **publish nothing** for `pr_pt_annualTaxes_{idx}` and emit the unchecked glyphs `pr_pt_actual_{idx}_glyph = ☐` / `pr_pt_estimated_{idx}_glyph = ☐` plus boolean `false`. This satisfies "if confidence is blank both unchecked; if amount blank no value" and prevents cross‑mapping.

3. **Validation guarantees baked into the publisher**:
   - Only one of `pr_pt_actual_{idx}` / `pr_pt_estimated_{idx}` can ever be `true` (already enforced; preserved).
   - `pr_pt_annualTaxes_{idx}` is only `set()` when the resolved amount is non‑empty (preserved).
   - Each property index resolves independently; no value from `propertytax{k}` ever reaches `pr_pt_*_{n}` unless `k == n` after the bridge.

4. **Memory update**: revise `mem://features/document-generation/re851d-annual-property-taxes-mapping` to record the stricter per‑index contract and the four‑step address bridge so future regressions are caught.

### Out of scope

- No UI changes (the Property Tax modal already captures Property, Annual Payment, Confidence correctly).
- No new field‑dictionary entries; no new merge tags. Template keeps using `{{pr_pt_annualTaxes_N}}`, `{{pr_pt_actual_N_glyph}}`, `{{pr_pt_estimated_N_glyph}}`.
- No DB migration; no schema change.
- No change to `singleTaxRecord` style logic anywhere outside this RE851D tax block.

### Expected behavior after fix (this deal)

- If the tax row's `property` string can be matched (e.g. user re‑selects the correct property in the modal so it shares street/city/zip with one of property2/3/4), only that property index renders `24234 + ☑ ESTIMATED`; the other two render blank amount and `☐ ACTUAL ☐ ESTIMATED`.
- If no match is possible (current data state), all three properties render blank — which is the correct, spec‑compliant output instead of duplicating `24234` across all three.

### Verification

After deploy, regenerate the document for this deal and inspect edge function logs for the new `[generate-document] RE851D propertytax bridge` lines plus the per‑index `pr_pt idx=… annual=… confidence=…` lines to confirm strict per‑property resolution.

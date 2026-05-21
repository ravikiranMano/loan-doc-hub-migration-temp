
# Fix Authorized Signer in Certification_of_Purpose_Occupancy_Material_Facts (V6 / Entity)

## Problem

The uploaded `Certification_of_Purpose_Occupancy_Material_Facts_V6` template renders:

```
Authorized Signer: {{ld_p_authorizedFirst}} {{ld_p_authorizedMiddle}} {{ld_p_authorizedLast}}
```

`ld_p_authorized*` are the **Lender's** Authorized Party fields — for DL‑2026‑0257 they yield `Len Auth David J Becham`. The correct source is the deal's **Additional Guarantor** participant (e.g. AG‑00011 → "Adtn Guarantor Marc Boucher").

## Root cause

`supabase/functions/generate-document/index.ts` line 1025‑1028 unconditionally publishes the lender's authorized party into the `ld_p_authorized*` keys for every template. The Certification template happens to reference those same keys for its "Authorized Signer" line, so it picks up the lender values.

The Additional Guarantor publisher (lines 883‑938) already exists and emits `ag_p_fullName`, `ag_p_first`, `ag_p_middle`, `ag_p_last` (note: `ag_p_first`, not `ag_p_firstName`).

## Fix scope — one narrow, template‑scoped override (no .docx edits)

Editing the stored .docx template would require a separate one‑off patch function and would not retroactively fix already‑uploaded copies. A runtime override is cleaner and "works for all the files" automatically.

### `supabase/functions/_shared/types.ts`
No changes.

### `supabase/functions/generate-document/index.ts`

1. **Add template gate** alongside the existing ones at line ~146:

   ```ts
   const isTemplateCertOfPurpose =
     /certification[_\s-]*of[_\s-]*purpose|purpose[_\s-]*occupancy[_\s-]*material[_\s-]*facts/i
       .test(template.name || "");
   ```

2. **Override `ld_p_authorized*` with the Additional Guarantor's name for this template only.** Insert this block *after* the AG publisher (after line 938) and *after* the lender authorized‑party `forceSet` block (after line 1028) — placement after both guarantees AG wins regardless of resolution order. Concretely, add it immediately after the AG publisher closes (line 938) but re‑apply unconditionally near end of resolution (a safe spot is just before `debugLog(...Resolved ${fieldValues.size}...)` at line 1395):

   ```ts
   if (isTemplateCertOfPurpose) {
     const agFirst  = String(fieldValues.get("ag_p_first")?.rawValue  ?? "").trim();
     const agMiddle = String(fieldValues.get("ag_p_middle")?.rawValue ?? "").trim();
     const agLast   = String(fieldValues.get("ag_p_last")?.rawValue   ?? "").trim();
     const agFull   = String(fieldValues.get("ag_p_fullName")?.rawValue ?? "").trim();

     if (agFirst || agLast || agFull) {
       // Route the Certification template's Authorized Signer line to the
       // Additional Guarantor instead of the lender's authorized party.
       fieldValues.set("ld_p_authorizedFirst",  { rawValue: agFirst,  dataType: "text" });
       fieldValues.set("ld_p_authorizedMiddle", { rawValue: agMiddle, dataType: "text" });
       fieldValues.set("ld_p_authorizedLast",   { rawValue: agLast,   dataType: "text" });

       // Also publish the aliases the user-supplied prompt referenced, so
       // future revisions of this template can switch to ag_p_firstName / 
       // ag_p_lastName without further code changes.
       fieldValues.set("ag_p_firstName", { rawValue: agFirst, dataType: "text" });
       fieldValues.set("ag_p_lastName",  { rawValue: agLast,  dataType: "text" });

       debugLog(`[generate-document] Cert_of_Purpose: ld_p_authorized* overridden with AG "${agFull}"`);
     }
   }
   ```

3. **No change** to the global lender authorized‑party publisher (lines 1025‑1028). Other templates that legitimately want the lender's authorized party keep working.

## Files NOT changed

- Template .docx files in storage — untouched. The runtime override produces the correct output for every existing copy of the Certification template (V1…Vn, Entity/Individual variants alike) because the gate is regex‑based on `template.name`.
- No schema, UI, field_dictionary, or `field-resolver.ts` changes. AG publisher already exists; we just re‑route the three lender keys for this one template family.
- No other templates affected (gated strictly by `isTemplateCertOfPurpose`).

## Verification

1. Deploy `generate-document`.
2. For deal **DL‑2026‑0257** generate `Certification_of_Purpose_Occupancy_Material_Facts_V6_-_Entity`:
   - Expected: `Authorized Signer: Adtn  Guarantor Marc Boucher`  (middle blank collapses to a single extra space).
3. Generate any non‑Certification template (e.g. RE885, RE851D, Formal Request) and confirm `{{ld_p_authorizedFirst/Middle/Last}}` still resolves to the lender's authorized party.
4. Generate the Certification template on a deal with **no** Additional Guarantor — the override is skipped (guarded by `if (agFirst || agLast || agFull)`) so behavior is identical to today (safe fallback).


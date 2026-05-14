## Goal
Replace `{{#if propertytax.delinquent}}` conditionals in the RE851D template with pre-resolved, per-property tags so the renderer never evaluates conditionals and each of 5 property slots is independent.

## New template tags (per property index N = 1..5)
- `{{pr_pt_delinquent_yes_glyph_N}}` → "☑" or "☐"
- `{{pr_pt_delinquent_no_glyph_N}}`  → "☑" or "☐"
- `{{pr_pt_delinquentAmount_N}}`     → currency string when delinquent=true, else ""

(The DOCX template itself will be updated separately by the user — this plan covers the server-side publisher so the tags resolve correctly once the template uses them.)

## Code changes — single file
`supabase/functions/generate-document/index.ts`

### 1. Per-property publisher (extend existing block at ~lines 1410–1490)

Inside the existing `for (const idx of realPropertyIndices)` loop — right after the existing `pr_pt_actual_${idx}` / `pr_pt_estimated_${idx}` publisher (~line 1490) — add:

```ts
// RE851D ARE TAXES DELINQUENT? — per-property publisher.
// Source of truth: propertytax{N}.delinquent (UI checkbox).
// Fallbacks: property{N}.delinquent (legacy). Strict per-index — no
// cross-property fallback. Always emits ☑/☐ glyphs (never blank).
{
  const delinqRaw =
    fieldValues.get(`propertytax${idx}.delinquent`)?.rawValue ??
    fieldValues.get(`${prefix}.delinquent`)?.rawValue;
  const isDelinq = truthy(delinqRaw); // existing helper used elsewhere in file
  fieldValues.set(`pr_pt_delinquent_${idx}`,            { rawValue: isDelinq ? "true" : "false", dataType: "boolean" });
  fieldValues.set(`pr_pt_delinquent_yes_glyph_${idx}`,  { rawValue: isDelinq ? "☑" : "☐",        dataType: "text" });
  fieldValues.set(`pr_pt_delinquent_no_glyph_${idx}`,   { rawValue: isDelinq ? "☐" : "☑",        dataType: "text" });

  let amountStr = "";
  if (isDelinq) {
    const amtRaw =
      fieldValues.get(`propertytax${idx}.delinquent_amount`)?.rawValue ??
      fieldValues.get(`${prefix}.delinquent_amount`)?.rawValue;
    if (amtRaw !== undefined && amtRaw !== null && String(amtRaw) !== "") {
      amountStr = String(amtRaw); // formatting layer renders as currency via dataType
    }
  }
  fieldValues.set(`pr_pt_delinquentAmount_${idx}`, {
    rawValue: amountStr,
    dataType: "currency",
  });
}
```

### 2. Empty-slot defaults (anti-fallback shield)

For indices 1..5 NOT in `realPropertyIndices`, defaults must be `☐ YES / ☑ NO / "" amount`. Add a small loop right after the existing `realPropertyIndices` loop closes:

```ts
for (let i = 1; i <= 5; i++) {
  if (realPropertyIndices.includes(i)) continue;
  fieldValues.set(`pr_pt_delinquent_yes_glyph_${i}`, { rawValue: "☐", dataType: "text" });
  fieldValues.set(`pr_pt_delinquent_no_glyph_${i}`,  { rawValue: "☑", dataType: "text" });
  fieldValues.set(`pr_pt_delinquentAmount_${i}`,     { rawValue: "",  dataType: "currency" });
  fieldValues.set(`pr_pt_delinquent_${i}`,           { rawValue: "false", dataType: "boolean" });
}
```

### 3. Register suffixed keys in valid-field-key list (~lines 4891 and 6270)

Add in the `_N` aliases block at ~line 4891 (longest first so `_yes_glyph` wins over bare):
```
"pr_pt_delinquent_yes_glyph_N", "pr_pt_delinquent_no_glyph_N",
"pr_pt_delinquentAmount_N",
"pr_pt_delinquent_N",
```

Add to `SUFFIXED_BASES` at ~line 6270 so `effectiveValidFieldKeys` gets `_1`..`_5`:
```
"pr_pt_delinquent_yes_glyph", "pr_pt_delinquent_no_glyph",
"pr_pt_delinquentAmount", "pr_pt_delinquent",
```

### 4. Deploy `generate-document` edge function.

## Out of scope
- DOCX template edits (user updates separately to replace `{{#if propertytax.delinquent}}…` with the three new tags).
- No schema, UI, or field-dictionary changes.
- No changes to existing `pr_pt_actual` / `pr_pt_estimated` / `pr_pt_annualTaxes` publishers.
- No conditionals retained in template — all glyphs pre-resolved server-side.

## Verification
1. Deploy `generate-document`.
2. Regenerate RE851D for a deal with mixed property tax delinquent flags:
   - Property 1 delinquent=true, amount=1234.56  → "☑ YES   ☐ NO" + "$ 1,234.56"
   - Property 2 delinquent=false                  → "☐ YES   ☑ NO" + "$ "
   - Property 3 (no record)                       → "☐ YES   ☑ NO" + "$ "
3. Confirm no `{{#if}}` survives in the rendered output and no CPU-timeout warnings appear in `generate-document` edge logs.

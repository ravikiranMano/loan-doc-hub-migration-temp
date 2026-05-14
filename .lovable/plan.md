## Goal

Make the RE851D "NAME OF APPRAISER" and "ADDRESS OF APPRAISER" fields render the correct per-property value, with no raw `{{#if}}` syntax leaking into the document. Fix is server-side only in `supabase/functions/generate-document/index.ts` — no DOCX template, schema, UI, or field_dictionary changes.

## Why a server-side fix (not a template edit)

The template currently contains:

```
{{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{/if}}
{{#if (eq pr_p_performeBy_N  "Broker")}}N/A{{/if}}
```

`pr_p_performeBy_N` is a literal `_N` placeholder (per the existing pattern around lines 5863–5870), and the `{{#if}}` helper isn't a supported construct in our renderer — that's why the raw conditional prints. We will:

1. Pre-resolve two new per-property variables and publish them to `fieldValues`.
2. Rewrite the two `{{#if (eq pr_p_performeBy_N "Broker")}}…{{/if}}` blocks in the XML to plain `{{pr_p_appraiserName_N}}` / `{{pr_p_appraiserAddress_N}}` merge tags before the renderer runs.

This mirrors how the existing `pr_p_performeBy_N` targeted safety rewrite (line 5863) already handles fragmented conditional XML.

## Code change — single file

`supabase/functions/generate-document/index.ts`

### 1. Per-property publisher (extend the block at lines 1466–1484)

Inside the existing `for (const idx of realPropertyIndices)` loop, right after the `pr_p_performedBy_${idx}` block, add:

```ts
// RE851D — pre-resolve appraiser name/address per property so the
// template can use plain {{pr_p_appraiserName_N}} / {{pr_p_appraiserAddress_N}}
// instead of {{#if}} conditionals (which the renderer does not support).
{
  const performedBy = String(
    fieldValues.get(`property${idx}.appraisal_performed_by`)?.rawValue ?? ""
  ).trim();
  const isBroker = performedBy.toLowerCase() === "broker";

  const nameRaw = String(
    fieldValues.get(`property${idx}.appraiser_name`)?.rawValue ?? ""
  );
  const addrParts = [
    fieldValues.get(`property${idx}.appraiser_street`)?.rawValue,
    fieldValues.get(`property${idx}.appraiser_city`)?.rawValue,
    fieldValues.get(`property${idx}.appraiser_state`)?.rawValue,
    fieldValues.get(`property${idx}.appraiser_zip`)?.rawValue,
  ].map(v => String(v ?? "").trim()).filter(Boolean);
  const addrRaw = addrParts.join(", ");

  const nameOut = isBroker ? "BPO Performed by Broker" : nameRaw;
  const addrOut = isBroker ? "N/A" : addrRaw;

  fieldValues.set(`pr_p_appraiserName_${idx}`,    { rawValue: nameOut, dataType: "text" });
  fieldValues.set(`pr_p_appraiserAddress_${idx}`, { rawValue: addrOut, dataType: "text" });
}
```

### 2. Default empty for unused slots (extend the loop near line 1920–1928)

Add `pr_p_appraiserName_${n}` and `pr_p_appraiserAddress_${n}` to the slot-defaulting loop so slots 1–5 with no property publish `""` rather than leaving the merge tag unresolved.

### 3. Register the new keys for `_N` resolution

Add `"pr_p_appraiserName_N"` and `"pr_p_appraiserAddress_N"` to the `_N` key list around line 4913, and add `"pr_p_appraiserName"`, `"pr_p_appraiserAddress"` to `SUFFIXED_BASES` around line 6326. This is what the anti-fallback shield uses to keep slot N strictly per-property.

### 4. XML rewrite — strip the `{{#if}}` blocks, anchored to the existing performeBy safety pass

In the same region as the existing `pr_p_performeBy_N` safety rewrite (around line 5863), add a pass that runs on the normalized XML before the renderer. For N = 1..5, replace:

```
{{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{/if}}
```

with `{{pr_p_appraiserName_N}}`, and:

```
{{#if (eq pr_p_performeBy_N "Broker")}}N/A{{/if}}
```

with `{{pr_p_appraiserAddress_N}}`. Use the same fragment-tolerant approach already in use there (collapse run boundaries, allow `performeBy` and `performedBy`, allow extra whitespace, allow either `"` or `"`/`"`). Do not touch any other `{{#if}}` usage — match strictly on these two literal payloads (`BPO Performed by Broker` and `N/A`) so we don't affect unrelated conditionals.

Add a `debugLog` summarizing how many of the 10 expected blocks were rewritten per render.

## Verification

After deploy, regenerate RE851D for DL-2026-0250:

| Property | performedBy | Expected NAME | Expected ADDRESS |
|---|---|---|---|
| 1 | Broker | BPO Performed by Broker | N/A |
| 2 | Appraiser (with name/addr) | <appraiser name> | <street, city, state, zip> |
| 3 | Broker | BPO Performed by Broker | N/A |
| 4 | Broker | BPO Performed by Broker | N/A |
| 5 | (empty slot) | (blank) | (blank) |

No `{{#if`, no `pr_p_performeBy_`, and no `pr_p_appraiser*` placeholders should remain in the unresolved-placeholders log line.

## Out of scope

- DOCX template edits (handled by XML rewrite instead).
- UI / Property form / field_dictionary / schema.
- Any other `{{#if}}` block in any template.
- The existing `pr_p_performeBy_N` publisher and its safety pass — left intact for back-compat with other places the variable is referenced standalone.

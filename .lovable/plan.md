
## Goal

In the generated RE851D document, the "NAME OF APPRAISER" and "ADDRESS OF APPRAISER" cells (for all 5 property sections) must render as **blank** whenever "Performed By" is not set to "Broker". When it is "Broker", they continue to render "BPO Performed by Broker" and "N/A" respectively (unchanged).

## Why a code change, not a template `{{else}}` edit

The literal `{{#if (eq pr_p_performeBy_N "Broker")}}…{{/if}}` blocks in the RE851D DOCX are intercepted by the existing generate-document pipeline. The pipeline pre-publishes per-property values into `pr_p_appraiserName_{N}` / `pr_p_appraiserAddress_{N}` and a downstream XML rewriter replaces the whole `{{#if …}}…{{/if}}` block (and `{{else}}` variant) with those merge tags. So adding `{{else}}{{/if}}` only to the DOCX would be overwritten and have no effect.

The minimal, equivalent fix is to change the non-Broker output of the publisher to an empty string. This produces exactly the requested visual result ("blank space") for all 5 property sections without touching any other logic, schema, UI, or template.

## Change

File: `supabase/functions/generate-document/index.ts` (RE851D appraiser publisher block, ~lines 1627–1628)

```text
Before:
  const nameOut = isBroker ? "BPO Performed by Broker" : nameRaw;
  const addrOut = isBroker ? "N/A"                     : addrRaw;

After:
  const nameOut = isBroker ? "BPO Performed by Broker" : "";
  const addrOut = isBroker ? "N/A"                     : "";
```

Comment above the block will be updated to reflect the new rule:
"performedBy === 'Broker' → name='BPO Performed by Broker', address='N/A'. Otherwise → both blank."

## Scope guarantees (per the user's strict constraints)

- No UI changes.
- No database / schema changes.
- No template (DOCX) changes.
- No changes to any other field, conditional, or property section.
- The block already runs for every property index 1..N, so all 5 property sections are covered automatically.
- Broker branch output is unchanged.

## Verification

1. Generate an RE851D with at least one property where Performed By = "Broker" and at least one where it is "Third Party" (or anything else).
2. Confirm Broker rows still show "BPO Performed by Broker" / "N/A".
3. Confirm non-Broker rows render the two cells as blank (no leftover `{{#if …}}` text, no appraiser name/address bleed-through).

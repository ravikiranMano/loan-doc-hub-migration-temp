# RE851D — Fix `pr_p_performeBy_N` per-property conditional

## Problem

In the RE851D template, both the NAME OF APPRAISER and ADDRESS OF APPRAISER rows are authored as:

```
{{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{else}}{{/if}}
{{#if (eq pr_p_performeBy_N "Broker")}}N/A{{else}}{{/if}}
```

Currently each PROPERTY #K section renders the literal text `#if (eq pr_p_performeBy_1 "Broker")N/A` (and `_2`, `_3`, …) instead of evaluating the conditional per property. Property #1 is also affected; Properties #2–#5 inherit Property #1's value when they do render.

## Root cause

`supabase/functions/generate-document/index.ts` already contains a targeted RE851D rewrite block (around lines 6181–6222) that converts the broker conditional into the resolved per-property merge tags `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}`. The rewrite uses this payload guard:

```ts
const payload = String(acm[1] || "").replace(/<[^>]+>/g, "").trim();
if (/^BPO Performed by Broker$/i.test(payload)) kind = "name";
else if (/^N\/A$/i.test(payload)) kind = "addr";
```

The authored template includes an empty `{{else}}` branch, so the captured payload is `BPO Performed by Broker{{else}}` or `N/A{{else}}`. Neither matches the strict equality regex, the rewrite is skipped, and a later brace-stripping pass leaves the raw Handlebars text visible in the document.

## Fix (scope: backend only — single file)

Edit `supabase/functions/generate-document/index.ts` inside the existing RE851D appraiser conditional block only. No UI, schema, template, other generator stages, or unrelated rewrites change.

1. **Tolerate the `{{else}}` branch** in the appraiser conditional regex (line 6182). Update the capture to grab only the true-branch text and consume an optional `{{else}} … {{/if}}` tail so the trimmed payload is exactly `BPO Performed by Broker` or `N/A`.
2. **Keep payload classification strict** — only the two literal payloads are accepted; any other conditional content is left untouched.
3. **Property index resolution stays as-is** — region-based PROPERTY #K lookup with the existing occurrence-pair fallback for properties 1–5.
4. **Preserve all existing safety passes**, including the literal `pr_p_performeBy_N` reindexer (lines 6224–6276) and per-property `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` aliases already published upstream.

## Verification

- Regenerate RE851D for `DL-2026-0250`.
- Confirm each PROPERTY #K (1 through 5) renders its own appraiser name and address based on that property's `appraisal_performed_by` value, with no `#if (eq pr_p_performeBy_K "Broker")` text leaking through.
- Confirm Word preview and the downloaded PDF match.
- Confirm other RE851D fields, other templates, and the UI are unchanged.

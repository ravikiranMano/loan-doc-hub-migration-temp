# Fix RE851D ADDRESS OF APPRAISER conditional leak

## Root cause

The RE851D template uses two **if/else** conditionals per property:

- NAME:    `{{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{else}}{{/if}}`
- ADDRESS: `{{#if (eq pr_p_performeBy_N "Broker")}}N/A{{else}}{{/if}}`

In `supabase/functions/generate-document/index.ts` (lines ~6247–6300) we already have a "RE851D appraiser conditional → merge-tag" rewriter that converts these blocks to the pre-published `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}` tags. It currently matches:

```
{{#if (eq pr_p_perform(e|ed)By_(N|1-5) "Broker")}}<payload>{{/if}}
```

and accepts the payload only if its stripped text is exactly `BPO Performed by Broker` or `N/A`.

With the `{{else}}{{/if}}` form (now in the live template), the lazy `[\s\S]*?` swallows up to the *first* `{{/if}}`, so the captured payload becomes `N/A{{else}}` (or `BPO Performed by Broker{{else}}`). The exact-match check fails, no rewrite is applied, and the literal Handlebars block then partially survives the downstream cleanup — producing the `#if (eq pr_p_performeBy_N "Broker")N/A{{else}}{{/if}}` text the user sees (the leading `{{` is consumed by another sanitizer; the rest leaks through).

Properties 1, 2, 3+ all hit the same bug because the rewriter exits before publishing the merge tag, so per-property substitution never happens.

## Fix (single, surgical edit)

Update **only** the appraiser conditional rewriter at `supabase/functions/generate-document/index.ts` ~lines 6247–6300:

1. Broaden the regex to also accept an optional `{{else}}…{{/if}}` tail:
   ```
   {{#if (eq pr_p_perform(e|ed)By_(N|1-5) "Broker")}}<IF_PAYLOAD>(?:{{else}}<ELSE_PAYLOAD>)?{{/if}}
   ```
   Capture group 1 = IF payload only; ELSE payload is captured but ignored (must be empty or whitespace — guard with a check so we never silently drop real content).

2. Keep the existing IF-payload classification unchanged:
   - `^BPO Performed by Broker$` → `kind = "name"` → replace whole block with `{{pr_p_appraiserName_K}}`
   - `^N/A$` → `kind = "addr"` → replace whole block with `{{pr_p_appraiserAddress_K}}`
   - Anything else → skip (do not touch).

3. Also require ELSE payload (after stripping XML tags and whitespace) to be empty. If a future template adds non-empty else content, the rewriter skips that block instead of dropping the else branch — safe-by-default.

4. No change to:
   - Pre-publishing of `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` (already correct: Broker → `BPO Performed by Broker` / `N/A`; Third Party → blank / blank).
   - The downstream `pr_p_performeBy_N` safety rewrite, the region cloner, or any other RE851D pass.
   - Field-resolver, schema, UI, or document layout.

## Why this is sufficient

- Properties 1–5 are already region-scoped by the existing `regions.props` loop, so the broader regex automatically applies per property with the correct `K` index.
- The address pre-publisher already returns `"N/A"` for Broker and `""` for Third Party — once the conditional is replaced by the merge tag, the document renders exactly the required output:
  - Broker → `N/A`
  - Third Party → blank
- No other conditional block in any template matches both the `(eq pr_p_perform(e|ed)By_N "Broker")` predicate and the `BPO Performed by Broker` / `N/A` payloads, so other templates and other fields are untouched.

## Verification

1. Regenerate RE851D for a deal with mixed performedBy values (P1 = Third Party, P2 = Broker, P3 = Broker).
2. Confirm:
   - P1: NAME blank, ADDRESS blank.
   - P2: NAME = `BPO Performed by Broker`, ADDRESS = `N/A`.
   - P3: same as P2.
3. Confirm no raw `{{#if …}}`, `#if …`, `{{else}}`, or `{{/if}}` text appears anywhere in the generated DOCX.
4. Spot-check unrelated conditionals (balloon payment YES/NO, servicing checkboxes, amortization) still render normally.

## Files touched

- `supabase/functions/generate-document/index.ts` — single block, ~lines 6247–6300 (regex + payload guard only).

No other files, no DB, no UI, no schema changes.

## Root cause

The RE851D "ADDRESS OF APPRAISER" cell for Property 2 renders the literal string:

```
#if (eq pr_p_performeBy_2 "Broker")N/A
```

This is the same class of bug as the recently fixed `ld_p_vesting` regression. The authored template wrapped this block as:

```
{{#if (eq pr_p_performeBy_2 "Broker")}}N/A{{/if}}
```

but at some point — during a prior template edit or during `normalizeWordXml`'s run-merging — every `{` and `}` brace around this specific block was stripped from the `<w:t>` body. The opener and the closer are gone, leaving only the bare inner Handlebars text. The other blocks in the document (e.g. Property 1 NAME OF APPRAISER → "BPO Performed by Broker") still have their braces intact, which is why only this one cell regressed.

Why every existing guard misses it:

1. `supabase/functions/rewrite-re851d-template/index.ts` rewrites at upload time using a regex that REQUIRES literal `{{ … }}` around `#if` and `{{/if}}`. With no braces in the run, nothing matches and the block is left as-is.
2. The runtime guard at `supabase/functions/generate-document/index.ts` L6247 uses `\{\{\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(?:N|[1-5])\s*"\s*Broker\s*"\s*\)\s*\}\}([\s\S]*?)(?:\{\{\s*\/\s*if\s*\}\}|\{\{\s*\/\s*if\s*\}(?!\}))` — also brace-anchored on both ends. No match.
3. The legacy `_N` safety rewrite at L6305 only matches the bare identifier `pr_p_performeBy_N`, not the literal `_2`/`_3`/etc that this cell carries.
4. The Handlebars renderer sees no `{{` tag, so it emits the body verbatim.
5. The unresolved-placeholder scanner at the end also requires `{{`, so the leak is never logged.

Net effect: a brace-less `#if (eq pr_p_performeBy_K "Broker")PAYLOAD` (and optionally a brace-less `/if`) survives all 5 layers and ships in the final DOCX.

## Fix (minimal, additive, RE851D-only)

### `supabase/functions/generate-document/index.ts`

1. **Add a third pass immediately after the existing appraiser-conditional rewrite (L6246–6287)** that matches the brace-less form, strictly scoped to the two known payloads so no other prose can be touched:

   ```
   /(?:\{\{\s*)?#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(N|[1-5])\s*"\s*Broker\s*"\s*\)(?:\s*\}\})?\s*(BPO Performed by Broker|N\/A)\s*(?:\{\{\s*\/\s*if\s*\}\}|\/\s*if)?/g
   ```

   For each match:
   - Resolve `K` from the raw `_N|_1..5` index, the enclosing PROPERTY region (`regions.props`), and a fallback pair counter — identical to the existing logic on L6260–6271.
   - Choose `tagBase = "pr_p_appraiserName"` for `BPO Performed by Broker` payload, `"pr_p_appraiserAddress"` for `N/A`.
   - Push a `{ start, end, replacement: "{{tagBase_K}}" }` rewrite, mark consumed, and increment `totalRewrites` — same shape as the existing branch.

   Because `pr_p_performeBy` / `BPO Performed by Broker` / `N/A` cannot appear as legitimate document prose anywhere else in RE851D, this is safe to run unconditionally for that template.

2. **Tighten the post-render unresolved scanner** so any future brace-less leakage is logged instead of shipping silently. Add a brace-optional scan for `#if (eq pr_p_perform(?:e|ed)By_…` and the two payloads next to the existing `vestingHits` block (around L10805), printing them under the same `RE851D unresolved placeholders before upload/PDF` log line.

No changes to:
- The field dictionary, publishers, or `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` value resolution (already correct — Property 2 has the values published).
- The `rewrite-re851d-template` upload-time function.
- The UI, RLS, schema, or any other template's logic.

## Validation

1. Regenerate RE851D for the active deal → Property 2's ADDRESS OF APPRAISER cell now renders the resolved `pr_p_appraiserAddress_2` value (`N/A` when performedBy === "Broker", empty otherwise). Property 1 NAME OF APPRAISER continues to render `BPO Performed by Broker` unchanged.
2. Edge-function logs show the new pass count under `RE851D appraiser conditional rewrite: N block(s) replaced` (incremented by however many brace-less blocks were repaired).
3. Templates that still have well-formed `{{#if … }}…{{/if}}` braces are unaffected — the existing branch consumes them first, so the new brace-less branch finds nothing to do.

## Out of scope

- Field dictionary, RLS, storage, packets, other templates (RE851A, RE885).
- The legacy `rewrite-re851d-template` admin function (only used at upload time; a separate cleanup pass there is not needed to unblock the live document).

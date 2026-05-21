# Fix RE851D appraiser `_N` conditional leaking raw into output

## Root cause (confirmed from code)
The pipeline already has all the pieces to handle the `{{#if (eq pr_p_performeBy_N "Broker")}}…{{/if}}` conditional:

1. `_shared/tag-parser.ts::consolidateAppraiserConditional` (line 724) canonicalizes the fragmented runs into one contiguous `{{#if (eq pr_p_performeBy_N "Broker")}}PAYLOAD{{else}}{{/if}}` run.
2. `generate-document/index.ts` line 6906 (strict) rewrites that canonical block to `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}` per PROPERTY region.
3. Line 7028 (`performByTagRe`) replaces any remaining literal `_N` with `_K` based on PROPERTY region.

The bug: `consolidateAppraiserConditional` is invoked **inside `normalizeWordXml`**, but `normalizeWordXml` has **four fast-path early returns** (tag-parser.ts lines 308, 323, 330, 350–376) that bypass it. For RE851D in deal DL-2026-0250 the per-paragraph fragmentation probe at line 350 evidently does not flag the appraiser paragraphs, so the canonicalization never runs. The downstream strict regex at gen-doc 6906 then can't match the still-fragmented opener, and the tolerant pass at 6967 also can't anchor on the payload because the `N/A` / `BPO Performed by Broker` text is itself split across runs. Result: the raw `{{#if (eq pr_p_performeBy_N "Broker")}}…{{/if}}` survives all rewrites and leaks into the final docx.

## Fix scope — two narrow edits, no behavior changes elsewhere

### Edit 1 — `supabase/functions/_shared/tag-parser.ts`
`consolidateAppraiserConditional` is already exported (line 724). No code change needed here — only confirm the export is intact.

### Edit 2 — `supabase/functions/generate-document/index.ts`
Add a single defensive call to `consolidateAppraiserConditional(xml)` for RE851D templates immediately after the existing `normalizeWordXml(...)` invocation at line 6400, so the canonical form is guaranteed regardless of which fast-path `normalizeWordXml` took. Pseudocode:

```ts
// existing
xml = normalizeWordXml(xml, template.name || "");

// new (RE851D only): guarantee appraiser conditional is canonicalized even
// when normalizeWordXml took a fast-path return that skipped its internal
// consolidateAppraiserConditional call.
if (isTemplate851D) {
  xml = consolidateAppraiserConditional(xml);
}
```

Import `consolidateAppraiserConditional` from `../_shared/tag-parser.ts` at the top of the file alongside the existing `normalizeWordXml` import (line 27).

That's it. After this call:
- The opener becomes contiguous: `{{#if (eq pr_p_performeBy_N "Broker")}}BPO Performed by Broker{{else}}{{/if}}` and likewise for `N/A`.
- The existing strict regex at line 6906 matches and rewrites the whole block to `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}` anchored by PROPERTY region (Property 1 → `_1`, etc.).
- The value publisher at line ~2000 already publishes `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` based on `appraisal_performed_by`: `"Broker"` → name=`BPO Performed by Broker`, address=`N/A`; anything else → empty.

## Expected behavior after fix (deal DL-2026-0250, Property 1, Performed By = "Third Party")
- NAME OF APPRAISER → blank
- ADDRESS OF APPRAISER → blank

If Performed By is later changed to "Broker":
- NAME OF APPRAISER → `BPO Performed by Broker`
- ADDRESS OF APPRAISER → `N/A`

## Files changed
- `supabase/functions/generate-document/index.ts` — add one import + one conditional call (≈3 lines).

## Files NOT changed
- `_shared/tag-parser.ts` (consolidation function is already correct).
- `_shared/field-resolver.ts` (value-resolution layer; not a document-XML rewriter — the conceptual "`_N` → property index" replacement the user described actually lives in `generate-document/index.ts` at line 7028 and is already implemented).
- Any other field mapping, conditional, publisher, or template.

## Verification
1. Deploy `generate-document`.
2. Re-generate RE851D for DL-2026-0250 with Property 1 `appraisal_performed_by = "Third Party"`. Confirm NAME / ADDRESS OF APPRAISER are blank.
3. Edit Property 1 `appraisal_performed_by` to `"Broker"`, re-generate. Confirm NAME = `BPO Performed by Broker`, ADDRESS = `N/A`.
4. Confirm Properties 2–5 are anchored to their own values (no cross-property leakage).
5. Confirm the raw text `{{#if (eq pr_p_performeBy_N "Broker")}}` no longer appears anywhere in the generated docx.

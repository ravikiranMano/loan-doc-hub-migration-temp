# Fix RE851D appraiser fields (NAME / ADDRESS) across all 5 properties

## Goal
Make all 5 NAME OF APPRAISER and all 5 ADDRESS OF APPRAISER lines render correctly in the generated RE851D, anchored to each property's `appraisal_performed_by` value:

- Performed By = "Broker" → NAME = `BPO Performed by Broker`, ADDRESS = `N/A`
- Anything else → both blank

No other field, conditional, or template behavior changes.

## Root cause (confirmed against `RE851D-V12.1-16.docx`)
All 10 conditional blocks DO contain `{{#if (eq pr_p_performeBy_N "Broker")}}…{{else}}{{/if}}` in the template, but they are fragmented across many `<w:r>` runs. The 5 ADDRESS blocks additionally have `N/A` split by a grammar-checker marker:

```text
…}}N</w:t></w:r><w:proofErr w:type="gramStart"/><w:r…><w:t>/A{{else}}{{/if}}…
```

Downstream of the existing brace-repair / orphan-strip passes, the broken shape can end up rendered as the literal text `#if (eq pr_p_performeBy_1 "Broker")N/A` in the final document — the symptom shown in the user's screenshot. The existing strict and tolerant rewriters in `generate-document/index.ts` (lines 6893 and 6952) don't fire because the payload `N/A` is never contiguous when they run.

## Fix scope — single file, single narrow pass

Edit only `supabase/functions/_shared/tag-parser.ts`. Inside `normalizeWordXml`, add one new paragraph-scoped pass `consolidateAppraiserConditional` that runs AFTER the existing proofErr stripper (line 389) and AFTER the fragment-suite run consolidation, and BEFORE the function returns. The pass is strictly scoped — it only touches paragraphs that contain both `pr_p_perform` (canonical or legacy `performeBy`/`performedBy`) AND `Broker`.

### What the pass does

For each qualifying paragraph:

1. Build a tag-stripped text view of the paragraph with an offset map back to XML (same technique already used in `rewrite-re851d-template/index.ts::buildStrippedIndex`).
2. In the stripped text, match one of two known shapes (case-insensitive, smart-quote tolerant):
   - `{{#if (eq pr_p_perform(e|ed)By_(N|[1-5]) "Broker")}}BPO Performed by Broker{{else}}{{/if}}`
   - `{{#if (eq pr_p_perform(e|ed)By_(N|[1-5]) "Broker")}}N/A{{else}}{{/if}}`
   The match tolerates missing `{{`/`}}` on the opener/closer (so brace-repair side effects don't defeat it) and an optional `{{else}}` body, but requires the payload to be exactly one of the two literals — nothing else is rewritten.
3. Map the stripped match span back to the original XML span (first opening run, last closing run).
4. Replace that XML span with a single canonical run:
   ```xml
   <w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">{{#if (eq pr_p_performeBy_N "Broker")}}PAYLOAD{{else}}{{/if}}</w:t></w:r>
   ```
   `PAYLOAD` is the literal `BPO Performed by Broker` or `N/A` from the stripped match. Run properties are copied from the first matched run when available so font size / styling are preserved. Surrounding XML in the paragraph (label text "NAME OF APPRAISER" / "ADDRESS OF APPRAISER", paragraph properties, neighbouring runs) is untouched.
5. Idempotent: if the paragraph already contains the canonical contiguous form, the regex matches but produces identical output, so re-runs are no-ops.

Property-index resolution (`_N` → `_1`..`_5`) is NOT done here. The existing downstream pass in `generate-document/index.ts` (line 7012, `pr_p_performeBy_N` targeted safety rewrite) already handles that based on PROPERTY region detection — leaving `_N` here keeps the fix layered and avoids duplicating region-anchored logic in the shared normalizer.

### Why this satisfies all three patterns the user described

- **PATTERN 1 (missing `{{#if (eq` prefix)**: The replacement run always emits the canonical opener, so any partially-stripped opener in the source is restored.
- **PATTERN 2 (`N/A` split by `gramStart`)**: The tag-stripped text view collapses `}}N` + `<w:proofErr/>` + `/A` into contiguous `}}N/A`, so the regex matches and the entire span is replaced with one clean run.
- **PATTERN 3 (`_N` → property number)**: Handled downstream by the existing `performByTagRe` pass anchored to PROPERTY regions; the canonical `pr_p_performeBy_N` literal emitted here is exactly what that pass expects.

## Verification

1. Add a Deno unit test `supabase/functions/_shared/tag-parser.re851d-appraiser.test.ts` covering:
   - Intact NAME block survives unchanged through normalize (idempotent).
   - ADDRESS block with `<w:proofErr w:type="gramStart"/>` between `}}N` and `/A` becomes a single canonical run with payload `N/A`.
   - Brace-stripped variant `#if (eq pr_p_performeBy_1 "Broker")N/A` becomes the canonical `{{#if (eq pr_p_performeBy_N "Broker")}}N/A{{else}}{{/if}}` run.
   - Paragraphs without `pr_p_perform`+`Broker` are returned byte-identical (scope guard).
2. After deploy, generate RE851D for a deal with 5 properties where property 1 has `appraisal_performed_by = "Broker"` and property 2 has it blank/`"Third Party"`. Expected:
   - Property 1: NAME shows `BPO Performed by Broker`, ADDRESS shows `N/A`.
   - Property 2: both fields blank.
   - Properties 3–5: anchored to their own `appraisal_performed_by` values.
3. Spot-check via `debug-fetch-doc` that no other paragraphs were modified (diff confined to the 10 appraiser blocks).

## Files changed

- `supabase/functions/_shared/tag-parser.ts` — add `consolidateAppraiserConditional` paragraph pass inside `normalizeWordXml`, invoked once after the existing proofErr/run-consolidation suite.
- `supabase/functions/_shared/tag-parser.re851d-appraiser.test.ts` — new test file (4 cases above).

## Files NOT changed

- The RE851D template document itself.
- `generate-document/index.ts` (existing `apprCondRe`, `apprTolRe`, and `performByTagRe` passes already handle the canonical form this pass guarantees).
- `rewrite-re851d-template/index.ts` (separate one-shot template rewriter — not in the runtime path).
- Any other field mapping, conditional, or template behavior.

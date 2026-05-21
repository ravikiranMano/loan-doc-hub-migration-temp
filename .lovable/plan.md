## Goal
Fix two RE870 Investor Questionnaire rendering bugs so the checkbox + date row resolves to `☑ Initial: 05/21/2026 (Date Completed)` instead of leaking raw Handlebars text.

## Root cause

Both bugs live in the same Word template (`word/document.xml` of the 3 RE870 templates). Word fragmented the date tag and the entire checkbox conditional across many `<w:r>` runs with interleaved `<w:proofErr>` markers:

1. **Date tag** is authored as `{{ ld_p_investorQuestiDueDate}}` — with a literal space after `{{`. The space lives in the first run (`<w:t xml:space="preserve">{{ </w:t>`). Even after run consolidation, the produced token is `{{ ld_p_investorQuestiDueDate}}`. The renderer treats the literal space as part of the key and never resolves it, so the user sees the raw braces.

2. **Checkbox conditional** is authored as:
   ```text
   {{#if ld_p_investorQuestiDue}}☒{{else}}☐{{/if}}
   ```
   but Word split `{{#if `, the field name, and `}}` into 3 runs, with `<w:proofErr>` between them; the glyphs and `{{else}}`/`{{/if}}` are in their own runs with a different font (MS Gothic). The existing `checkboxIfElsePattern` in `tag-parser.ts` should match this, but the small-font (`sz=4`) Calibri runs mixed with MS Gothic glyph runs are causing the fragmented `{{#if` / `}}` not to match the patterns reliably across all templates, so the conditional ships through to Handlebars un-consolidated and gets emitted verbatim.

The safest fix is to canonicalize this row at template-rewrite time (same approach used for the INVESTOR NAME cell), so generation no longer depends on run-fragmentation heuristics for these specific tags.

## Changes

Single file: `supabase/functions/rewrite-re870-multi-lender/index.ts`

1. **Add `V11_MARKER`** (`<!-- re870-rewrite:v11 -->`) and update marker handling so v10 (and lower) is re-rewritten unconditionally on `force: true`, and v11 is the new skip marker.

2. **New pass — `normalizeInvestorQuestiDueRow(xml)`** runs after the existing INVESTOR NAME / cell-geometry passes:
   - **Date tag fix**: scan for any paragraph that contains both `ld_p_investorQuestiDueDate` and a literal `{{` followed by whitespace before it. Replace the entire fragmented tag (from the opening `{{`, across all runs/proofErr up to and including the matching `}}`) with a single clean run that emits exactly `{{ld_p_investorQuestiDueDate}}` (no internal space), preserving the surrounding run properties (sz=18 Calibri) and the trailing `(Date Completed)` text in its own run.
   - **Checkbox conditional fix**: scan for any paragraph that contains `ld_p_investorQuestiDue` followed (within the same `<w:p>`) by `{{else}}` and `{{/if}}`. Replace the entire fragmented block (from the opening `{{#if` run through the `{{/if}}` run, including the interleaved Calibri sz=4 wrapper runs and MS Gothic glyph runs and `<w:proofErr>` markers) with three clean runs in a single `<w:p>`:
     ```text
     <w:r><w:rPr><w:rFonts ascii="MS Gothic" eastAsia="MS Gothic" hAnsi="MS Gothic" cs="MS Gothic"/><w:color w:val="000000"/></w:rPr>
       <w:t xml:space="preserve">{{#if ld_p_investorQuestiDue}}☑{{else}}☐{{/if}}</w:t>
     </w:r>
     ```
     i.e. a single contiguous text run holding the whole `{{#if … {{/if}}` expression so Handlebars sees it intact regardless of run-consolidation. Use ☑ (U+2611) for the true branch (per spec) instead of the template's existing ☒.
   - Both passes are idempotent (no-op if the canonical single-run form is already present) and strictly scoped: they only touch paragraphs that mention `investorQuestiDue` / `investorQuestiDueDate`. No other markup is altered.

3. **Pipeline ordering**: call the new pass inside the same per-template rewrite loop, after `stripV1Wrappers` and the existing INVESTOR NAME cell rewrites, and before re-zipping. Emit a log line with the number of paragraphs rewritten per template.

4. **Verification of field-resolver mapping** (no code change required — confirmed):
   - `generate-document/index.ts` already publishes `ld_p_investorQuestiDue` as `"true"`/`"false"` from `lender_contact_data.investor_questionnaire_due` (line 1001) and `ld_p_investorQuestiDueDate` from `investor_questionnaire_due_date` (line 993). The Handlebars `{{#if ld_p_investorQuestiDue}}` correctly evaluates the truthy string `"true"` → ☑ and missing/false → ☐.

## Validation

1. Deploy `rewrite-re870-multi-lender`.
2. POST with `{ force: true }` to re-rewrite all 3 RE870 templates.
3. `debug-fetch-doc` the rewritten template XML and confirm:
   - Exactly one run carrying `{{ld_p_investorQuestiDueDate}}` (no internal space, no proofErr inside).
   - Exactly one run carrying `{{#if ld_p_investorQuestiDue}}☑{{else}}☐{{/if}}`.
   - The surrounding text `Initial:` / `(Date Completed)` remains intact in adjacent runs.
4. Generate the document for lender L-00029 (LEN Shwan Micheal) on deal DL-2026-0257 with checkbox=true and date=05/21/2026; confirm output reads:
   ```text
   ☑ Initial: 05/21/2026 (Date Completed)
   ```
5. Generate for a lender with the checkbox unchecked and confirm:
   ```text
   ☐ Initial:  (Date Completed)
   ```

## Out of scope
- No changes to `_shared/tag-parser.ts`, `field-resolver.ts`, or `generate-document/index.ts`.
- No changes to the existing INVESTOR NAME loop or cell-geometry passes.
- No schema or UI changes.
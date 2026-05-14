# RE851D appraiser fields — permanent fix

## Problem recap

In v76 of `DL-2026-0250` the `ADDRESS OF APPRAISER` field still renders raw `#if (eq pr_p_performeBy_N "Broker")N/A` for every property, while `NAME OF APPRAISER` resolves correctly for some properties. The runtime XML-rewrite added previously catches *some* of the `{{#if}}` blocks but not all — almost certainly because the `{{#if (eq pr_p_performeBy_N "Broker")}}` opener for the address line is split across multiple `<w:r>` runs in the template, and the regex sees fragments that no longer look like a single contiguous merge tag.

The user's directive is explicit: **the template itself must stop containing `{{#if}}` syntax.** The runtime rewrite should remain only as a safety net.

## Fix in two parts

### Part A — Permanently rewrite the stored RE851D template (one-shot)

Add a small admin-only Edge Function `rewrite-re851d-template` that:

1. Downloads `templates/1778746922135_RE851D-V12.1.docx` (service role).
2. Unzips with `fflate`, decodes `word/document.xml`.
3. Performs a fragment-tolerant rewrite. For each `{{#if (eq pr_p_perform(e|ed)By_(N|1..5) "Broker")}}…{{/if}}` block whose payload (after stripping `<...>` tags and whitespace) is exactly `BPO Performed by Broker` → replace the entire block with `{{pr_p_appraiserName_N}}`. If payload is exactly `N/A` → replace with `{{pr_p_appraiserAddress_N}}`. Use the same "build a tag-stripped index, find matches there, map back to XML offsets" technique already used elsewhere in the project so split-run cases are handled.
4. Verifies that **zero** `pr_p_performeBy`-referencing `{{#if}}` opener literals remain in the stripped text. Logs the count rewritten (expected: 10 = 5 properties × 2 fields).
5. Repacks with `fflate.zipSync` and uploads back to the same storage path with `upsert: true` (templates bucket; same `file_path` on the `templates` row, no DB change needed).
6. Returns `{ rewrittenBlocks, remainingIfBlocks }` so we can confirm before regenerating.

Then we invoke this function once for the current template and immediately regenerate RE851D for `DL-2026-0250` to confirm.

The function is idempotent — running it again on an already-rewritten template is a no-op (0 rewrites).

### Part B — Strengthen the runtime safety net in `generate-document/index.ts`

Even after Part A, leave a defensive pass so any future template that still has `{{#if (eq pr_p_perform(e|ed)By …)}}` syntax (different version uploads, etc.) keeps working. Two refinements at the existing block (lines ~5896–5949):

1. **Tag-stripped scan.** Build `xmlText = xml.replace(/<[^>]+>/g, "")` plus an offset map, run the appraiser-conditional regex against `xmlText`, then map matched ranges back to original XML offsets. This catches the address-line fragmentation that the current contiguous-XML regex misses.
2. **Smart-quote tolerance.** Allow `"` / `"` / `"` around `Broker` (`["\u201C\u201D]`).
3. **Payload match.** Keep the strict allow-list (`BPO Performed by Broker` / `N/A`) so unrelated `{{#if}}` blocks (other templates) are never touched.
4. **Anti-regression assert.** After all rewrites, count any surviving `#if (eq pr_p_perform` substrings in the stripped text and `debugLog` the count — makes future breakage visible in logs immediately.

No change to: `buildPropertyVariables` publisher (already publishes `pr_p_appraiserName_N` / `pr_p_appraiserAddress_N` correctly per property, with empty string for unused slots), `SUFFIXED_BASES`, `RE851D_INDEXED_TAGS`, anti-fallback shield, or the existing `pr_p_performeBy_N` safety pass.

## Files touched

- **NEW** `supabase/functions/rewrite-re851d-template/index.ts` (~120 lines, service-role guard, single POST handler).
- **EDIT** `supabase/functions/generate-document/index.ts` — only the appraiser-conditional rewrite block at lines ~5896–5949 (Part B refinements).

No DB migrations, no UI changes, no field_dictionary changes, no other template changes.

## Verification

1. Deploy both functions.
2. Invoke `rewrite-re851d-template` once. Confirm response: `rewrittenBlocks: 10, remainingIfBlocks: 0`.
3. Regenerate RE851D for `DL-2026-0250` (v77+).
4. Inspect generated docx — for all 5 property blocks:
   - Property 1 (`Public Record`): NAME blank, ADDRESS blank.
   - Property 2 (`Broker`): NAME = `BPO Performed by Broker`, ADDRESS = `N/A`.
   - Property 3 (`Appraiser` with name/addr): NAME = appraiser name, ADDRESS = joined street/city/state/zip.
   - Properties 4 / 5: per their `appraisal_performed_by` value, or blank if unused slot.
5. Grep the generated `document.xml` for `#if (eq pr_p_perform` and `pr_p_performeBy` literals — must be zero.

## Out of scope

- Other `{{#if}}` blocks in any template (servicing, amortization, payable-frequency, etc.) — left intact, those have their own dedicated handlers.
- The `pr_p_performeBy_N` publisher and its existing safety rewrite — kept for back-compat with anywhere the variable is referenced standalone.
- DOCX template UI / re-upload workflow.

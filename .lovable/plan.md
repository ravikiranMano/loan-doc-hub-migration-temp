
## Problem

In the **Formal Request for Information V7** template, the tag `{{pr_li_lienHolder}}` renders blank (or as the literal `{{pr_li_lienHolder}}`) instead of the lien holder name.

## Root cause

In `word/document.xml` the merge tag is split across three runs because Word applied `<w:highlight w:val="white"/>` to part of the text:

```
<w:r>...<w:t>To: </w:t></w:r>
<w:r>...<w:t>{{</w:t></w:r>
<w:r><w:rPr><w:highlight w:val="white"/>...</w:rPr><w:t>pr_li_lienHolder}}</w:t></w:r>
```

The opening `{{` lives in one run; the field name and closing `}}` live in a separate run that carries a different `<w:rPr>` (highlight + minimal properties — no font/size). The generic run-consolidation pass occasionally fails to stitch this exact shape because the two runs have non-matching `<w:rPr>` blocks, so the downstream merge-tag resolver never sees a complete `{{pr_li_lienHolder}}` token and the placeholder is left as-is (or eaten when downstream "leftover handlebars" cleanup runs).

Separately, the existing Formal-Request-specific publisher (`supabase/functions/generate-document/index.ts` ~line 4488) only overwrites `pr_li_lienHolder` when it finds a lien whose `priority` field equals exactly `1st`/`1`/`first`. If no such lien exists, the aggregated newline-joined list is left in place — which is also wrong for this single-cell tag.

## Fix

Single-file change in **`supabase/functions/generate-document/index.ts`**.

### 1. Strengthen the Formal-Request-only `pr_li_lienHolder` publisher (around lines 4488–4530)

- Resolve the holder value with this precedence:
  1. Lien (by ascending index) whose `priority` is `1st`/`1`/`first` AND whose `holder` is non-empty.
  2. Lien (by ascending index) whose `holder` is non-empty (fallback when no priority is marked `1st`).
  3. `lien1.holder` / `lien.holder` direct lookup.
- Publish the resolved holder under all of: `pr_li_lienHolder`, `property1.lien_holder`, and the canonical-key alias used by the field-dictionary id `3157074f-b561-45f8-b358-01fb264bc06b`, so any downstream resolver path that reads a different key still gets the same value.
- Add a `debugLog` line that reports the chosen lien + holder for diagnosis.

### 2. Add a Formal-Request-only XML safety pass

Run once per `document.xml` (and headers/footers) when `isTemplateFormalRequestInfo === true`, after the existing `normalizeWordXml` pass and before merge-tag resolution:

- Scan paragraphs that contain `pr_li_lienHolder`.
- Extract the concatenated text of all `<w:t>` elements in the paragraph; if the concatenation contains `{{pr_li_lienHolder}}` but no single `<w:t>` does, rewrite the paragraph so the first run containing `{{` carries the full `{{pr_li_lienHolder}}` text and the following runs that contributed only the split remainder (`pr_li_lienHolder}}` and the orphan `{{`) are emptied. Preserve the `<w:rPr>` of the run that originally held `{{` so font/size/color stay Times New Roman 12pt black to match the surrounding `To: ` text. Drop the `<w:highlight w:val="white"/>` carried only by the orphan run.
- Idempotent: if the tag is already contiguous in a single `<w:t>` the pass is a no-op.

This mirrors the pattern already used in this file (`consolidateAppraiserConditional`, the LPDS Lender 1 rewriter) for one specific tag in one specific template — no impact on other templates.

### 3. No template change, no schema change

- Do not modify the uploaded `Formal_Request_for_Information V7.docx`.
- Do not touch `field_dictionary`, RLS, or any other module.
- Do not change behavior for any template whose name does not match the existing `isTemplateFormalRequestInfo` regex.

## Verification

1. Regenerate Formal Request for Information for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65`.
2. Open the resulting `.docx`; the `To:` line must read `To: First National Commercial Bank` (the 1st-priority lien holder for this deal — confirmed in `deal_section_values` section=`liens`, key `lien1::3157074f-…` = "First National Commercial Bank", priority `lien1.priority` = "1st"). Font/size/color must match the rest of the paragraph (Times New Roman 12pt black, no white highlight artifact).
3. Re-run on a deal with no liens at priority "1st" — confirm fallback to the first non-empty lien holder.
4. Re-run on a deal with no lien data — confirm the tag renders empty (no literal `{{pr_li_lienHolder}}` remains).
5. Sanity-check at least one unrelated template (e.g. RE885, LPDS Addendum) regenerates with no regressions in lien-holder cells.

## Files touched

- `supabase/functions/generate-document/index.ts` — edits in the Formal-Request section (~lines 4482–4530) and one new safety-pass helper invoked from the same template branch.

## Deploy

Redeploy the `generate-document` edge function after the edit.

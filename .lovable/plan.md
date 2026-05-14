## Goal
Stop the RE851D YES/NO encumbrance checkboxes from stacking/wrapping by forcing each YES + NO pair onto a single line with a non-breaking space between them. Logic stays untouched — formatting only.

## Root cause
In the stored RE851D template, each of the four questionnaire pairs is authored as two separate paragraphs:

```
{{pr_li_encumbranceOfRecord_N_yes_glyph}} YES
{{pr_li_encumbranceOfRecord_N_no_glyph}} NO
```

Word renders these on separate lines and may wrap further in narrow cells, producing the broken `☑ YES ☑NO ☑ YES ☑` output.

## Fix
Update the one-shot template rewrite function `supabase/functions/rewrite-re851d-encumbrance-layout/index.ts` so that, for all 5 property sections × 4 questionnaire pairs:

1. Detect each pair where two adjacent paragraphs contain:
   - paragraph A: `{{pr_li_<family>_N_yes_glyph}} YES`
   - paragraph B (next or near-next sibling): `{{pr_li_<same family>_N_no_glyph}} NO`
   - families: `encumbranceOfRecord`, `delinqu60day`, `currentDelinqu`, `delinquencyPaidByLoan`
2. Merge them into a single paragraph by appending the runs from paragraph B into paragraph A, separated by a non-breaking space (`\u00A0` / `&#160;`) between `YES` and the no-glyph tag.
3. Delete paragraph B entirely.
4. Keep the existing right-align + keepLines/keepNext behaviour on the merged paragraph so the question stays anchored to the checkbox row.
5. Remain idempotent: if paragraph A already contains both `_yes_glyph` and `_no_glyph` for the same family, skip merging.
6. Strictly scoped to these 4 families — no other paragraphs touched.

## Deploy + verify
- Deploy `rewrite-re851d-encumbrance-layout`.
- Invoke it once against the stored template `1778746922135_RE851D-V12.1.docx`.
- Inspect the rewritten DOCX XML to confirm: each property section has 4 single-paragraph YES/NO rows, no orphan `_no_glyph` paragraphs remain, and a `\u00A0` sits between `YES` and the no-glyph tag.
- Regenerate RE851D for `DL-2026-0250` to confirm the rendered output shows `☐ YES ☑ NO` on one line per question for every property.

## Out of scope
- No business-logic changes (which box gets checked is unchanged).
- No schema, UI, or `generate-document` resolver changes.
- No `{{#if}}` conditionals introduced.
- No new tables or layout containers.
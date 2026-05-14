## Goal
Match the original `re851d - LPDS Multi-property.docx` layout for the ENCUMBRANCE INFORMATION section: each question stays on its own left-aligned line with dotted fill, and its YES/NO checkbox pair stays on a separate right-aligned line directly underneath — never split across a page break.

## What's already correct (do not redo)
The existing `rewrite-re851d-encumbrance-layout` function already:
- Keeps the YES/NO merged into one paragraph (single line, joined by `&#160;`)
- Right-aligns that paragraph (`<w:jc w:val="right"/>`)
- Adds `<w:keepLines/>` so the YES/NO pair never wraps
- Trims trailing whitespace so glyphs snap to the right margin

The reference document confirms the structure we want: question paragraph → separate checkbox paragraph(s) → next sub-question. We do NOT want to merge the checkboxes back into the question paragraph.

## What's still broken
The page-break / orphan-checkbox issue ("☐ YES ☑" appearing alone at the top of the next page with no question above it) happens because the QUESTION paragraph has no "keep with next" set, so Word is free to break between the question and its YES/NO line.

## Fix (one targeted change in `supabase/functions/rewrite-re851d-encumbrance-layout/index.ts`)

Extend the existing rewrite to also walk BACKWARD from each merged YES/NO paragraph and add `<w:keepNext/>` to the paragraph(s) that must stay glued to it:

For each merged checkbox paragraph (the 4 families × 5 properties = 20 paragraphs we already touch):
1. Look at the immediately preceding paragraph.
2. If it's another merged YES/NO paragraph for the same family group (e.g. the `encumbranceOfRecord` line right above the `delinqu60day` line), add `<w:keepNext/>` to it AND keep walking up to the question paragraph above that one.
3. Otherwise, add `<w:keepNext/>` to that single preceding question paragraph.
4. Idempotent: skip if `<w:keepNext/>` is already present.
5. Also ensure the merged checkbox paragraph itself has `<w:keepNext/>` when it is followed by ANOTHER merged checkbox paragraph (the encumbrance-of-record line must keep with the 60-days-late line which must keep with whatever question follows).

Mapping per the user's spec and confirmed against the reference XML (paragraphs 331–348 in `re851d - LPDS Multi-property.docx`):

```text
Q  "Are there any encumbrances of record …"        ← add keepNext
Q  "Over the last 12 months … 60 days late?"       ← add keepNext
CB ☐ YES ☐ NO  (encumbranceOfRecord_N)             ← add keepNext  (already right-aligned + keepLines)
CB ☐ YES ☐ NO  (delinqu60day_N)                    (already right-aligned + keepLines)
Q  "If YES, how many?  ____"
Q  "Do any of these payments remain unpaid? …"     ← add keepNext
Q  "If YES, will the proceeds … cure the delinquency?"  ← add keepNext
CB ☐ YES ☐ NO  (currentDelinqu_N)                  ← add keepNext  (already right-aligned + keepLines)
CB ☐ YES ☐ NO  (delinquencyPaidByLoan_N)           (already right-aligned + keepLines)
Q  "If NO, source of funds …"
```

So the rule is simple: walking up from each `delinqu60day` and `delinquencyPaidByLoan` checkbox paragraph, set `<w:keepNext/>` on every paragraph encountered until we've covered the two questions above it (and the intermediate merged checkbox line for the other family).

## Out of scope
- No changes to question wording, dotted-fill text, indentation, tab stops, list numbering, or the `If YES, how many?` / `If NO, source of funds` paragraphs.
- No `{{#if}}` conditionals.
- No changes to field keys, glyph resolution, schema, UI, or any other section of the document.

## Deploy + verify
1. Deploy `rewrite-re851d-encumbrance-layout`.
2. Invoke once against `1778746922135_RE851D-V12.1.docx`.
3. Unzip the rewritten DOCX and confirm: each of the 4 question paragraphs (and the intermediate `encumbranceOfRecord` / `currentDelinqu` checkbox paragraphs) has `<w:keepNext/>` in its `<w:pPr>`, for all 5 property slots = 30 paragraphs newly marked.
4. Regenerate RE851D for `DL-2026-0250`. Visually confirm in the PDF/Word output that no question is ever separated from its YES/NO line by a page break, for every property — matching the reference attachment exactly.

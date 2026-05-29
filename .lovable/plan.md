# Re-apply Addendum to Note Event of Default fixes

## Diagnosis (why the previous fix didn't take effect)

Inspecting the source `.docx` confirms the root cause:

- In the template XML, **Option 1**, **Option 2**, and the red helper note (`(this is conditional based on…)`) are **all inside one single paragraph** — the big "Remedies Upon Event of Default…" paragraph — not as separate paragraphs.
- The previous `rewrite-addendum-default-template` edge function assumed they were three separate paragraphs. Its `isOption1Like` branch did match this combined paragraph, but it then called `rewriteParagraphText(..., FULL_SENTENCE)`, which **replaces every run in the entire paragraph with just the conditional sentence**, wiping the legal opening ("Remedies Upon Event of Default. Upon the occurrence of an Event of Default… interest rate applicable to the outstanding principal balance shall increase") and the trailing legal text ("No delay or omission by Lender in exercising any right or remedy…").
- A `_v3.docx` was uploaded and `templates.file_path` was updated, but either (a) the rewrite produced a paragraph missing the legal opening and trailing text, or (b) the regex matched a different paragraph and the Option 1/2/red-helper text was left untouched. The user-visible output ("Option 1: … 0 percent 0 … Option 2: … to a flat rate of …") matches case (b).

Field publishing (`ln_p_defaultInterestModifierEnabled`, `ln_p_defaultInterestFlatRateEnabled`, `ln_p_defaultInterestModifier`, `ln_p_defaultInterestFlatRate`) is already correct in `supabase/functions/generate-document/index.ts` (lines 1911–1917) — no changes needed there.

## What needs to change

Rewrite the one-shot edge function so it does a **surgical segment replacement inside the single paragraph**, instead of a whole-paragraph replace.

### Target paragraph (current text)

> …interest rate applicable to the outstanding principal balance shall increase **Option 1: to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time. Option 2: to a flat rate of {{ln_p_defaultInterestFlatRate}} (the "Default Rate"). (this is conditional based on the selection made in "Default Interest" on the "Penalties" Tab in "Loan")** No delay or omission by Lender in exercising any right or remedy…

### Target paragraph (after rewrite)

> …interest rate applicable to the outstanding principal balance shall increase **{{#if ln_p_defaultInterestModifierEnabled}}to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.{{else if ln_p_defaultInterestFlatRateEnabled}}to a flat rate of {{ln_p_defaultInterestFlatRate}}%{{/if}} (the "Default Rate").** No delay or omission by Lender in exercising any right or remedy…

- "Option 1:" / "Option 2:" labels removed.
- Red helper sentence `(this is conditional based on … "Loan")` removed.
- Conditional now uses `ln_p_defaultInterestModifierEnabled` / `ln_p_defaultInterestFlatRateEnabled`, falling back to nothing when neither is checked.
- `(the "Default Rate").` placed outside the `{{/if}}` so it always renders.
- `%` suffix on Flat Rate restored (Bug 2).
- All other legal text and the rest of the document untouched.

## Technical approach (Technical Details section)

Rewrite `supabase/functions/rewrite-addendum-default-template/index.ts`:

1. Locate the paragraph whose concatenated `<w:t>` text contains the literal markers `Option 1:` AND `Option 2:` AND `defaultInterestFlatRate` AND `Default Rate`.
2. Build an ordered list of `{ runXml, runRPr, text }` from every `<w:r>` in that paragraph.
3. Concatenate the run texts into one flat string and locate the **start index of "Option 1:"** and the **end index of the helper sentence** (`… in "Loan")`).  Be tolerant of curly vs straight quotes.
4. Compute the prefix string (up to and including the space before "Option 1:") and the suffix string (everything after the helper sentence, starting with " No delay…").
5. Rebuild the paragraph as:
   - Preserve original `<w:pPr>`.
   - One run carrying `prefix` with the first run's `<w:rPr>` for consistent formatting.
   - One run carrying the new conditional segment (uses the first run's `<w:rPr>` so it is NOT red/bold).
   - One run carrying `suffix` with the first run's `<w:rPr>`.
   - Use `xml:space="preserve"` on every `<w:t>`.
6. Idempotency: if the paragraph already contains `{{#if ln_p_defaultInterestModifierEnabled}}` and does not contain `Option 1:` / `Option 2:` / `(this is conditional`, skip and report no change.
7. Bump version: `_v3.docx` → `_v4.docx`, upload to `templates` storage bucket, update `templates.file_path` for the row where `name = 'ADDENDUM TO NOTE EVENT OF DEFAULT'`.
8. Add a `?verify=1` JSON branch that downloads the new file and returns whether the rewritten paragraph contains the expected markers and no longer contains `Option 1:` / `Option 2:` / `this is conditional`.

After deployment:
- Invoke the function once via curl to perform the rewrite.
- Invoke with `?verify=1` to confirm the new `.docx` actually contains `{{#if ln_p_defaultInterestModifierEnabled}}` and no longer contains the removed strings.
- Report the verified state back.

## Out of scope (do not change)

- Field key names (`br_p_fullName`, `ln_p_loanNumber`, `ln_p_defaultInterestModifier`, `ln_p_defaultInterestFlatRate`).
- Field publishing in `generate-document/index.ts` — already correct.
- Borrower signature line, date line, page numbering, and all other static legal text.
- Tag-parser handling of split runs (already works via `curlyFragmentedPattern`).
- Any UI, schema, or other templates.

## Success criteria

- Template `ADDENDUM TO NOTE EVENT OF DEFAULT` storage file is at `_v4.docx`, `templates.file_path` updated.
- Verification call confirms: paragraph contains `{{#if ln_p_defaultInterestModifierEnabled}}`, contains `{{else if ln_p_defaultInterestFlatRateEnabled}}`, ends with `(the "Default Rate").`, and does NOT contain `Option 1:`, `Option 2:`, or `this is conditional`.
- Legal text before "increase" and after `(the "Default Rate").` is preserved unchanged.
- With Modifier checked + value entered: document renders "to a rate equal to N percent (N%) above the Note rate at that time. (the 'Default Rate')."
- With Flat Rate checked + value entered (and Modifier unchecked): document renders "to a flat rate of N% (the 'Default Rate')."
- With neither checked: document renders " (the 'Default Rate').".

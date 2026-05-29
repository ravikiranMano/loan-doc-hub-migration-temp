# Fix ADDENDUM TO NOTE EVENT OF DEFAULT Template

Three bugs to fix. Field key names are already correct in the dictionary (`ln_p_defaultInterestModifierEnabled` and `ln_p_defaultInterestFlatRateEnabled` exist as booleans), so no schema changes required.

## Bug 1 — Split tags across XML runs

The parser at `supabase/functions/_shared/tag-parser.ts` already strips `<w:proofErr/>` and consolidates adjacent runs, but only inside paragraphs that already contain `{`, `«`, or `»`. When a `{{` itself is split across runs the paragraph still qualifies (the `{` characters are present), but to be safe we will also:

- Ensure the proofErr/bookmark stripper runs before brace-repair on every paragraph that contains any `{` or `}` (already true), and
- After stripping, run an extra adjacent-run consolidation pass that targets the specific pattern `}}…proofErr…{{` and merges sibling `<w:t>` elements that, when concatenated, form a complete `{{key}}` token.

Concretely, in `normalizeWordXml`, add a small post-strip pass that collapses any `</w:t></w:r><w:r…><w:t…>` sequence sitting between `{{` and `}}` on the same paragraph into a single `<w:t>` run.

This makes all six occurrences in this template resolve as a single clean tag without touching field key names.

## Bug 2 — Missing parentheses in Option 1

Edit the DOCX template stored at `templates/1779997783876_ADDENDUM_TO_NOTE_EVENT_OF_DEFAULT_v1.docx` (template id `a678600f-c1f9-44fc-ba89-24513fef507d`).

Replace the second `{{ln_p_defaultInterestModifier}}` in Option 1 with `({{ln_p_defaultInterestModifier}}%)` so the sentence reads:

```
to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.
```

## Bug 3 — Add conditional logic, remove Option labels and red helper text

In the same DOCX, replace the entire Option 1 / Option 2 block (including the `Option 1:` and `Option 2:` labels and the red `(this is conditional based on…)` instruction) with:

```
{{#if ln_p_defaultInterestModifierEnabled}}
to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.
{{else if ln_p_defaultInterestFlatRateEnabled}}
to a flat rate of {{ln_p_defaultInterestFlatRate}}%
{{/if}}
(the "Default Rate").
```

When neither checkbox is set, both branches are skipped and the sentence collapses to `…shall increase (the "Default Rate").` as expected.

## Implementation steps

1. **Edge function** — update `supabase/functions/_shared/tag-parser.ts` `normalizeWordXml` with the targeted `{{…}}` run-consolidation pass described in Bug 1 (no behavior change for non-tag paragraphs). Deploy the affected functions (`generate-document` and any peers that bundle the shared parser).
2. **Template DOCX** — write a one-shot edge function `rewrite-addendum-default-template` that:
   - Downloads `1779997783876_ADDENDUM_TO_NOTE_EVENT_OF_DEFAULT_v1.docx` from the `templates` bucket.
   - Unzips, edits `word/document.xml` to apply Bug 2 + Bug 3 rewrites (regex anchored on the Option 1 / Option 2 paragraphs, preserving surrounding static legal text, signature, date, and page numbering).
   - Removes the red helper paragraph.
   - Re-zips and uploads as a new version `…_v2.docx`, then updates the `templates` row's `file_path`.
   - Returns a diff summary so we can verify before/after.
3. **Verification** — re-render the template for a deal with: (a) modifier checked, value 5; (b) flat rate checked, value 18; (c) neither checked. Confirm output matches the three expected snippets in the brief and that `Borrower:` and `Loan No.:` resolve to the live values.

## Out of scope (do not change)

- Any field key names.
- Any other template text, signature line, date line, or page numbering.
- Any other forms, components, or database schema.

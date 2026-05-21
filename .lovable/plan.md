# Fix RE870 "NAME OF PERSON COMPLETING THIS QUESTIONNAIRE"

## Scope (confirmed)
- Fix the primary lender's name rendering only.
- Modify and re-upload the `re870_-_Investor_Questionnaire_-_Field_Key_mapping_1_2.docx` template.
- Do NOT touch `generate-document`, `_shared/types.ts`, `_shared/tag-parser.ts`, the multi-lender pipeline, or any other template.
- Additional lenders continue to be handled by the existing auto-append signature block logic (unchanged).

## Current state (from inspected template)
- The template contains one occurrence of:
  `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE {{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}`
- No `{{#each lenders}}` block exists, and only one questionnaire body exists. Per the confirmed scope, no repeater needs to be introduced.

## Change
Replace the three back-to-back tags with a properly spaced, middle-name-conditional sequence resolved for the primary lender:

Before:
`{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}`

After:
`{{ld_p_firstIfEntityUse}} {{#if ld_p_middle}}{{ld_p_middle}} {{/if}}{{ld_p_last}}`

Notes:
- Keep the `ld_p_*` (primary-lender) namespace — the spec's `this.*` form only applies inside an `{{#each lenders}}` block, which we are intentionally not adding. The user's expected outputs (Horizon Capital LLC Lender, BlueStone Investments Inc Lender, Sarah Mitchell, Michael Carter) match `ld_p_firstIfEntityUse` (entity name when entity, else first) + optional middle + last — which is exactly the existing resolver behavior for the primary lender.
- `ld_p_firstIfEntityUse` is already populated by the resolver; no backend change required.
- The conditional avoids the double-space when middle is empty (Sarah Mitchell, Michael Carter cases).

## Implementation steps

1. Locate the template in storage and DB:
   - `select id, name, file_path from document_templates where name ilike '%re870%' or file_path ilike '%re870%';`
   - Download the current `.docx` from the `templates` bucket at that `file_path`.

2. Edit the template (XML-safe):
   - Unzip the `.docx`, open `word/document.xml`.
   - The three tags currently sit in adjacent `<w:r>` runs inside one paragraph. Replace the run sequence so the final visible text becomes:
     `{{ld_p_firstIfEntityUse}} {{#if ld_p_middle}}{{ld_p_middle}} {{/if}}{{ld_p_last}}`
   - Preserve the existing `<w:rPr>` (font, size, bold) on every new run so formatting is identical to the original tags.
   - Use `xml:space="preserve"` on any `<w:t>` that contains a leading/trailing space (the literal space between tags, and the space after `{{ld_p_middle}}` inside the `#if`).
   - Re-zip with the same internal structure (no recompression of unrelated parts).

3. Re-upload the edited `.docx` to the `templates` bucket at the same `file_path`, overwriting the existing object. Do not change `document_templates.file_path`, `name`, `packet_id`, or any other column.

4. Bust any cached template bytes in `generate-document` (the engine already re-fetches from storage on each run per the doc-gen engine memory; no code change needed). Confirm by regenerating once.

## Verification (DL-2026-0266)
- Generate RE870 for the deal. Confirm the line renders as:
  - `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE Horizon Capital LLC Lender`
  (because primary lender = L-00017, last name = "Lender" per the screenshot).
- Regression checks:
  - A deal whose primary lender is an individual with no middle name renders `First Last` (single space, no trailing/leading space).
  - A deal whose primary lender has a middle name renders `First Middle Last`.
  - All other RE870 tags (`ld_p_lenderType`, `ld_p_vesting`, `ld_p_investorQuestiDue*`) continue to resolve unchanged.
  - Other templates in the bucket are untouched.

## Out of scope (explicitly NOT changing)
- No `{{#each lenders}}` wrapping in this template.
- No changes to `supabase/functions/generate-document/index.ts`, `_shared/types.ts`, `_shared/tag-parser.ts`, resolver priority order, or `<w:rPr>` formatting beyond preserving the original.
- No new dependencies, no schema changes, no field_dictionary edits.
- Additional lenders' name handling stays on the existing auto-appended signature-block path.

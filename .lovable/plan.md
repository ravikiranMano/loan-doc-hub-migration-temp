## Root cause

The CPU timeout is **not** a runtime/database issue — it's a structural template + engine amplification problem:

1. **Static repetition with the same `_N` token.** The uploaded `RE851D-V12.1-2.docx` contains:
   - **Part 1 LTV table** with 5 rows, each row using literally `{{property_number_N}}`, `{{ln_p_remainingEncumbrance_N}}`, … (the literal letter `N`).
   - **PROPERTY #1 … PROPERTY #5** sections, each duplicated by hand, also using the literal `_N`.
   - After the engine's `_N` rewrite, every duplicated block resolves to the **same index**, so all 5 rows render the same property and the engine still pays the cost of scanning, publishing, and tag-matching for every one of them.

2. **Broken / malformed placeholders.** Several tags are corrupted in the .docx XML, which forces the tag-parser into expensive recovery passes:
   - `{{property_type_land_income_N}LAND` — missing closing `}}`.
   - `{{property_type_other _text_N}}` — embedded space inside the tag.
   - `{{propert y_numbe r_N}}`, `{{ln_p_remaini ngEncumbranc e_N}}`, `{{pr_p_appr aiseValue_ N }}`, etc. — words split by Word "smart" spans inserting whitespace mid-token.
   - Mixed `pr_p_occupanc_N` vs `pr_p_occupancy_N` and `pr_p_appr aiseValue_N` vs `pr_p_appraisedValue_N`.

3. **Engine amplification.** `supabase/functions/generate-document/index.ts` (template-gated by `/851d/i.test(template.name)`) runs ~30 separate per-property publisher blocks (`for (const idx of sortedPropIndices)` loops). When the document has 5 manually-cloned blocks AND 5 real properties, the safety-pass scans (`re851d-cure-delinquency-checkboxes`, `remain-unpaid-checkboxes`, anti-fallback shield, encumbrance per-slot publisher, etc.) walk a ~4MB `document.xml` for each property × each pass, exhausting the Edge Function CPU budget.

## Fix plan

### A. Template surgery (the .docx itself — primary fix)

These are non-negotiable; the engine cannot rescue a malformed template.

1. **Part 1 LTV table — collapse to deterministic indexed rows.** Replace the 5 identical `_N` rows with 5 rows that hard-code the index suffix (matches the existing `pr_p_*_1 … _5` publisher contract):

   ```
   Row 1: {{property_number_1}} {{ln_p_remainingEncumbrance_1}} {{ln_p_expectedEncumbrance_1}} {{ln_p_totalEncumbrance_1}} {{pr_p_appraiseValue_1}} {{ln_p_amountOfEquity_1}} {{ln_p_equitySecuringLoan_1}} {{ln_p_loanToValueRatio_1}}
   Row 2: …_2
   Row 3: …_3
   Row 4: …_4
   Row 5: …_5
   ```

   The existing per-property publishers in `index.ts` already write `_1 … _5`, so blank indices render empty cells (matches the spec: only real properties populate, extras stay blank).

2. **PROPERTY #1 … PROPERTY #5 sections — switch literal `_N` to indexed tags.** Inside the PROPERTY #1 block change every `_N` to `_1`; inside PROPERTY #2 → `_2`; etc. This includes:
   - `pr_p_address_N` → `pr_p_address_1` (and 2, 3, 4, 5 in their respective blocks)
   - `pr_p_occupanc_N` → `pr_p_occupancy_1` (also fix the misspelling)
   - `pr_li_sourceOfInformation_N`, `pr_li_sourceInfoBroker_N_glyph`, `pr_li_sourceInfoBorrower_N_glyph`, `pr_li_sourceInfoOther_N_glyph`, `pr_li_sourceInfoOtherText_N`, `pr_li_delinquencyPaidByLoan_N_yes_glyph`/`_no_glyph`, `pr_li_sourceOfPayment_N`, `pr_li_currentDelinqu_N_*`, `ln_p_*_N` → all suffixed with the section's index.
   - `{{#if (eq pr_p_occupanc_N "Owner Occupied")}}` → `{{#if (eq pr_p_occupancy_1 "Owner Occupied")}}` per section.

3. **Repair malformed placeholders.** In Word, retype each broken tag in a single run (or in the unpacked XML, replace the split runs with one `<w:r><w:t>{{name_N}}</w:t></w:r>`):
   - `{{property_type_land_income_N}LAND` → `{{property_type_land_income_N}} LAND`
   - `{{property_type_other _text_N}}` → `{{property_type_other_text_N}}`
   - All split words: `propert y_numbe r_N` → `property_number_N`, `ln_p_remaini ngEncumbranc e_N` → `ln_p_remainingEncumbrance_N`, `pr_p_appr aiseValue_ N` → `pr_p_appraiseValue_N`, `ln_p_loan ToValueRati o_N` → `ln_p_loanToValueRatio_N`, etc.

4. **Delete unused PROPERTY blocks at template level only if always ≤ N properties expected.** Otherwise leave 5 blocks but make them deterministic per step 2 — empty per-index publishes will render blank.

### B. Engine cleanup in `supabase/functions/generate-document/index.ts`

Goal: keep functional behavior identical but stop walking the XML once per property × per safety pass.

1. **Coalesce the per-property safety passes.** Today each of the following runs its own loop over `sortedPropIndices` and scans `document.xml`:
   - `re851d-cure-delinquency-checkboxes`
   - `re851d-remain-unpaid-checkboxes`
   - `re851d-questionnaire-q1-q6-mapping` (Q1 post-render)
   - `re851d-encumbrance-mapping` per-slot publisher
   - `re851d-lien-questionnaire-glyph-resolution` anti-fallback shield
   - `re851d-additional-encumbrance-attachment` per-property YES/NO
   - `re851d-multi-property-mapping` Part 2 type×occupancy
   - `re851d-performed-by-mapping`, `re851d-annual-property-taxes-mapping`, etc.

   Refactor into a single `for (const idx of sortedPropIndices) { … }` block that publishes **all** `_idx` aliases in one pass. Field-resolution remains identical because every key is still an idempotent assignment to the `fieldValues` map; we're only removing redundant outer iteration.

2. **Cap iteration to real properties.** Replace the current `sortedPropIndices` (raw indices that include phantom prefixes) with `realPropertyIndices` (already computed at line ~1174). Stop publishing for missing properties — the anti-fallback shield then writes default `☐` glyphs once per missing index instead of running every publisher block for it.

3. **Single-pass `_N` rewrite.** The engine currently rewrites `_N` to each index in separate sweeps inside per-section blocks. Switch to one regex pass per `xml` chunk that expands `{{name_N}}` → `{{name_1}}, {{name_2}}, …` exactly once at the start of processing for `/851d/i` templates, then resolve normally.

4. **Skip publishers for indices with no source data.** Each per-property block already has an early `continue` in some branches; extend it uniformly so e.g. encumbrance/delinquency publishers exit immediately when `lienK.property` doesn't match `idx`.

### C. Verification

- Run the existing tag-parser tests (`tag-parser.*.test.ts`) — they cover servicing/amortization/payable/subordination paths and must stay green.
- Generate a 1-property RE851D and a 5-property RE851D from the deal that previously timed out (`/deals/a4eefafb-…/documents`). Confirm:
  - Each property renders exactly once.
  - No duplicate rows in Part 1.
  - Encumbrance, delinquency, occupancy glyphs land in the correct property block.
  - Generation completes well under the Edge CPU budget.

## Out of scope

- No DB schema changes, no new tables, no new edge functions.
- No changes to data-entry UI — only the .docx template + the existing edge function.
- Document-generation flow stays the same (`generate-document` edge function, same request/response shape).

## Files touched

- `RE851D-V12.1-2.docx` (template — re-uploaded via existing template upload UI).
- `supabase/functions/generate-document/index.ts` (per-property loop coalescing).
- Possibly `supabase/functions/_shared/tag-parser.ts` for the single-pass `_N` rewrite helper, if needed.

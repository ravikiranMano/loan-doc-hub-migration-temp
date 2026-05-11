## Goal

Publish a per-property text alias `pr_li_sourceOfInformation_N` for RE851D, sourced from the property's lien `source_of_information`, with proper lien selection and N-property support.

## Field key

- `pr_li_sourceOfInformation_N` — raw text (Broker / Borrower / Lender / Title / Prelim / Public Record / etc.)

Note: distinct from the existing `pr_li_sourceInfoBroker/Borrower/Other_N` checkbox aliases (already implemented). This new tag is the plain text label rendered next to "SOURCE OF INFORMATION" in the document.

## Source data

`lienK.source_of_information` where `lienK.property === "propertyN"`.

## Lien selection (per property)

1. Filter liens to those bound to `propertyN`.
2. Prefer lien with `lien_priority_after === "1st"` (string ordinal stored by `lienCalculationEngine.formatOrdinal`).
3. Else first valid lien (lowest `lienK` index) with non-empty `source_of_information`.
4. Else first lien for the property regardless of value.
5. If no lien: write empty string (template renders blank). No "N/A" fallback unless user prefers it.

## Implementation (single file)

`supabase/functions/generate-document/index.ts` — extend the existing RE851D lien block (around lines 2785–2890 where `sourceInfoFirst` aggregation already exists). Do not refactor.

1. **Extend `perProp` aggregation buckets**: add `sourceOfInfoText: string` and `sourceOfInfoPriorityFound: boolean`.
   - On each `lienK` for the property: if `lien_priority_after === "1st"` and not yet set, store `source_of_information` as `sourceOfInfoText` and mark `sourceOfInfoPriorityFound = true`.
   - Else if not priority-found and `sourceOfInfoText` empty and `source_of_information` non-empty, store it (first-valid fallback).

2. **In the per-property publish loop**: emit `setText(`pr_li_sourceOfInformation_${pIdx}`, b.sourceOfInfoText || "")`.

3. **Add to `SHIELD_BASES`**: `pr_li_sourceOfInformation` (text, no `_glyph`).

4. **Add to `RE851D_INDEXED_TAGS`**: `pr_li_sourceOfInformation_N`.

5. Deploy `generate-document` edge function.

## Out of scope

- No UI, DB, field_dictionary, template `.docx` changes.
- Existing checkbox publisher (`pr_li_sourceInfoBroker/Borrower/Other_N`) untouched.
- No Property Tax source involvement.

## Validation

Generate RE851D with: P1 lien priority 1st = "Broker"; P2 two liens (1st="Borrower", 2nd="Lender") → expect "Borrower"; P3 only non-1st liens with "Title / Prelim" → expect "Title / Prelim"; P4 no liens → expect blank.

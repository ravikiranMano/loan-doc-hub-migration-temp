## Goal

Map RE851D "Source of Information" checkboxes (Broker Inquiry / Borrower / Other) per property, derived from `lienK.source_of_information`, with full N-property support. Add an "Other (Explain)" text alias for non-Broker/Borrower values.

## Field keys (template tags)

Per property `_N` (and also published per-lien `_K` for safety):

- `pr_li_sourceInfoBroker_N` (+ `_glyph`)
- `pr_li_sourceInfoBorrower_N` (+ `_glyph`)
- `pr_li_sourceInfoOther_N` (+ `_glyph`)
- `pr_li_sourceInfoOtherText_N` (text)

Mutually exclusive: exactly one `_glyph` is `☑`, the other two `☐`. If a property has no lien, all three `_glyph` default to `☐` (no auto-NO behavior; matches form layout — empty checkboxes).

## Source data

`lienK.source_of_information` (UI key in `LienDetailForm` / `LienModal`, dropdown values: `Borrower`, `Broker`, `Lender`, `Title / Prelim`, `Public Record`).

Match rules (case-insensitive, trimmed):
- `"broker"` → Broker checked
- `"borrower"` → Borrower checked
- anything else non-empty → Other checked, `pr_li_sourceInfoOtherText_N = <value>`
- empty → all unchecked, otherText = `""`

## Per-property rule

For property index `N`, use the **first lien** (lowest `lienK` ordinal) where `lienK.property === "propertyN"`. Ignore later liens for the checkbox decision. Do not fall back across properties.

## Implementation (single file)

`supabase/functions/generate-document/index.ts`, inside the existing RE851D lien-delinquency block (around line 2686–2840) — extend, do not refactor:

1. **In the `orderedLiens.forEach` per-lien loop** (after existing `setText pr_li_sourceOfPayment_${lienIdx}`):
   - Read `getLienVal(prefix, "source_of_information", "sourceOfInformation")`.
   - Compute `isBroker`, `isBorrower`, `isOther` (= non-empty AND not broker/borrower).
   - Publish `pr_li_sourceInfoBroker_${lienIdx}` (+ `_glyph`), `_Borrower_${lienIdx}` (+ `_glyph`), `_Other_${lienIdx}` (+ `_glyph`), `pr_li_sourceInfoOtherText_${lienIdx}` (only when `isOther`, else `""`).

2. **In the `perProp` aggregation buckets**, add fields: `sourceInfoFirst: string` and `sourceInfoFirstLienIdx: number | null`. Populate ONLY when `b.sourceInfoFirstLienIdx === null` (i.e., keep the first lien's value).

3. **In the per-property publish loop** (after `pr_li_sourceOfPayment_${pIdx}` set), publish the four `_N` aliases using the property's first-lien source value with the same broker/borrower/other resolver. When no lien exists for the property, write empty string + `☐` for all three glyphs.

4. **Add to `SHIELD_BASES`** (lines 1794–1841):
   - `pr_li_sourceInfoBroker`, `pr_li_sourceInfoBroker_glyph`
   - `pr_li_sourceInfoBorrower`, `pr_li_sourceInfoBorrower_glyph`
   - `pr_li_sourceInfoOther`, `pr_li_sourceInfoOther_glyph`
   - `pr_li_sourceInfoOtherText`

5. **Extend `GLYPH_DEFAULTS_NO_CHECKED`** sibling logic only for these three glyph keys to default to `☐` (not `☑`) — they should be empty when no data, never auto-NO.

6. **Add to `RE851D_INDEXED_TAGS`** (line 3674+):
   - `pr_li_sourceInfoBroker_N_glyph`, `pr_li_sourceInfoBroker_N`
   - `pr_li_sourceInfoBorrower_N_glyph`, `pr_li_sourceInfoBorrower_N`
   - `pr_li_sourceInfoOther_N_glyph`, `pr_li_sourceInfoOther_N`
   - `pr_li_sourceInfoOtherText_N`

7. Deploy `generate-document` edge function.

## Out of scope

- No UI changes (LienDetailForm/LienModal already have `Source of Information` field).
- No DB schema, no field_dictionary changes, no template `.docx` edits.
- No other RE851D passes (delinquency, encumbrance, multi-property, taxes) are touched.
- No post-render checkbox safety pass added (template uses direct `_glyph` substitution, mirroring existing `pr_pt_actual_N_glyph` / `pr_pt_estimated_N_glyph` pattern).

## Validation

- Generate RE851D with mixed liens: P1 lien=Broker, P2 lien=Borrower, P3 lien=Title/Prelim, P4 no lien.
- Expect: P1 ☑ Broker; P2 ☑ Borrower; P3 ☑ Other with "Title / Prelim" in explain blank; P4 all ☐.

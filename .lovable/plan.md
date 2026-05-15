## Goal

Extend RE851D doc generation so the lien-detail page (the two ENCUMBRANCE grids — Remaining + Expected/Anticipated, plus the "Additional remaining…" YES/NO line and addendum hook) renders **once per property** found in the loan file (up to 5), each on its own page, each filtered to that property's liens, without touching anything that already works for Property 1.

## What already works (do not modify)

- In-render publisher writes `pr_li_rem_<field>_{N}_{S}` and `pr_li_ant_<field>_{N}_{S}` per property index N, per slot S=1,2 (lines ~3947, ~5179–5216).
- Label-anchored encumbrance publisher (lines ~8816–9450) walks each "PROPERTY INFORMATION" region in the document, finds the two ENCUMBRANCE sections, and writes the resolved values into slot 1 / slot 2 cells.
- Additional-encumbrance attachment + balloon checkbox safety passes already key off N per property region.
- Multi-property aliases for `pr_p_*_N`, `pr_pt_*_N`, `pr_li_rem_priority_{P}_{S}` etc. all publish for N=1..5.

So the **only gap** is the template itself: it carries one Property's ENCUMBRANCE grids. Once we duplicate that grid block per real property, every existing publisher fires correctly because they already iterate by N.

## Plan

### 1. Mark the cloneable block in the template (one-time helper)

Extend `supabase/functions/rewrite-re851d-template/index.ts` (or add a sibling `rewrite-re851d-property-block`) to wrap the existing single Property's lien-detail block with two invisible sentinels in `word/document.xml`:

```text
<!-- PROPERTY_LIEN_BLOCK_START -->
…existing PROPERTY INFORMATION heading + ENCUMBRANCE(S) REMAINING table
   + ENCUMBRANCE(S) EXPECTED OR ANTICIPATED table
   + "Additional remaining, expected, or anticipated encumbrances…" YES/NO row
   + Broker/Lender initials row…
<!-- PROPERTY_LIEN_BLOCK_END -->
```

Sentinels are XML comments so Word ignores them; we use them as cut-points for the runtime cloner. Run this rewrite once against the active RE851D template.

### 2. Runtime block cloner (new pass in `generate-document/index.ts`)

Add a new pass that runs **before** all the existing 851D label-anchored / safety / addendum passes (so they see N copies instead of 1):

1. Detect template name matches `851d`.
2. Read `word/document.xml`.
3. Determine the property count K from `fieldValues`:
   - Scan keys `property{N}.address` / `property{N}.appraise_value` for N=1..5; K = max N seen, capped at 5, min 1.
4. Locate the slice between `PROPERTY_LIEN_BLOCK_START` and `PROPERTY_LIEN_BLOCK_END`.
5. For i = 2..K, build a clone of the slice with these XML-safe rewrites:
   - Insert a `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` page break before the clone.
   - Bump every `w:id="…"`, `w:bookmarkStart/End @w:id`, `w:sdt @w:id` by `i * 100000` to prevent ID collisions.
   - Bump every `w:name="…"` bookmark by suffix `_p{i}`.
   - Leave merge-tag text `{{pr_li_rem_*_{N}_{S}}}` untouched — the existing per-property publisher already writes the resolved values into the i-th PROPERTY region by visible-text position, and the in-render publisher writes `_{i}_{S}` keys.
6. Splice the K-1 clones in order immediately before `PROPERTY_LIEN_BLOCK_END`.
7. Repack and feed the rewritten DOCX into the rest of the pipeline.

This guarantees the existing per-region scanner sees K "PROPERTY INFORMATION" anchors → `propRanges` becomes K entries → every downstream publisher (encumbrance values, balloon safety, additional-encumbrance YES/NO, addendum) fires per-property automatically.

### 3. Field mapping that will resolve per property

For each property i ∈ {1..K}, slot S ∈ {1,2}, the **same** keys you already use for Property 1 will fill the i-th cloned page (no new keys, no template edits beyond the sentinels):

| Cell label                   | Property i, slot S key                       |
|------------------------------|----------------------------------------------|
| PRIORITY (1ST, 2ND, ETC.)    | `pr_li_rem_priority_{i}_{S}`                 |
| INTEREST RATE                | `pr_li_rem_interestRate_{i}_{S}`             |
| BENEFICIARY                  | `pr_li_rem_beneficiary_{i}_{S}`              |
| ORIGINAL AMOUNT              | `pr_li_rem_originalAmount_{i}_{S}`           |
| APPROXIMATE PRINCIPAL BAL.   | `pr_li_rem_principalBalance_{i}_{S}`         |
| MONTHLY PAYMENT              | `pr_li_rem_monthlyPayment_{i}_{S}`           |
| MATURITY DATE                | `pr_li_rem_maturityDate_{i}_{S}`             |
| BALLOON YES / NO / UNKNOWN   | `pr_li_rem_balloonYes_{i}_{S}` / `…No…` / `…Unknown…` |
| IF YES, AMOUNT               | `pr_li_rem_balloonAmount_{i}_{S}`            |

Anticipated grid uses the identical shape with `pr_li_ant_*_{i}_{S}`:
`priority`, `interestRate`, `beneficiary`, `originalAmount`, `monthlyPayment`, `maturityDate`, `balloonYes/No/Unknown`, `balloonAmount`.

Per-property addendum / overflow keys already published by the existing pipeline:

- `pr_li_additionalEncumbranceYes_glyph_{i}` / `…No_glyph_{i}`
- Addendum tables for liens beyond slot 2 are appended per i via the existing additional-encumbrance attachment pass.

### 4. Filtering correctness (already enforced)

The existing in-render publisher groups liens by `lien.property` match, so `pr_li_rem_*_{i}_{S}` only contains liens whose `property` field equals property i. No new filtering needed.

### 5. Verification

- Run a deal with 1 property → identical output to today (clone loop is a no-op).
- Run a deal with 3 properties → 3 lien-detail pages, each on a fresh page, each with only its own liens; properties 4–5 absent.
- Run a deal with 5 properties + property 3 has 4 remaining liens → property 3 page shows YES on the additional-encumbrance row and an addendum is appended after that property's page only.

### Out of scope (explicitly not changing)

- Property 1 mappings, layout, styling.
- In-render publishers and the label-anchored value writer.
- Balloon / additional-encumbrance / questionnaire safety passes.
- Field naming conventions and parser architecture.

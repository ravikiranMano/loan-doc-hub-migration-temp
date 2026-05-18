## Goal

Fix the RE851D "Source of Information" checkbox row so it always renders as:

```
☐ BROKER INQUIRY   ☐ BORROWER   ☑ OTHER (EXPLAIN): Public Record
```

…regardless of how Word fragmented the original `{{pr_li_sourceInfoBroker_N_glyph}}` / `{{pr_li_sourceInfoBorrower_N_glyph}}` / `{{pr_li_sourceInfoOther_N_glyph}}` / `{{pr_li_sourceInfoOtherText_N}}` tags across `<w:r>` runs (which currently leaks raw `…glyph}}` text and produces no space between the glyph and the label).

This is a generator-only fix. No template re-uploads, no UI changes, no schema changes, no changes to which field drives which checkbox (already correctly published per-property by the existing block at lines ~3818–3823 and ~3937–3943 in `supabase/functions/generate-document/index.ts`).

## Scope

Single file edited:

- `supabase/functions/generate-document/index.ts` — add one new label-anchored safety pass (mirroring the existing RE851A Payable / Servicing / RE851D Cure Delinquency safety passes already documented in memory) that runs inside the existing RE851D post-render pipeline.

No other files are modified. No new edge function, no template rewrite endpoint, no migrations.

## How it works (technical)

The new pass runs once per property region after all `_N` → `_K` rewrites and Handlebars resolution have completed, scoped exactly like the existing `pr_li_currentDelinqu` and `delinquencyPaidByLoan` safety passes (the same region-walking helper that already iterates property regions in the encumbrance pipeline).

For each property region K it:

1. Reads the already-published per-property values:
   - `pr_li_sourceInfoBroker_K` (boolean)
   - `pr_li_sourceInfoBorrower_K` (boolean)
   - `pr_li_sourceInfoOther_K` (boolean)
   - `pr_li_sourceInfoOtherText_K` (string)
2. Builds an XML-flex regex (whitespace + `<[^>]+>` tolerant, identical to the helper used by the Payable safety pass in `tag-parser.payable-frequency.test.ts`) for each label literal: `BROKER INQUIRY`, `BORROWER`, `OTHER (EXPLAIN)`.
3. For each label, in the paragraph(s) that contain all three labels:
   - Forces the glyph immediately preceding the label to `☑` or `☐` based on the boolean.
   - Scrubs any leaked Handlebars residue (`{{…glyph}}`, `{{pr_li_sourceInfoOtherText_N}}`, stray `_N`/`_K` tokens) inside the matched span — same scrub pattern already used by the RE851D balloon safety pass (memory: *RE851D Balloon Payment Checkboxes*).
   - Inserts exactly one regular space between glyph and label text when the inter-glyph/label run carries none (handled by emitting `<w:t xml:space="preserve"> </w:t>` so Word keeps the space).
4. For `OTHER (EXPLAIN)` specifically:
   - Ensures a single space after the colon, then the resolved `pr_li_sourceInfoOtherText_K` value, or empty string when unchecked.
   - If no `:` exists in the matched run because it was fragmented, the pass injects `: ` between the label and the value run.

Word-boundary guards (`(?<![A-Za-z])` / `(?![A-Za-z])`) follow the same convention as the Payable test fixture so labels like `BORROWERS` or `BROKERAGE` are never touched.

The pass is idempotent: running it on already-correct XML produces no diff.

## Verification

1. Add a Deno test file `supabase/functions/_shared/tag-parser.source-info.test.ts` mirroring the structure of `tag-parser.payable-frequency.test.ts`, covering:
   - All three single-checked cases (Broker, Borrower, Other) produce exactly one ☑ and two ☐.
   - `OTHER` checked with text `Public Record` renders as `☑ OTHER (EXPLAIN): Public Record` with exactly one space after the colon.
   - All three unchecked → three ☐ with single spaces, empty OTHER text.
   - Fragmented input (label inside a separate `<w:t>` from glyph, with leaked `{{…glyph}}` residue) is normalized.
   - Word-boundary guard: `BORROWERS` / `BROKERAGE` are not affected.
2. Regenerate the RE851D doc for the current deal and confirm visually that the row matches `☐ BROKER INQUIRY ☐ BORROWER ☑ OTHER (EXPLAIN): Public Record`.

## Out of scope (explicitly not changing)

- The per-property publisher at lines 3818–3824 and 3937–3943 (already correct).
- The `RE851D_INDEXED_TAGS` list (already includes the four source-info families).
- The DOCX template file itself.
- Any other RE851D section (encumbrance YES/NO, delinquency, balloon, multiple properties, etc.).
- UI, database, APIs.
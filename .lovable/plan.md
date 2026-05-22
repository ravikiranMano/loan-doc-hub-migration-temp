# Fix RE851D — NAME / ADDRESS OF APPRAISER per property

## Root cause (confirmed)

The active V3 RE851D template (`1778746922135_RE851D-V12.1.docx` in the `templates` bucket) has **no Handlebars at all** in the NAME OF APPRAISER / ADDRESS OF APPRAISER cells. Both values are hardcoded literals ("BPO Performed by Broker" / "N/A") in every property section, so they render unconditionally for every property regardless of the UI "Performed By" dropdown.

The data-side pieces are already correct in `supabase/functions/_shared/tag-parser.ts`:

- Per-property publisher at lines ~2014–2048 emits, for each index N=1..K:
  - `pr_p_performedBy_N` / `pr_p_performeBy_N` ← `property{N}.appraisal_performed_by`
  - `pr_p_appraiserName_N` = `"BPO Performed by Broker"` if performedBy === `"Broker"`, else `""`
  - `pr_p_appraiserAddress_N` = `"N/A"` if performedBy === `"Broker"`, else `""`
- A safety pass (line ~6466+) and `rewrite-re851d-template` edge function already convert any surviving `{{#if (eq pr_p_perform*By_N "Broker")}}…{{/if}}` blocks to `{{pr_p_appraiserName_N}}` / `{{pr_p_appraiserAddress_N}}`.

What's missing is a one-shot rewrite that converts the **hardcoded** cell text in the stored V3 template into those same per-property merge tags. Nothing else needs to change — the publisher already produces the right per-property values.

## Approach (minimal change)

Add a new admin edge function `rewrite-re851d-hardcoded-appraiser` that:

1. Downloads the RE851D template from the `templates` bucket (default path `1778746922135_RE851D-V12.1.docx`, overridable via POST body).
2. Unzips `word/document.xml` using `fflate` (same pattern as the existing `rewrite-re851d-template/index.ts`).
3. Builds a tag-stripped index of the XML so it can locate the cell labels even when Word splits runs.
4. Walks the document looking for the labels `NAME OF APPRAISER` and `ADDRESS OF APPRAISER` (case-insensitive, whitespace-tolerant). For each occurrence in document order:
   - Identifies the **value cell** that follows the label cell in the same table row (`<w:tc>` boundary detection on the raw XML).
   - Counts the occurrence index K (1..number of property sections found) per label kind.
   - Replaces the entire run-content of that value cell with a single `<w:r><w:t xml:space="preserve">{{pr_p_appraiserName_K}}</w:t></w:r>` (or `{{pr_p_appraiserAddress_K}}`), preserving the cell's `<w:tcPr>` and paragraph properties.
   - Strictly scoped: only fires when the existing visible text in the value cell is exactly `BPO Performed by Broker` (for the name cell) or `N/A` (for the address cell). Any other content is left untouched.
5. Repacks and uploads back to the same path with `upsert: true`.
6. Returns `{ ok, templatePath, rewrittenNameCells, rewrittenAddressCells, propertiesDetected }`. Idempotent — re-running returns 0 rewrites.

After the rewrite runs once, the publisher's existing per-index values will flow through to all properties (including the missing Property 5 cell pattern, as long as that section exists structurally in the template — see Open question below).

## Verification

- Re-generate the document for deal `DL-2026-0250` and confirm:
  - Property 1 (Third Party) → both cells blank
  - Property 2 (Broker) → "BPO Performed by Broker" / "N/A"
  - Property 3 (Broker) → "BPO Performed by Broker" / "N/A"
  - Property 4 (Third Party) → both cells blank
  - Property 5 (Broker) → "BPO Performed by Broker" / "N/A"
- Re-run the rewrite function: response shows 0 rewrites (idempotency check).

## Files

- **New:** `supabase/functions/rewrite-re851d-hardcoded-appraiser/index.ts`
- **No changes** to `tag-parser.ts`, `field-resolver.ts`, the publisher, or any UI code — they already do the right thing.

## Open question (need confirmation before implementing)

The user states "Property 5 section is also missing and must be added" to the template. The existing `rewrite-re851d-multi-property-lien-cloner` memory describes a runtime XML cloner that duplicates Property 1's block for properties 2..K at generation time — but that cloner targets the ENCUMBRANCE block, not the appraisal block. Two options:

1. **(Recommended)** Only fix the hardcoded appraiser cells in the existing 4 property sections. If the V3 template structurally only has 4 appraisal sections, Property 5 won't get an appraiser row until the template itself is extended in Word — out of scope for an XML rewrite that must stay surgical.
2. Extend the rewrite to also clone Property 4's appraisal section as Property 5 inside the same edge function. Higher risk of layout drift.

Please confirm which option to take before I implement.

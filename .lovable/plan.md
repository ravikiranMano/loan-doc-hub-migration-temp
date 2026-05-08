## RE851D — Investigation summary

The user uploaded the mapped template (`Re851d_v1_1_2_13.docx`) and the generated output (`Re851d_v43.docx`). Diffing them showed:

**1. Template defect — malformed Handlebars tag (4 occurrences)**
Property blocks 2–5 contain `{{property_type_land_income_N}` (missing the trailing `}`). Only block #1 is well-formed (`{{...}}`). Because the closing braces are missing, the engine cannot parse them, so the literal text `property_type_land_income_N}` survives into the rendered document (visible today in blocks 2–5 of Part 2).

**2. Per-property values render blank in Part 2 (rows 1–5)**
The labels `PROPERTY OWNER`, `PROPERTY ADDRESS`, `REMAINING / EXPECTED / TOTAL SENIOR ENCUMBRANCE`, `CURRENT MARKET VALUE`, `LOAN TO VALUE RATIO*`, `DATE OF APPRAISAL` are present, but the values that should follow them are empty. The output XML contains zero surviving `{{...}}` tags for these names — meaning the engine resolved every `{{pr_p_address_N}}`, `{{pr_p_ownerName_N}}`, `{{ln_p_remainingEncumbrance_N}}`, `{{pr_p_appraiseValue_N}}`, etc., but to empty strings for indices 1–5.

The deal does have property data (`property1::*` … `property{N}::*` composite keys exist in `deal_section_values`), so the publishers should have something to emit. The probable causes (in order of likelihood) are:

- a. The literal `_N` token is not being rewritten to `_1`/`_2`/… for these specific text runs in Part 2 (the rewrite logic in `generate-document/index.ts` may be matching block boundaries by paragraph anchors that no longer exist in this template revision).
- b. The publishers emit the aliases under different field-key spellings than the template uses (e.g. `pr_p_ownerName_N` vs `pr_p_owner_N`, `pr_p_appraiseValue_N` vs `pr_p_appraisedValue_N`), so the rewrite produces a key that has no value.
- c. The anti-fallback shield (line ~1611 of `generate-document/index.ts`) blanks `_N` tags for every index when the publisher list does not include the exact key, masking missing publishes as empty strings.

The mystery numeric strings (`214314 179925`, `289878 120824`, …) seen in raw text-stripping are `<wp:posOffset>` drawing coordinates for horizontal divider lines — they are NOT visible in Word and are not a defect.

**Note about the prior commit:** earlier work in this repo already added an extensive RE851D per-index publisher (`pr_p_address_N`, `pr_p_ownerName_N`, `ln_p_remainingEncumbrance_N`, etc.) and an anti-fallback shield. The new symptoms suggest a regression in either the publish keys or the `_N` rewrite anchor — not a missing feature. Memory entries for `re851d-multi-property-mapping`, `re851d-encumbrance-mapping`, and `re851d-lien-questionnaire-glyph-resolution` are directly relevant.

## Fix plan

### Step 1 — Capture ground truth (one diagnostic generation)
Add a temporary `console.log` block inside `supabase/functions/generate-document/index.ts` in the RE851D publisher (around the existing `[generate-document] RE851D multi-property: published indexed aliases…` log) that dumps, for this template only:
- the list of `property{N}` indices found in `deal_section_values`,
- the resolved values for `pr_p_address_N`, `pr_p_ownerName_N`, `pr_p_appraiseValue_N`, `pr_p_appraiseDate_N`, `ln_p_remainingEncumbrance_N`, `ln_p_expectedEncumbrance_N`, `ln_p_totalEncumbrance_N`, `ln_p_totalWithLoan_N`, `ln_p_loanToValueRatio_N` for N=1..5 immediately before the `_N` rewrite pass,
- any `_N` tag that the rewrite pass leaves unmatched.

Run one document generation against the user's deal (`db7517e9-…`) and read `supabase--edge_function_logs` to confirm whether (a) values are missing at publish time or (b) the rewrite/shield is dropping them.

### Step 2 — Patch the template-side malformed tag
Fix the 4 occurrences of `{{property_type_land_income_N}` → `{{property_type_land_income_N}}` in `Re851d_v1_1_2_13.docx` and re-upload. Templates are stored in the `templates` storage bucket; the agent will edit and re-upload the corrected file (no schema change). This eliminates the literal text in Part 2 blocks 2–5.

### Step 3 — Fix the publisher / rewrite based on Step 1 evidence
Depending on what Step 1 shows, exactly one of:
- **3a.** Add the missing per-index aliases to the publisher block (≈ line 1154–1609 of `generate-document/index.ts`) so every Part 2 field key in the template has a populated `_N` entry.
- **3b.** Adjust the `_N` rewrite anchor regex (≈ line 2066) so the per-block index increment continues to work for the v1.1.2.13 template's Part 2 row layout.
- **3c.** Tighten the anti-fallback shield so it blanks only truly missing `_N` keys and does not overwrite values produced by the publisher.

Only one of these is expected to be required — Step 1 logs will identify which.

### Step 4 — Verify
Regenerate against the same deal, re-open the docx, confirm every Part 2 row 1–5 shows: address, owner, remaining/expected/total senior encumbrance, market value, LTV %, appraisal date. Then remove the temporary logs added in Step 1.

## Out of scope
- No DB schema changes, no new tables/columns.
- No UI / form / field-dictionary edits.
- No changes to RE851A, RE851B, RE885, or any other template or generator code path.
- No edits to `legacyKeyMap.ts` / `fieldKeyMap.ts` unless Step 1 specifically points there.

## Technical notes (for engineers)
- Edge function: `supabase/functions/generate-document/index.ts` (~7,300 lines). Relevant regions: per-property publisher (~1015–1730), `_N` rewrite (~2066), anti-fallback shield (~1611–1720), encumbrance per-property/per-slot mapping (~2716–2790).
- Template path in storage: `templates` bucket, file referenced by the `templates` row whose `name` matches `Re851d_v1(1)(2)(13)`.
- Verification deal: `db7517e9-f124-4031-98c8-3e0f33caf889` (already has 5 `property{N}` rows + lien data populated).

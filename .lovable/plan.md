## Goal
Make RE870 Investor Questionnaire (and any future template) render one full questionnaire section per lender on a deal, with the correct name source per Lender Type, separated by page breaks, and a single shared Broker Acknowledgement at the end.

## Current state (already implemented — do not change)
The multi-lender backend pipeline is already in place and deployed:

- `supabase/functions/generate-document/index.ts` already publishes, per lender N (sorted by `sequence_order` then `created_at`):
  - Flat: `lender_N_type`, `lender_N_vesting`, `lender_N_firstName`, `lender_N_middle`, `lender_N_last`, `lender_N_displayName`, `lender_N_isIndividual`, `lender_N_exists`, plus `lender_count`, `has_multiple_lenders`, `additional_lender_count`.
  - Dotted (repeater feed): `lendersN.type/vesting/firstName/middle/last/displayName/isIndividual/exists/index/label`.
  - `displayName` already follows the Individual vs. non-Individual rule.
- `supabase/functions/_shared/tag-parser.ts` already supports `{{#each <collection>}}…{{/each}}` via `processEachBlocks`, rewrites inner `{{firstName}}` etc. to `{{lendersN.firstName}}` per clone, processes `{{#if isIndividual}}…{{else}}…{{/if}}` inside the clone, includes the leftover-`{{lender_N_*}}` safety strip, and consolidates fragmented `{{#each}}` / `{{/each}}` tags split by Word runs.
- Field dictionary already contains `ld_p_lenderType`, `ld_p_vesting`, `ld_p_firstIfEntityUse`, `ld_p_middle`, `ld_p_last` (verified via DB).

Therefore Parts 1, 2, and 4 of the prompt require **no code changes**.

## What's actually missing
Only **Part 3**: the three RE870 `.docx` templates in storage still contain the old single-lender markup. There are three template rows pointing at re870 files in the `templates` bucket:

- `d25cc037-…` "Investor Questionnaire" — `1779364726605_re870_…__1___5_.docx` (the active one)
- `c1bbc2ff-…` "re870" — `1779124702694_…__1___2_.docx`
- `9edf8c77-…` "test" — `1779120469182_…__1_.docx`

We must rewrite their `word/document.xml` so:

1. `INVESTOR NAME: {{ld_p_firstIfEntityUse}} {{ld_p_middle}}{{ld_p_last}}` →
   `INVESTOR NAME: {{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}`
2. `NAME OF ENTITY: {{ld_p_vesting}}` →
   `NAME OF ENTITY: {{#if isIndividual}}-{{else}}{{vesting}}{{/if}}`
3. `{{ld_p_lenderType}}` → `{{type}}` (TYPE OF ORGANIZATION line only).
4. `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE …` name fields → same `{{#if isIndividual}}…{{else}}{{vesting}}{{/if}}` pattern as INVESTOR NAME.
5. Wrap the questionnaire body (from the first INVESTOR section through the INVESTOR SIGNATURE line) in a single `{{#each lenders}} … {{/each}}` block, inserting a `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` between iterations using `{{#unless @last}}` semantics — implemented in the template as an explicit page-break paragraph placed at the **end of the iteration body** plus a tiny safety pass that removes a trailing page break after the last lender (since our `processEachBlocks` already drops empty `{{#unless @last}}` constructs we can rely on a dedicated marker instead — see Technical Notes).
6. Keep `NAME OF BROKER`, `LICENSE ID NUMBER`, `BROKER'S REPRESENTATIVE` (the entire BROKER ACKNOWLEDGEMENT section) **outside** the `{{#each}}` wrapper.

## Approach: one-shot rewrite edge function (matches existing pattern)

Create a new edge function `rewrite-re870-multi-lender` following the same shape as the existing `rewrite-re851d-*` functions:

```text
supabase/functions/rewrite-re870-multi-lender/index.ts
```

The function will:

1. List the three template rows above (by id).
2. For each:
   - Download `<file_path>` from the `templates` bucket.
   - Unzip via JSZip, load `word/document.xml`.
   - Run the 6 transforms (regex over the XML string, preserving the surrounding `<w:r>`/`<w:rPr>`/`<w:t>` formatting of the tag being replaced — same pattern used in `rewrite-re851d-property-type-layout/index.ts` and `replace-broker-company-tag/index.ts`).
   - Locate the INVESTOR section start paragraph and the INVESTOR SIGNATURE end paragraph by scanning paragraph text; insert one `{{#each lenders}}` marker paragraph before the first and one `{{/each}}` marker paragraph after the second.
   - Insert a page-break paragraph as the last child inside the iteration block.
   - Re-zip and re-upload (overwriting), then update `templates.updated_at`.
3. Return a JSON report `{ templateId, before, after, ok }[]`.

The function runs **once** (invoked manually from the user via `supabase.functions.invoke('rewrite-re870-multi-lender')`). It is idempotent — it detects already-rewritten content (presence of `{{#each lenders}}` or `{{firstName}}`) and skips.

## Verification plan
After invoking the rewrite function:

1. Generate the Investor Questionnaire for deal `DL-2026-0266` with the 4 lenders (L-00017 Joint, L-00001 Entity, L-00002 Family Trust, L-00004 Individual).
2. Download the resulting `.docx` via the existing `debug-fetch-doc` function and run pandoc / unzip to confirm:
   - Exactly 4 questionnaire sections with page breaks between them.
   - Investor Name = `Horizon Capital LLC`, `BlueStone Investments Inc`, `Sarah Lynn Mitchell, a single woman`, `Michael Carter` respectively.
   - Only the 4th uses First/Middle/Last; the other 3 use Vesting.
   - NAME OF ENTITY is `-` for Michael Carter and the vesting value for the other three.
   - One BROKER ACKNOWLEDGEMENT block at the end.
3. Spot-check the 8 scenarios in Part 6 of the prompt via the same generator (single lender Individual, single non-Individual, mixed, middle-empty, zero lenders, existing un-rewritten template still works because the `lender_count` safety strip already handles unresolved `{{lender_N_*}}` tags).

## Technical notes

- The rewrite operates strictly at the XML-paragraph (`<w:p>`) level — the `{{#each lenders}}` and `{{/each}}` markers each live in their own paragraph so the tag-parser's paragraph-aware each handling picks them up cleanly.
- For the conditional name fields, we replace the **entire `<w:r>` run** carrying `{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}` with new `<w:r>` runs that inherit the original `<w:rPr>` block, so the rendered name keeps the source formatting.
- We do **not** add the `{{#unless @last}}<page-break>{{/unless}}` text described in the prompt because the existing `processEachBlocks` already injects iteration separators between clones at the XML level; we simply append a dedicated page-break paragraph inside the each body and let the existing post-process strip the trailing one. This avoids adding a new Handlebars helper and keeps tag-parser untouched.
- No changes to `supabase/config.toml` (function uses default settings).
- No new dependencies — uses JSZip which is already imported by other rewrite functions.

## Out of scope
- No changes to `field-resolver.ts`, `tag-parser.ts`, `types.ts`, `field_dictionary`, RLS, UI, or any other template.
- No schema migrations.

# Fix RE870 INVESTOR NAME cell targeting + NAME OF PERSON COMPLETING

## Problem

1. **INVESTOR NAME loop in wrong cell.** The RE870 INVESTOR table has 3 columns. The center cell visibly shows the "INVESTOR" header (and `CO-INVESTOR NAME` on the next row). The left cell holds the `INVESTOR NAME:` label. The current rewriter's `isInvestorNameCellText()` matches *any* `<w:tc>` whose visible text contains `INVESTOR` (excluding `CO-INVESTOR NAME`). Because cells are scanned in document order, the center header cell (text: `"INVESTOR"`) is matched first and gets the label + loop rebuilt into it, while the actual left `INVESTOR NAME:` cell is left untouched. Result: lender names render under the centered `INVESTOR` header.

2. **NAME OF PERSON COMPLETING shows "Lender" prefix.** That cell still uses the legacy `{{#if isIndividual}}{{firstName}}…{{else}}{{vesting}}{{/if}}` tag. For Joint-type lenders our pipeline writes `firstName = "Lender"` (the role label) and `isIndividual` resolves truthy, so the output is `Lender` + newline + entity name. The fix is to swap that conditional for the precomputed `{{ld_p_displayName}}` alias (already published by `generate-document/index.ts:1169`).

## Plan

### 1. `supabase/functions/rewrite-re870-multi-lender/index.ts`

- Bump marker to `V7_MARKER = "<!-- re870-rewrite:v7 -->"` and add it to the strip-prior-markers list. Short-circuit only on V7 (unless `force`).
- **Tighten `isInvestorNameCellText()`** so it only matches the real label cell:
  - Match when the normalized text contains `INVESTOR NAME:` (with the colon) OR `firstIfEntityUse` / `ld_p_middle` / `ld_p_last` tag fragments.
  - Explicitly reject cells whose normalized text is exactly `INVESTOR` or starts with `INVESTOR\b` without `NAME:` (the header cell).
  - Continue to reject `CO-INVESTOR NAME`.
- Keep the existing two-paragraph rebuild (label + `{{#each lenders}}{{displayName}}{{/each}}`) but also handle the case where the matched cell originally had no tag paragraph (pure-label cell): wrap the existing `INVESTOR NAME:` paragraph as paragraph 1 and append paragraph 2 with the loop.
- **Add a Pass D — clean up the center header cell.** If a `<w:tc>` whose normalized visible text is just `INVESTOR` (no `NAME:`) contains a `{{#each lenders}}` … `{{/each}}` block left over from a prior v6 misplacement, remove only those tag paragraphs (and the appended displayName paragraph), restoring the centered `INVESTOR` header.
- **Add a Pass E — rewrite the NAME OF PERSON COMPLETING cell.** Locate the `<w:tc>` whose visible text contains `NAME OF PERSON COMPLETING`. Inside that cell, rebuild the paragraph(s) that follow the label so the value run becomes `{{ld_p_displayName}}` and strip all of:
  - `{{#if isIndividual}} … {{/if}}` / `{{else}}`
  - `{{firstName}}`, `{{middle}}`, `{{#if middle}}…{{/if}}`, `{{last}}`, `{{vesting}}`
  - the legacy `{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}` triple (if reverted by Pass A).
  
  Final structure for that cell: label paragraph `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE` + value paragraph `{{ld_p_displayName}}`. Preserve `<w:pPr>` / first-run `<w:rPr>` for styling.

### 2. Regression test

Add `supabase/functions/_shared/tag-parser.re870-investor-name.test.ts` cases (or a new sibling file) that:
- Feed a 3-cell row fixture (`[INVESTOR NAME:]`, `[INVESTOR]`, `[ ]`) plus the lenders cell paragraph, and assert the rewriter only modifies the left cell, leaves the center header cell as plain `INVESTOR`, and emits the expected two-paragraph layout.
- Feed a `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE` cell with the legacy conditional and assert the rewriter replaces the value run with `{{ld_p_displayName}}` and removes every `firstName` / `middle` / `last` / `vesting` / `isIndividual` token.

### 3. Deploy + re-run

- Deploy `rewrite-re870-multi-lender`.
- Invoke once with `{ "force": true }` against all 3 RE870 template IDs to migrate existing v6 templates.
- Validate by regenerating the document for deal `DL-2026-0266` and confirming:
  - Lender names appear under `INVESTOR NAME:` (left column).
  - Center cell shows plain `INVESTOR` header.
  - `NAME OF PERSON COMPLETING THIS QUESTIONNAIRE` shows only `Horizon Capital LLC` (no `Lender` prefix).
  - Document passes integrity check.

### Files touched

- `supabase/functions/rewrite-re870-multi-lender/index.ts` — edit
- `supabase/functions/_shared/tag-parser.re870-investor-name.test.ts` — extend (or new test file)

No DB schema, UI, or `generate-document` changes — `ld_p_displayName` is already published.

## Goal

RE870 should render as ONE form (not 4 copies). The INVESTOR NAME cell alone should list every lender stacked on separate lines, using strict `isIndividual` logic (individual → "First M Last"; everything else → vesting only).

## Root cause

The previous fix wrapped the **entire RE870 body** (header → just before BROKER ACKNOWLEDGEMENT) in `{{#each lenders}}…{{/each}}` inside `rewrite-re870-multi-lender/index.ts`. That repeats the whole form per lender and surfaces wrong values (including "Lender" labels) from non-primary iterations.

The data-side `isIndividual` rule in `generate-document/index.ts` is already correct (`type.toLowerCase() === "individual"`), so the fix is in the template rewriter only — no change to lender data resolution.

## Changes

### 1. `supabase/functions/rewrite-re870-multi-lender/index.ts` — rewrite the rewriter

Replace the current "wrap whole form" logic with a targeted, idempotent transform that:

**a. Undo previous full-form wrapper (migration step)**
- Detect the previously injected `EACH_OPEN_PARA` paragraph (the standalone `<w:p>` containing only `{{#each lenders}}`) and the matching close block (`{{#unless @last}} … page break … {{/unless}} {{/each}}`) and **remove both paragraphs** so the form renders once again.

**b. Rewrite the INVESTOR NAME cell only**
Locate the `<w:tc>` (table cell) whose visible text starts with `INVESTOR NAME` and rewrite its inner paragraph(s) so:

```
INVESTOR NAME:
{{#each lenders}}
{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}
{{/each}}
```

Implementation: keep the existing "INVESTOR NAME:" label paragraph, then append one paragraph per loop marker. Each rendered lender becomes its own `<w:p>` so they stack visually:

```
{{#each lenders}}<w:p>{{#if isIndividual}}{{firstName}} {{middle}} {{last}}{{else}}{{vesting}}{{/if}}</w:p>{{/each}}
```

(The opening `{{#each lenders}}` and closing `{{/each}}` markers are placed in their own bare `<w:p>` tags adjacent to the per-iteration paragraph, matching the pattern already understood by `processEachBlocks` in `_shared/tag-parser.ts`.)

**c. Leave every other tag alone**
- Keep existing `ld_p_firstIfEntityUse / ld_p_middle / ld_p_last → {{#if isIndividual}}…{{else}}{{vesting}}{{/if}}` substitution for the secondary "NAME OF PERSON COMPLETING THIS QUESTIONNAIRE" occurrence (resolves against primary lender).
- Keep `NAME OF ENTITY: {{ld_p_vesting}} → NAME OF ENTITY: {{#if isIndividual}}-{{else}}{{vesting}}{{/if}}` (primary lender).
- Keep `{{ld_p_lenderType}}` substitutions and any other primary-lender tags untouched.
- All other fields render exactly once from primary-lender data.

**d. Idempotency**
- Bump the in-template marker comment (e.g. inject an XML comment `<!-- re870-rewrite:v2 -->` near `<w:body>`) and skip when present.
- Accept `{ force: true }` in the request body to bypass the skip check (needed to migrate already-wrapped templates).

### 2. `supabase/functions/generate-document/index.ts` — no logic change

The existing `isIndividual = type.toLowerCase() === "individual"` (lines 1098 and 5340) already matches the spec (Individual → true; Joint / Family Trust / LLC / C Corp / S Corp / IRA / ERISA / Investment Fund / 401k / Foreign Holder → false). No edit needed.

The auto-appended "ADDITIONAL LENDER N" signature blocks (line 7549+) remain untouched — they sit after BROKER ACKNOWLEDGEMENT and are unrelated to the INVESTOR NAME cell.

### 3. Re-run the rewriter

Invoke `rewrite-re870-multi-lender` with `{ force: true }` against the 3 known template IDs so the live `.docx` templates in storage are updated.

## Verification

1. Regenerate a document for deal `DL-2026-0266` (4 lenders).
2. Confirm the output:
   - Exactly **one** RE870 form (no 4× repetition, no page breaks between iterations).
   - INVESTOR NAME cell contains four stacked lines:
     ```
     Horizon Capital LLC
     BlueStone Investments Inc
     Sarah Lynn Mitchell, a single woman
     Michael Andrew Carter
     ```
   - No stray "Lender" text in INVESTOR NAME.
   - All other RE870 fields populated from the primary lender exactly as before.

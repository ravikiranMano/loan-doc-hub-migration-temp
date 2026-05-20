## Problem

RE851D is rendering literal text in the appraiser cells:

- `#if (eq pr_p_performeBy_1 "Broker")N/A` (Property 1, ADDRESS OF APPRAISER)
- `#if (eq pr_p_performeBy_2 "Broker")N/A` (Property 2, ADDRESS OF APPRAISER)

Property 1 NAME shows nothing; Property 2 NAME shows `BPO Performed by Broker`. So the renumbering of `_N → _K` is already working (we see `_1` and `_2`), but the surrounding `{{` / `}}` braces of the Handlebars `{{#if (eq pr_p_performeBy_K "Broker")}}…{{/if}}` block are missing in the underlying `<w:t>` runs of the template. With no braces, the merge engine ignores the conditional and the raw `#if …` syntax leaks to the rendered DOCX.

## Root cause

`supabase/functions/generate-document/index.ts` L6247 holds the appraiser-conditional rewriter:

```ts
const apprCondRe = /\{\{\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(?:N|[1-5])\s*"\s*Broker\s*"\s*\)\s*\}\}([\s\S]*?)(?:\{\{\s*\/\s*if\s*\}\}|\{\{\s*\/\s*if\s*\}(?!\}))/g;
```

It hard-requires `{{ … }}` on both opener and closer. The RE851D V12.1 template authoring (and our earlier brace-repair passes) leave some opener/closer pairs with **zero** brace characters left in the live `<w:t>` body — the `{{` and `}}` lived in adjacent runs that were stripped, and `normalizeWordXml` merged what's left into a single brace-less run. The regex never matches, so the cell never gets rewritten into `{{pr_p_appraiserName_K}}` / `{{pr_p_appraiserAddress_K}}`, and the literal `#if (eq pr_p_performeBy_K "Broker")…/if` (or just the payload `N/A` with the `#if` opener as a separate fragment) survives to the rendered document.

The renumber-`_N`-to-`_K` safety pass at L6305 already runs successfully (logs show `_1` / `_2` in the leaked text), confirming the regions detector is correct — only the brace-tolerant payload collapse is missing.

The publishers at L1655–L1664 already set the per-property resolved values:

- `pr_p_appraiserName_K` = `"BPO Performed by Broker"` when broker, else `""`
- `pr_p_appraiserAddress_K` = `"N/A"` when broker, else `""`

so once we collapse the leaked `#if` block into the right merge tag, the existing pipeline renders the correct text.

## Fix (minimal, RE851D-only, additive)

### `supabase/functions/generate-document/index.ts`

Add **one** brace-tolerant fallback pass immediately after the existing appraiser conditional rewrite (after L6287, before the L6289 `_N → _K` literal renumber). Scope: only the literal identifier `pr_p_perform(e|ed)By_(K|N)` followed by either of the two known payloads (`BPO Performed by Broker` or `N/A`) and a trailing `/if` token, with `{` / `}` characters **optional** at every position.

Conceptually:

```ts
// Brace-tolerant fallback. Strictly anchored to the two known payloads so
// no unrelated text can ever be consumed.
const apprCondLooseRe =
  /\{*\s*#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_(N|[1-5])\s*(?:"|&quot;|\u201C|\u201D)\s*Broker\s*(?:"|&quot;|\u201C|\u201D)\s*\)\s*\}*\s*(BPO Performed by Broker|N\/A)\s*(?:\{\{\s*else\s*\}\}\s*)?\{*\s*\/\s*if\s*\}*/g;
```

For each match (skipped if `isConsumed(...)` is true):

1. Strip-tag the payload group to determine `kind` (`name` for `BPO Performed by Broker`, `addr` for `N/A`).
2. Resolve `pIdx`:
   - If the captured slot is `1`..`5`, use it directly.
   - If `N`, locate the enclosing `regions.props` range (same logic as L6262–L6267); fall back to the existing `appraiserPairCounter` ordering.
3. Push a rewrite that replaces the **entire** matched run with `{{pr_p_appraiserName_K}}` or `{{pr_p_appraiserAddress_K}}`, mark `consumed.push([start,end])`, increment `totalRewrites`.

This collapses every leaked `#if (eq pr_p_performeBy_K "Broker") N/A /if`–style fragment (with or without any braces) into the canonical merge tag, which the already-published `pr_p_appraiserName_K` / `pr_p_appraiserAddress_K` values render correctly. The strict payload anchors (`BPO Performed by Broker` / `N/A`) guarantee no other document text can be matched.

### Post-render scanner tightening (optional, additive)

In the unresolved-placeholder log scanner that runs before upload/PDF (same area as the existing vesting scan), also count residual occurrences of:

```ts
/(?:#\s*if\s*\(\s*eq\s+pr_p_perform(?:e|ed)By_[1-5N]|pr_p_perform(?:e|ed)By_[1-5N])/g
```

so any future regression surfaces in the edge-function logs instead of silently uploading bad text. Log only — do not fail the run.

### What is NOT changing

- No edit to the stored RE851D template in storage.
- No edit to field dictionary, field map, RLS, publishers (L1630–L1664 / L1655–L1664), data resolver, or UI.
- No change to RE851A, RE885, or any non-appraiser RE851D logic.
- The existing strict `apprCondRe` (L6247) stays; the new pass only fires for matches the strict pass already missed (`isConsumed` guard).

## Technical details

- File touched: `supabase/functions/generate-document/index.ts` only.
- Insertion point: a new block between L6287 and L6289.
- Net addition: ~30 lines.
- The new regex never matches well-formed `{{#if … }}…{{/if}}` blocks already handled by the strict pass because those are added to `consumed` first.
- DOCX integrity preserved: rewrites operate on the same `xml` string the strict pass already mutates via `rewrites[]` / `applyRanges(...)`, so XML balance and `<w:t>` containment are unchanged.

## Validation

1. Regenerate RE851D for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65`.
2. In the output DOCX, every PROPERTY #1..#5 block shows:
   - NAME OF APPRAISER → `BPO Performed by Broker` when `appraisal_performed_by === "Broker"`, else the appraiser name (or blank).
   - ADDRESS OF APPRAISER → `N/A` when broker, else the appraiser address (or blank).
   - No literal `#if`, `pr_p_performeBy_*`, or `/if` text anywhere in the document.
3. Open the file in Microsoft Word AND in Google Drive → document opens cleanly with no "unreadable content" repair prompt.
4. Edge-function logs print `RE851D appraiser conditional rewrite: N block(s) replaced` for both the strict and loose passes, and the new scanner reports `0` residual `pr_p_performeBy_*` leaks.

## Out of scope

- Field dictionary, packets, templates table, storage uploads.
- RE851A / RE885 / non-RE851D paths.
- UI / styling / validation.

# Fix: Multi-Lender Append — Clone Primary Lender's Formatting

## Root cause

In `supabase/functions/generate-document/index.ts` (~lines 7822–7894), the per-lender append routine deliberately uses a **"STANDARDIZED FORMAT"** that hardcodes XML:

- `STD_FONT = "Arial"` and `STD_SIZE = "22"` (11pt)
- `rPrStd()` emits `<w:rFonts w:ascii="Arial" .../>` + `<w:sz w:val="22"/>`
- `pPrPlain()` emits `<w:spacing w:before="0" w:after=".../>` + `<w:ind w:left="0" w:firstLine="0"/>` + `<w:jc w:val="left"/>`
- `paraSigRow()` wraps Signature/Date in a `<w:tbl>` with three `<w:gridCol>`s and a `lineBorder` underline

This is then used by both the **normalize** pass (rewrites existing `Lender N:` blocks in place) and the **append** pass (inserts missing `Lender N:` blocks before `</w:body>`). The primary Lender block from the template uses Times New Roman, `<w:pStyle w:val="NoSpacing"/>`, and plain `<w:p>` paragraphs with literal underscore lines — so the appended/normalized blocks visually diverge from Lender 1.

## Approach

Replace the standardized emitters with a **template-cloning** strategy. On the first call per template, scan `docXml` for the primary `Lender:` paragraph block (the one **without** a trailing number — Lender 1), capture the contiguous paragraph fragments verbatim, and reuse them to emit Lender 2..N by substituting only the user-visible text of the label run and the display-name run.

The existing block-scan (`blockRe` over `<w:p>…</w:p>` / `<w:tbl>…</w:tbl>`) and the normalize-vs-append control flow (`normalizedExisting`, `replacements`, append-before-`</w:body>`) stay unchanged. Only the XML emitted per lender changes.

## Changes

**File:** `supabase/functions/generate-document/index.ts` — only the `LENDER_SPECIFIC` branch (~lines 7803–7990).

### 1. Locate the primary Lender template block

Right after `docBlocks` is built (~line 7908), add a helper:

- Walk `docBlocks` and find the first block whose visible text matches `/\bLender\s*:/i` **and does not** match `/Lender\s+\d+\s*:/i` (i.e. the unnumbered primary label).
- From that index, capture up to the next 4 blocks until and including the first block whose visible text contains `\bDate\b` (or hit the next numbered `Lender N:` first, whichever comes first).
- Store the captured fragments as `{ labelBlockXml, nameBlockXml, sigBlockXml, dateBlockXml? }`. If signature and date live in a single `<w:tbl>` or single `<w:p>`, store that one combined fragment as `sigDateBlockXml`.
- Also extract from the label block: the exact label text run (so trailing whitespace and `xml:space="preserve"` are preserved when swapping `Lender:` → `Lender N:`).
- Extract from the name block: a list of `<w:t>…</w:t>` text-content ranges so we can replace only the visible text, preserving wrapping `<w:r>`/`<w:rPr>` and intra-run `<w:br/>` markers.

If no primary block is found (e.g. template anchors lender on a different label, or the block is missing), **fall back to the existing standardized emitter** — preserves single-lender / non-conforming templates byte-identically.

### 2. Build cloned blocks per lender

Add `lenderBlockFromTemplate(labelN, displayName)`:

- Deep-clone the captured fragments as raw XML strings (they're already valid `<w:p>`/`<w:tbl>` XML).
- In the label fragment: replace only the inner text of the matched label `<w:t>` (regex anchored on the captured text) with `Lender ${labelN}:` plus the original trailing whitespace; do **not** touch its `<w:rPr>` / `<w:pPr>`.
- In the name fragment: walk the captured `<w:t>` ranges and either (a) concatenate the existing texts to detect the primary's display name and replace it whole, or (b) replace the first non-empty `<w:t>` with `displayName` and zero out subsequent non-empty `<w:t>`s. `<w:br/>` runs in between are kept as-is so the line-break pattern around the name is preserved.
- The signature/date fragment(s) are appended **verbatim** (underscore lines and all).

XML escape only the substituted text (`displayName`, label string) — reuse the existing `xmlEsc`.

### 3. Use the cloner in both passes

- **Normalize pass** (~line 7929): `replacement: lenderBlockFromTemplate(labelN, displayName)` instead of `lenderBlock(labelN, displayName)`.
- **Append pass** (~line 7958): same swap.
- Keep the standardized `lenderBlock` available only as the fallback when the primary block could not be located.

### 4. No other changes

- `COMMON_TEMPLATE` skip path (~7798) untouched.
- `renderedIndexes` / numbered-label regex untouched.
- Append insertion point (before `<w:sectPr>` / `</w:body>`) untouched.
- Lender ordering, merge-key families, tag-parser orphan pass, `ld_p_*` bare keys — all untouched.

## Verification

1. Inspect the `LENDER_SPECIFIC` branch console logs to confirm `[lender-sig] template=… primaryBlock.captured=true` (new debug line).
2. Generate `Waiver_of_Appraisal` with 1, 2, and 4 lenders. Unzip and diff `word/document.xml`:
   - 1-lender output is byte-identical to pre-change.
   - 2/4-lender outputs contain **no** `<w:rFonts w:ascii="Arial"`, **no** `w:sz w:val="22"`, **no** `<w:tbl>` wrapping Signature/Date in the appended blocks.
   - Each Lender N's `<w:rPr>` matches Lender 1's `<w:rPr>` character-for-character.
3. Single-lender templates: confirm append path is skipped (`lenderCount === 1`) — unchanged.
4. Fallback path: temporarily run against a template lacking a `Lender:` anchor and confirm the legacy standardized emitter still fires (regression safety).

## Out of scope

- Field-resolver / merge-key publication
- `tag-parser.ts` orphan stripping
- Bare `ld_p_*` aggregation behavior
- Lender ordering / primary determination

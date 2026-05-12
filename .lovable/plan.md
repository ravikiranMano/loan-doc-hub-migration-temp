# Fix: RE851D generated .docx fails to open ("Ambiguous cell mapping… <p> required before </tc>")

## Root cause

In `supabase/functions/_shared/tag-parser.ts` (lines 2719–2738), the post-replacement pass removes any paragraph whose merge tags resolved to empty:

```ts
if (/<w:t[^>]*>\s*<\/w:t>/.test(para) && /<w:r\b/.test(para)) {
  emptyParaCount++;
  return '';   // paragraph deleted outright
}
```

When that paragraph is the **only** `<w:p>` inside a `<w:tc>` (very common in the RE851D appraisal/lien tables, where a cell holds a single `{{ pr_… }}` merge tag), the cell collapses to:

```xml
<w:tc><w:tcPr>…</w:tcPr></w:tc>
```

OOXML requires at least one `<w:p>` before `</w:tc>`. Word refuses to open the file with the exact error in the screenshot. Inspection of the uploaded `RE851D_v44_2.docx` confirms 18 of 22 sampled cells are now paragraph-less.

## Fix (single edit in `supabase/functions/_shared/tag-parser.ts`)

After the empty-paragraph removal loop (right after line 2738), add a recovery sweep that re-inserts a minimal empty paragraph into any `<w:tc>` left without one:

```ts
// Recovery: every <w:tc> must contain at least one <w:p> (OOXML requirement).
// The empty-paragraph cleanup above can strip the sole <w:p> from a cell whose
// only content was a merge tag that resolved to "". Re-insert <w:p/> so Word
// can open the document.
{
  let cellsRepaired = 0;
  result = result.replace(/<w:tc(\s[^>]*)?>([\s\S]*?)<\/w:tc>/g, (full, _attrs, inner) => {
    if (/<w:p[\s>\/]/.test(inner)) return full;
    cellsRepaired++;
    return full.replace(/<\/w:tc>$/, '<w:p/></w:tc>');
  });
  if (cellsRepaired > 0) {
    debugLog(`[tag-parser] Repaired ${cellsRepaired} table cells missing required <w:p>`);
  }
}
```

Notes:
- Regex is anchored on `<w:tc>` … `</w:tc>` and is non-greedy, so it never crosses cell boundaries (Word does not allow nested `<w:tc>`).
- Detection uses `<w:p[\s>/]` so both `<w:p>` and self-closing `<w:p/>` count as present.
- `<w:p/>` is the schema-minimal fallback Word itself emits for empty cells.

## Out of scope

- No template, schema, UI, or merge-mapping changes.
- The `priority`-bridge and `n_p_numberOfPaymen` bridges from prior turns are untouched.

## Validation

1. Re-run document generation for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` with template RE851D.
2. Open the generated `.docx` in Microsoft Word — the "Ambiguous cell mapping" dialog should no longer appear.
3. Spot-check the appraisal/lien tables: cells whose merge tag resolved to empty render as blank cells (not as missing cells), and cells with data still render correctly.
4. Edge-function log should show a `[tag-parser] Repaired N table cells missing required <w:p>` line on documents that previously broke.

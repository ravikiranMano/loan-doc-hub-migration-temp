## Problem

The generated Investor Questionnaire (`Investor Questionnaire_v20.docx`) opens with:
> "We found a problem with its contents. Part: /word/document.xml, Line: 0, Column: 0 — Unspecified error"

LibreOffice opens the same file fine, so the XML parses — but Word enforces stricter OOXML schema rules.

## Root cause

When the multi-lender `{{#each lenders}}` block in `tag-parser.ts` clones the investor section once per lender, every drawing inside that section (checkbox glyph images, SDT graphics, etc.) is duplicated verbatim. Each drawing carries a `<wp:docPr id="N" ...>` attribute, and Word requires `wp:docPr/@id` to be **unique across the entire document**.

Inspection of the generated v20 file with 4 lenders shows:

```
docPr count: 189   unique: 30
top dupes: ('17',8) ('3',8) ('22',8) ('12',8) ('5',8) ('10',8) ('1',8) ('23',8) …
```

Each id appears up to 8 times. That is the exact condition that triggers Word's "Unspecified error" at document.xml line 0.

Note: `pic:cNvPr/@id` and `<w:sectPr>` repetition are tolerated by Word; only the `wp:docPr/@id` collisions are fatal.

## Fix

In `supabase/functions/generate-document/`, immediately **after** the `{{#each lenders}}` expansion (i.e. after `processEachBlocks` / the multi-lender loop emits its final XML, before the file is re-zipped), run a single post-pass over `word/document.xml` that re-numbers every `<wp:docPr ... id="…">` so each id is unique:

1. Scan the rendered document.xml with a regex (`/<wp:docPr\b[^>]*\bid="(\d+)"/g`).
2. Walk matches in order. Maintain a running counter `next = max(seenIds) + 1`. On the first occurrence of any id, keep it. On every subsequent occurrence of the same id, replace it with `next++`.
3. Write the patched XML back into the zip.

This is the minimum, well-scoped fix:
- Only touches `wp:docPr/@id` values (the ones Word actually rejects).
- Does not change `pic:cNvPr/@id`, `<wp:inline>`, `<w:drawing>` structure, `<w:rPr>`, fonts, spacing, sectPr, headers/footers, relationships, or any text.
- Backward compatible: documents with no duplicates are unchanged (every id is seen exactly once → no rewrites).
- Required dependency is just regex/string ops already in use.

## Where it goes

The pass lives in `generate-document/index.ts`, applied to the final `word/document.xml` string returned by the renderer **just before** `fflate.zipSync(...)`. No changes to `tag-parser.ts`, `field-resolver.ts`, the field dictionary, RLS, templates, or UI.

## Verification

1. Re-generate the Investor Questionnaire for deal `DL-2026-0266` (4 lenders).
2. Re-download and run:
   ```
   python3 -c "import re,collections; x=open('document.xml').read(); ids=re.findall(r'<wp:docPr\\s+id=\"([^\"]+)\"',x); print(len(ids),'==',len(set(ids)))"
   ```
   Expect both numbers equal (no duplicates).
3. Open in Microsoft Word → file opens cleanly, all 4 lender sections render, BROKER ACKNOWLEDGEMENT renders once.
4. Re-verify the 8 Part-6 scenarios from the multi-lender spec still behave correctly.

## Out of scope (explicitly NOT changing)

- `tag-parser.ts`, `field-resolver.ts`, types, field dictionary, RLS, templates, UI.
- The rewrite-re870-multi-lender function (templates are correct; the bug is purely in post-render id collisions).
- Section properties, page breaks, formatting, fonts, `<w:rPr>`.
- Resolution pipeline order.

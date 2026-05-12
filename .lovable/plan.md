## Problem

Generating from the uploaded `RE851D-V12.1.docx` fails with **"Generation timed out (CPU limit exceeded)"**.

Edge function logs show two full passes over `word/document.xml` (~4.4 MB) totalling ~575 ms of regex work, plus checkbox/label safety passes. Combined with the rest of `generate-document`, the worker exceeds the Edge Function 2 s CPU budget even though it already runs in the background via `EdgeRuntime.waitUntil`.

Root cause is the **template itself**: the unpacked `document.xml` is 4,466,187 bytes — ~5× the size of comparable templates (RE851A is ~850 KB). It contains:

- 5,173 `w:rsid*` attributes (Word revision-save IDs)
- 706 `<w:proofErr>` tags
- 44 unaccepted tracked-change `<w:ins>` runs
- 2,317 paragraphs, 9,106 text nodes — much of it dead authoring noise

Every regex phase in `tag-parser.ts` (`normalizeWordXml`, `conditionalBlocks`, `postReplaceCleanup`, label-anchored safety passes) scales linearly with this size, so the document gets walked many times and blows the CPU limit.

## Goal

Make this exact template (and any future template of similar size) generate within the Edge Function CPU budget — without changing UI, database schema, document output, or any other template's behaviour.

## Plan

Two complementary changes, scoped to the document-generation backend only.

### 1. Strip authoring noise from large templates at upload time

Edit `supabase/functions/upload-template/index.ts` to run a **lossless cleanup pass** on `word/document.xml` (and `header*.xml` / `footer*.xml`) before re-zipping and storing the file.

The cleanup removes only attributes/elements that have no effect on rendering or merge logic:

- All `w:rsid`, `w:rsidR`, `w:rsidRPr`, `w:rsidTr`, `w:rsidDel`, `w:rsidP`, `w:rsidRDefault` attributes
- `<w:proofErr .../>` self-closing tags
- `<w:bookmarkStart>` / `<w:bookmarkEnd>` for `_GoBack`-style proof bookmarks (already handled mid-pipeline; doing it once at upload makes every later run cheaper)
- Empty `<w:lastRenderedPageBreak/>` markers

No structural rewriting, no merging of runs, no touching of `{{...}}`, SDT checkboxes, tables, sections, or styles. Output remains a valid OOXML file Word can re-open. Expected size reduction for this template: ~40–60%.

This is a **one-time cost at upload**, not on every generation, so it does not need to be fast.

### 2. Add a large-template guard in the tag-parser pipeline

Edit `supabase/functions/_shared/tag-parser.ts`:

- When `xmlContent.length` exceeds a threshold (e.g. 2 MB), short-circuit the heaviest *optional* phases inside `normalizeWordXml` that already have fast-path branches (`fragmentedSuite`, `paraConsolidation`, `flattenMergeFieldStructures`) when a cheap pre-scan shows the document has no fragmented `{{` / `}}` markers. The existing fast-path infra at lines 310–373 already supports this; the change is to extend the size-based bail-out to RE851D-class templates, not just RE885.
- Skip the global cross-paragraph `\{\{([\s\S]{0,400}?)\}\}` consolidation when the document contains zero `#if` / `#unless` / `#each` / `else` / `/if` / `/unless` substrings (already gated, but verify the early-exit happens before any large allocation).

These guards are defensive — they should be no-ops for templates that already process under budget.

### 3. Verify

- Re-upload `RE851D-V12.1.docx`; confirm stored `document.xml` is materially smaller and Word still opens the template cleanly.
- Trigger a generation for the current deal; confirm it completes without `CPU Time exceeded`.
- Regenerate at least one other template (e.g. RE851A) to confirm no regression in output or timing.
- Inspect logs for `[tag-parser] phases` totals — RE851D should now be well under 200 ms per pass.

## Out of scope

- No DB schema, RLS, UI, or `field_dictionary` changes.
- No changes to document content, merge tags, RE851D mappings, or any other template.
- No instance/CPU-tier upgrade — this is a code-side fix.

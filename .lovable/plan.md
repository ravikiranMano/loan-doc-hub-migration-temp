# Plan — Conditional Default Interest in "ADDENDUM TO NOTE – EVENT OF DEFAULT"

## Good news: the engine already supports this

Both pieces of the runtime are already in place:

1. **Publisher** (`supabase/functions/generate-document/index.ts`, lines 1915–1918) already emits:
   - `ln_p_defaultInterestModifier`, `ln_p_defaultInterestModifierEnabled`
   - `ln_p_defaultInterestFlatRate`, `ln_p_defaultInterestFlatRateEnabled`

2. **Template rewriter** (`supabase/functions/rewrite-addendum-default-template/index.ts`) is purpose-built to:
   - Locate the "Remedies Upon Event of Default" paragraph
   - Strip the `Option 1:` / `Option 2:` red labels, the helper "(this is conditional…)" line, and yellow-highlighted X placeholders (by rebuilding the paragraph with only the first run's `rPr`, dropping all red/yellow runs)
   - Insert the exact Handlebars block:
     ```
     {{#if ln_p_defaultInterestModifierEnabled}}to a rate equal to {{ln_p_defaultInterestModifier}} percent ({{ln_p_defaultInterestModifier}}%) above the Note rate at that time.{{else if ln_p_defaultInterestFlatRateEnabled}}to a flat rate of {{ln_p_defaultInterestFlatRate}}%{{/if}} (the "Default Rate").
     ```
   - Preserve the legal prefix and suffix of the paragraph verbatim
   - Save back as a new `_vN.docx` and update the `templates` row's `file_path`

I verified the uploaded `ADDENDUM_TO_NOTE_EVENT_OF_DEFAULT_v1_1.docx` contains the original `Option 1: … Option 2: … (this is conditional…)` text in a single paragraph — exactly the shape the rewriter targets.

## What to do

Minimal, surgical steps — no new code, no schema changes:

1. **Upload the new template file** to the `templates` storage bucket and update the `templates` row named `ADDENDUM TO NOTE EVENT OF DEFAULT` so its `file_path` points at the freshly uploaded `v1_1.docx`. This replaces the current active file with the user's new baseline.

2. **Deploy** the existing `rewrite-addendum-default-template` edge function (no code changes required) and **invoke it once**. It will:
   - Download the v1.1 file
   - Rewrite the Remedies paragraph (strip labels/highlights, inject the conditional)
   - Upload as `…_v2.docx` and point the template row at it

3. **Verify** by calling the same function with `?verify=1` — the returned JSON should report:
   - `has_if: true`
   - `has_elseif: true`
   - `has_default_rate_outside: true`
   - `still_has_option1: false`, `still_has_option2: false`, `still_has_helper: false`

4. **End-to-end QA** — generate the document for a deal with:
   - Modifier enabled, value `0.00` → renders "…to a rate equal to 0.00 percent (0.00%) above the Note rate at that time (the \"Default Rate\")."
   - Flat Rate enabled, value `18.00` → renders "…to a flat rate of 18.00% (the \"Default Rate\")."

## What will NOT change

- No edits to `generate-document` (publisher already emits the required keys)
- No edits to the rewriter source (already correct)
- No schema, UI, or other template changes
- `{{br_p_fullName}}`, `{{ln_p_loanNumber}}`, paragraph spacing, indentation, and all other runs/fields remain untouched (the rewriter only touches the Remedies paragraph)

## Risk / fallback

If the rewriter's first-run-`rPr` rebuild leaves any unwanted residual formatting on the conditional segment (e.g. it should be Times New Roman 11pt normal), I'll add a tiny override to force the inserted run's `rPr` to `{ rFonts Times New Roman, sz 22, no bold, no color, no highlight }` and re-run. This is a one-line tweak inside `rebuildParagraphWithText` and would be scoped only to the inserted conditional segment.

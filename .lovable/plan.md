# Fix split/bold `{{br_p_vesting}}` tag in DOCX templates

## Problem

In `Assignment_of_Rents_and_Profits_Agreement_With_Field_Codes.docx`, the Handlebars tag `{{br_p_vesting}}` is split across three Word runs:

1. Bold run: `" {{"`
2. Plain run: `"br_p_vesting}}"`
3. Bold run: `" "` (trailing space)

This causes two bugs:
- **Duplication**: The split `{{` / `br_p_vesting}}` is matched by both the merge-tag parser and the curly-brace fallback parser, so the value is injected twice → "This is the This is the Borrower Vesting Area".
- **Bold rendering**: The surrounding bold runs bleed visual formatting around the value.

## Fix strategy

Collapse the three runs into a single plain (non-bold) run that contains `" {{br_p_vesting}} "`, matching the surrounding paragraph's normal formatting. This guarantees the tag parser sees one clean tag and the value renders in plain text with exactly one space on each side.

## Steps

1. **Create edge function** `supabase/functions/fix-vesting-tag-formatting/index.ts`
   - List every `.docx` in the `templates` storage bucket (paginated).
   - For each template: download → unzip with `JSZip` → load `word/document.xml`.
   - Run a regex over the XML that locates the broken pattern (any sequence of `<w:r>...{{...</w:r><w:r>...br_p_vesting}}...</w:r>` optionally followed by a trailing whitespace-only run that contains `<w:b ` bold marker) and replaces those runs with a single canonical run:
     ```xml
     <w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve"> {{br_p_vesting}} </w:t></w:r>
     ```
   - Also handle the simpler in-place case where `{{br_p_vesting}}` lives in a single run that has `<w:b w:val="1"/>` — strip the `<w:b .../>` and `<w:bCs .../>` from that run's `<w:rPr>`.
   - Collapse any accidental double spaces around the tag (`"  {{br_p_vesting}}"` → `" {{br_p_vesting}}"`).
   - Re-zip and upload back to the same storage path with `upsert: true`.
   - Return a JSON summary: scanned, modified, skipped, errors list.

2. **Invocation**
   - User invokes the function once via `supabase.functions.invoke('fix-vesting-tag-formatting')` (or I'll trigger it). Function processes in a single pass; if it nears the CPU limit it returns a `cursor` token so it can be resumed (mirrors the `replace-broker-company-tag` pattern already in the repo).

3. **No application/runtime code changes**
   - Tag parser, field resolver, `legacyKeyMap`, and `generate-document` are untouched — the data path for `br_p_vesting` already works; only the template XML is broken.

## Out of scope

- Other split-tag offenders. Only `{{br_p_vesting}}` is normalized in this pass, per the request ("ALL documents where `{{br_p_vesting}}` has bold formatting breaking the tag").
- Database, UI, or field-dictionary changes.

## Verification

- After the function reports complete, regenerate `Assignment_of_Rents_and_Profits_Agreement_With_Field_Codes` for the current deal and confirm:
  - Output reads `...and between This is the Borrower Vesting Area (Trustor")...` (no duplication).
  - The vesting value is plain (non-bold) text.
- Spot-check one other template flagged as modified in the function's response.

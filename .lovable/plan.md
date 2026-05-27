## Goal
Make the document print every property's address instead of only the first one, using per-index merge tags.

## Background
`{{pr_p_address}}` is intentionally a single-value alias bound to the first property only (see `supabase/functions/generate-document/index.ts` around line 3454 — the generator deliberately does NOT overwrite `pr_p_address` with a combined list because per-property blocks rely on the un-indexed name).

The generator already publishes per-index aliases for every property on the deal:
- `pr_p_address_1`, `pr_p_address_2`, `pr_p_address_3`, …
- Auto-computed from `pr_p_street_N` / `pr_p_city_N` / `pr_p_state_N` / `pr_p_zip_N` (index.ts:2630–2648)

No code or backend changes are needed — the data is already there. Only the Word template needs to be updated.

## What needs to happen

1. **Confirm scope with user**
   - Which template is this? (filename / template name in `templates` table)
   - Max number of property slots to render (3? 5? 10?). Empty slots will render blank — that's expected and safe.

2. **Edit the Word template**
   Replace the single line:
   ```
   Property Address: {{pr_p_address}}
   ```
   with one line per slot, for example (max = 5):
   ```
   Property 1 Address: {{pr_p_address_1}}
   Property 2 Address: {{pr_p_address_2}}
   Property 3 Address: {{pr_p_address_3}}
   Property 4 Address: {{pr_p_address_4}}
   Property 5 Address: {{pr_p_address_5}}
   ```
   Done in MS Word directly, then re-uploaded via the Template Management page (no code change).

3. **(Optional) Hide empty slots**
   Per-index tags for properties that don't exist resolve to an empty string, so the label line will still show ("Property 4 Address: "). If you want unused slots fully suppressed, that requires `{{#if}}` conditional wrapping in the template — tell me and I'll include that variant in the snippet.

## Technical notes
- No edge function changes.
- No field_dictionary changes.
- No DB migration.
- Deliverable from me is the exact text block to paste into the template plus (if requested) the conditional `{{#if pr_p_address_2}}…{{/if}}` wrappers.

## Open questions before implementation
- Template name/file?
- Max number of property slots?
- Wrap each line in `{{#if}}` to hide empty slots — yes or no?

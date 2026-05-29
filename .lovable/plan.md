# Plan — Fix "Lender:" → "Lender 1:" + trailing space in Addendum to LPDS

## Diagnosis

Confirmed by unpacking the active template (`1780062103672_Addendum_to_LPDS__1___3__v2.docx`):

- The Lender 1 label paragraph is literally: `Lender: {{#if (eq ld_p_lenderType "Individual")}}{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}{{else}}{{ld_p_vesting}}{{/if}}`
- It is split across two `<w:r>` runs: the first run holds `Lender: ` (label, `sz 22`, color `231F20`), the second run holds the conditional name expression (Arial, `sz 19`).
- Lenders 2..N are built by the runtime cloner in `supabase/functions/generate-document/index.ts` (~line 8443), which writes `Lender ${labelN}: ${displayName}` where `displayName` is a single, trimmed string. So Lender 1's discrepancy is entirely on the template side.

Trailing-space cause: the Individual branch concatenates `{{ld_p_firstIfEntityUse}}{{ld_p_middle}}{{ld_p_last}}` directly. If a stored value carries a trailing space (commonly `ld_p_middle` when empty/padded), the rendered Lender 1 line gets a trailing space that Lenders 2..N (which use the single `displayName` from the cloner) never have.

## Fix — one-shot edge function, no app code changes

Create `supabase/functions/rewrite-lpds-lender1-label/index.ts` (modeled on the existing `rewrite-addendum-default-template`). It will:

1. Look up the `Addendum to LPDS` template row, download the current `file_path` from the `templates` bucket.
2. Locate the single paragraph whose flattened text starts with `Lender:` and contains `ld_p_lenderType`.
3. Rebuild that paragraph as a clean two-run structure that preserves the existing formatting:
   - Run 1 — copies the existing first-run `<w:rPr>` (color `231F20`, `sz 22`) and writes text `Lender 1: ` (note the trailing space).
   - Run 2 — copies the existing second-run `<w:rPr>` (Arial, `sz 19`) and writes the conditional expression rewritten to a single token so no concatenation can introduce stray whitespace: `{{#if (eq ld_p_lenderType "Individual")}}{{ld_p_firstIfEntityUse}} {{ld_p_last}}{{else}}{{ld_p_vesting}}{{/if}}`.
   - Middle is dropped from the label line because it is the documented source of the trailing space and is not displayed in any other lender block. Vesting (entity branch) is unchanged.
   - Existing `<w:pPr>` is preserved verbatim (indent, spacing, etc.).
4. Pack and upload as `…_v3.docx`, then update the `templates.file_path` to point at the new file.
5. Expose `?verify=1` returning the rewritten paragraph text plus booleans `has_lender1`, `still_has_bare_lender`, `still_has_middle_token`.

The function is idempotent: if the paragraph already starts with `Lender 1:`, it returns `changes: 0` without uploading.

## Out of scope (explicitly NOT changing)

- No edits to `generate-document/index.ts` — Lender 2..N cloner already produces `Lender N: <displayName>` correctly.
- No edits to UI, schema, field dictionary, or any other template.
- No change to Signature / Date paragraphs in the Lender 1 block.
- No change to entity-branch vesting rendering.

## Verification

1. Deploy and POST the new function — expect `changes: 1` and a new `…_v3.docx`.
2. GET with `?verify=1` — expect paragraph text `Lender 1: {{#if (eq ld_p_lenderType "Individual")}}{{ld_p_firstIfEntityUse}} {{ld_p_last}}{{else}}{{ld_p_vesting}}{{/if}}` and `still_has_bare_lender: false`, `still_has_middle_token: false`.
3. Generate Addendum to LPDS for a deal whose primary lender is `Michael Carter` (individual) — expect rendered line `Lender 1: Michael Carter` (no trailing space).
4. Generate for a deal with multiple lenders — expect `Lender 1: …`, `Lender 2: …`, …, all formatted identically.

## Risk / fallback

If `ld_p_middle` is required somewhere downstream for the Lender 1 label specifically, I will switch the Individual branch to `{{ld_p_vesting}}` (same as the entity branch) — this is the safest token because `ld_p_vesting` is also what every Lender 2..N renders. One-line tweak inside the rewriter.

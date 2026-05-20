# Personal Guaranty — Guarantor signature line fix

## Confirmed findings

- DB template name is `Personal Guaranty by Third Party` (single active template); user referenced it as `_v3`. Same file.
- In the stored DOCX, the signature line reads literally `Guarantor: ` with no merge tag (verified by unpacking the uploaded copy). Borrower already uses `{{br_p_fullName}}` in the same paragraph; Guarantor was never wired.
- The generator (`supabase/functions/generate-document/index.ts`) has zero references to `ag_p_*` or `additional_guarantor` — the alias does not exist anywhere yet.
- Additional Guarantor data is authored two ways in the system:
  1. As a **participant** with `contact_type = 'additional_guarantor'` linked to a `contacts` row (this is what the screenshot AG-00011 shows — "Adtn Guarantor Marc Boucher").
  2. As deal section values under a borrower-style prefix when edited via Borrower → Additional Guarantor sub-tab.
- Source of truth for the signature: **participants table → contacts.full_name** (matches the user's instruction).

## What to build

### 1. Publisher: emit `ag_p_*` aliases in the document generator

In `supabase/functions/generate-document/index.ts`, alongside the existing `ld_p_*` / `br_p_*` publisher blocks (~line 4977), add an Additional Guarantor block that:

- Loads `deal_participants` for the current deal joined to `contacts` where `contact_type = 'additional_guarantor'`, ordered by `sequence_order ASC NULLS LAST, created_at ASC`.
- Picks the **first** AG record as the default (per user spec).
- Publishes:
  - `ag_p_fullName`  ← `contacts.full_name`
  - `ag_p_first`     ← `contacts.first_name`
  - `ag_p_middle`    ← `contacts.contact_data->>'middle_name'` (or empty)
  - `ag_p_last`      ← `contacts.last_name`
- Also publishes per-index aliases for downstream multi-AG templates: `ag_p_fullName_1`, `_2`, … and `ag_p_first_N`, `ag_p_middle_N`, `ag_p_last_N`.
- If no AG participant exists, publishes empty strings so `{{ag_p_fullName}}` resolves to `""` rather than leaking a literal `{{...}}` token.

Source preference order (mirrors how `br_p_*` resolves today):

1. AG participant via `deal_participants` join (primary).
2. Fallback to deal_section_values under any `additional_guarantor*.full_name` / `borrowerN.full_name` prefix where the borrower row has `borrower_type = 'additional_guarantor'`, only if (1) returns nothing.

### 2. One-shot template patcher

Add `supabase/functions/patch-guarantor-signature-tag/index.ts` (mirrors the existing `fix-vesting-tag-formatting` and `replace-broker-company-tag` pattern):

- Downloads every active template DOCX from `templates` bucket.
- Unzips, scans `word/document.xml` for the literal text `Guarantor:` immediately followed by a whitespace-only run with no following `{{...}}` merge tag (case-sensitive, single-paragraph scope to avoid touching `Guarantor` mentions in body prose).
- Inserts a new run `<w:r><w:rPr>…(copy of preceding run rPr but stripped of bold/highlight)…</w:rPr><w:t xml:space="preserve"> {{ag_p_fullName}}</w:t></w:r>` right after the `Guarantor:` text run.
- Repacks DOCX, uploads back to storage (versioning preserved), logs which templates were touched.
- Idempotent: if the paragraph already contains `{{ag_p_fullName}}` or `{{ag_p_`, skip.

Initially targets only `Personal Guaranty by Third Party`. A `?all=true` query flag scans every active template — this satisfies the "apply to ALL documents with an unmapped Guarantor: line" requirement and lets the user opt-in after reviewing the dry-run log.

### 3. Runtime safety pass (defense in depth)

In `generate-document/index.ts`, inside the post-merge XML scrub pass (after merge-tag replacement, where similar safety passes for RE851A/RE851D live), add a small pass that:

- Finds paragraph text matching `/Guarantor:\s*(Date:|$|<w:t)/` (i.e. label with empty value).
- Inserts the resolved `ag_p_fullName` value (already computed in step 1) inline.
- Skipped if the paragraph already contains a non-empty value after `Guarantor:`.

This makes future templates self-healing even if someone forgets to add the merge tag.

### 4. Field dictionary entry

Insert `ag_p_fullName` (plus `ag_p_first`, `ag_p_middle`, `ag_p_last`) into `field_dictionary` as `data_type=text`, `section='borrower'`, `is_calculated=true` (calculated/auto-populated, not user-edited at the deal level), so the validation step in `validate-template` recognizes them and the Admin Field Dictionary page lists them.

## Files to change

- `supabase/functions/generate-document/index.ts` — add AG publisher (~30 lines) + safety pass (~20 lines).
- `supabase/functions/patch-guarantor-signature-tag/index.ts` — new one-shot edge function.
- DB migration — 4 new `field_dictionary` rows.

## Multi-AG behavior

- Default: first AG by `sequence_order` then `created_at`.
- Per-index aliases `_1`, `_2`, … emitted for templates that explicitly want N guarantors.
- No UI picker added (per user spec: "the first Additional Guarantor record by default unless a specific one is selected during document generation" — selection UI is out of scope for this change and would be a separate feature).

## Out of scope

- New UI to pick which AG to use at generation time.
- Re-uploading the user-provided `Personal_Guaranty_by_Third_Party-2.docx` as a new template version (the patcher edits the existing stored template in place).

## Open question

The user spec lists field keys `ag_p_fullName`, `ag_p_first`, `ag_p_middle`, `ag_p_last`. None currently exist in `field_dictionary`. Plan assumes I create them. Confirm or, if you already have different canonical keys for AG, tell me and I'll use those instead.

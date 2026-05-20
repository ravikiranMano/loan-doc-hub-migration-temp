## Goal

Replace the flat `ld1..ld5` indexed lender field keys with the same **repeatable lien-style** pattern already used by Property → Liens. No changes to UI, schema, validations, or any other generation flow.

## How Property → Liens works today (reference pattern)

- **Source values** are written under dot-notation keys per index: `lien1.holder`, `lien2.holder`, … plus a bare `lien.holder`.
- **Publisher** in `generate-document/index.ts` (lines ~3391–3583) walks `fieldValues`, matches `^lien(\d*)\.(.+)$`, collects entries per `(field, index)`, then:
  - publishes a bare short key (`pr_li_lienHolder`) as newline-joined multi-lien value,
  - publishes per-index `_N` variants used by template tables,
  - bridges to canonical `property1.lien_*` and to alternate `li_*` keys.
- **Field dictionary** holds one logical row per field (e.g. `pr_li_lienHolder`) marked `is_repeatable=true`; templates use both `{{pr_li_lienHolder}}` and `{{pr_li_lienHolder_N}}`.

## Plan for Multiple Lenders

### 1. Lender source keys (dot-notation, repeatable)

Adopt the same shape as `lienN.*`:

```
lender1.first_name      lender2.first_name      lenderN.first_name
lender1.middle_name     lender2.middle_name     lenderN.middle_name
lender1.last_name       lender2.last_name       lenderN.last_name
lender1.vesting         lender2.vesting         lenderN.vesting
```

`full_name` is **derived**, never stored: `First + " " + Middle + " " + Last` with blanks skipped so no double space when Middle is empty.

### 2. Publisher rewrite in `supabase/functions/generate-document/index.ts`

Replace the current `ld1_p_* … ld5_p_*` block (lines ~975–1018) with a lien-style aggregator:

- Order lenders by `orderedLenderParticipants` (sequence_order, created_at) — Lender 1 = primary, matching today's `ld_p_*`.
- For each lender N, populate `lenderN.first_name`, `lenderN.middle_name`, `lenderN.last_name`, `lenderN.vesting` into `fieldValues` from the contact row.
- Run an aggregator (mirror of `lienFieldCollector`):
  - Per-index keys: `ld_p_firstName_N`, `ld_p_middleName_N`, `ld_p_lastName_N`, `ld_p_fullName_N`, `ld_p_vesting_N` (used by repeatable template tables).
  - Bare keys: `ld_p_firstName`, `ld_p_middleName`, `ld_p_lastName`, `ld_p_fullName`, `ld_p_vesting` — newline-joined across all lenders, matching the lien aggregation rule (so existing templates that use the bare tag continue to render all lenders, like the lien table does).
- Preserve the existing `ld_p_*` primary-lender values for backward compatibility: bare key resolution still works because Lender 1 is always first in the join order.

### 3. Field Dictionary entries

In `field_dictionary`, register the canonical lender keys as repeatable rows (one logical row per field, just like `pr_li_lienHolder`):

| field_key            | section | data_type | is_repeatable | is_calculated |
|----------------------|---------|-----------|---------------|---------------|
| `ld_p_firstName`     | lender  | text      | true          | false         |
| `ld_p_middleName`    | lender  | text      | true          | false         |
| `ld_p_lastName`      | lender  | text      | true          | false         |
| `ld_p_fullName`      | lender  | text      | true          | true          |
| `ld_p_vesting`       | lender  | text      | true          | false         |

Remove the 25 flat `ld1_p_* … ld5_p_*` rows inserted in the previous turn (they are superseded by the repeatable rows). No other field_dictionary rows change.

### 4. Template usage

Templates can use either form, identical to how the lien template tags work:
- `{{ld_p_fullName}}` → newline-joined list of all lenders (bare aggregate).
- `{{ld_p_fullName_1}}`, `{{ld_p_fullName_2}}`, … → per-lender values inside repeatable rows.

Same for `firstName`, `middleName`, `lastName`, `vesting`.

### 5. Out of scope (explicitly unchanged)

- No UI changes (Lenders table, modals, sidebar, validations).
- No schema migrations beyond the `field_dictionary` rows above.
- No changes to non-lender publishers, no changes to docx-processor, no changes to tag-parser.
- No changes to existing `ld_p_*` primary-lender keys or `authorized_signer.*` aliases.
- No changes to session, auth, or any other generation step (RE851A/D, guaranty, etc.).

## Files to change

- `supabase/functions/generate-document/index.ts` — replace the per-lender `ld{N}_p_*` block with the lien-style aggregator described in §2.
- `field_dictionary` (DB) — insert 5 repeatable lender rows from §3 and delete the 25 flat `ld1..ld5` rows.

## Validation

- Generate a document on deal `22fc75ab-16cc-475e-b318-d93f493b2a44` containing 2+ lenders.
- Confirm `{{ld_p_fullName_1}}` and `{{ld_p_fullName_2}}` resolve to the right names with no double space when middle is blank.
- Confirm `{{ld_p_fullName}}` (bare) renders both lenders newline-joined, matching the lien pattern.
- Confirm existing single-lender templates still render Lender 1 correctly (backward compat).

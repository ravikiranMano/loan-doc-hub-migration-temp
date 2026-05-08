## Annual Property Taxes — RE851D per-property population

### Diagnosis

The publishers already exist in `supabase/functions/generate-document/index.ts` (lines 1205–1229) and emit per-property values from CSR → Property → Property Tax:

- `pr_pt_annualTaxes_{N}` ← `propertytax{N}.annual_payment` (currency)
- `pr_pt_actual_{N}` / `pr_pt_actual_{N}_glyph` ← Confidence == "Actual"
- `pr_pt_estimated_{N}` / `pr_pt_estimated_{N}_glyph` ← Confidence == "Estimated"

The template `Re851d_v1(1)(2)(13)` already uses these tag literals:

- `{{pr_pt_annualTaxes_N}}`
- `{{pr_pt_actual_N_glyph}}`
- `{{pr_pt_estimated_N_glyph}}`

**Why they aren't populating:** these keys are **missing from the RE851D `_N` rewrite registration list** (around line 3585 in `index.ts`), so `_N` never gets rewritten to `_1`, `_2`, … per property. The publisher emits `pr_pt_annualTaxes_2`, but the document still contains literal `pr_pt_annualTaxes_N` and never matches.

A second, smaller defect was found in the template XML: two occurrences of `{{pr_pt_estimated_N_glyph}}}}` carry an extra trailing `}}`. After the rewrite they will render as `☑}}` / `☐}}`. This is a template authoring issue, not a code issue.

### Field keys to use in template

These are the canonical keys (no admin/dictionary changes needed — they are runtime-published aliases):

| Purpose | Tag to place in template |
|---|---|
| Annual tax amount (currency) | `{{pr_pt_annualTaxes_N}}` |
| ACTUAL checkbox glyph | `{{pr_pt_actual_N_glyph}}` |
| ESTIMATED checkbox glyph | `{{pr_pt_estimated_N_glyph}}` |

`_N` is rewritten per property (Property #1 → `_1`, #2 → `_2`, …). Boolean variants `pr_pt_actual_N` / `pr_pt_estimated_N` are also published if `{{#if}}` blocks are preferred.

### Code change (single file)

**`supabase/functions/generate-document/index.ts`** — append to the RE851D `_N` rewrite key list near line 3585 (alongside `propertytax.annual_payment_N`, `propertytax.delinquent_N`, etc.):

```
"pr_pt_annualTaxes_N",
"pr_pt_actual_N_glyph", "pr_pt_actual_N",
"pr_pt_estimated_N_glyph", "pr_pt_estimated_N",
```

Longest variants (`_glyph`) listed first so the longest-match scanner consumes them before the bare boolean key.

### Validation behavior (already implemented in publisher)

- Only one of ACTUAL / ESTIMATED resolves to ☑; the other is ☐.
- If Confidence is null/blank, both render as ☐.
- If Annual Payment is blank, no `pr_pt_annualTaxes_{N}` is published → tag falls through anti-fallback shield (renders blank).
- Currency formatting handled by existing `dataType: "currency"` pipeline.

### Out of scope

- No field-dictionary additions (publisher already exposes these as merge tags).
- No template upload/edit (user owns the template; the trailing `}}}}` typo on the ESTIMATED tag should be corrected by the user in two places).
- No DB schema, UI form, or other template changes.

### Verification

1. Deploy `generate-document`.
2. Regenerate RE851D for deal `db7517e9-…` with multiple properties having Property Tax set.
3. Confirm each property row in ANNUAL PROPERTY TAXES shows: `$amount` + correct ☑ next to ACTUAL or ESTIMATED, others ☐.

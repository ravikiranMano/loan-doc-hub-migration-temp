## Plan: Fix remaining RE851D blanks — author-defect template normalization

### Confirmed root cause (from latest generated doc)
After the previous TDZ fix, the `_N` rewriter is now running successfully — the generated output contains **zero surviving** `{{...}}` tags (except one malformed case). However, Property blocks #1–#5 still render with blank values. Inspection of the template reveals authoring defects in many merge tags that prevent the rewriter and resolver from binding values:

```
{{ pr_p_appraiseValue_ N }}        ← space before N
{{pr_p_appraiseValue_ N }}         ← space before N
{{pr_p_construcType_ N }}          ← space before N
{{pr_p_squareFeet_ N }}            ← space before N
{{property_type_sfr_owner _N}}     ← space before _N
{{   propertytax.annual_payment_N }}     ← multiple spaces (ok-ish)
{{   propertytax.delinquent_amount_N}}   ← multiple spaces (ok-ish)
{{pr_li_sourceOfPayment_ N }       ← space + missing closing brace
{{property_type_land_income_N}     ← missing closing brace (4 occurrences)
```

These tags fail the `_N` literal-substring rewriter because the inner whitespace breaks the match `pr_p_appraiseValue_N`. The merge-tag parser then trims outer whitespace only and looks up keys like `pr_p_appraiseValue_ N` (with internal space) which do not exist, so it prints empty strings.

### Changes to implement (single file, single function)

**File:** `supabase/functions/generate-document/index.ts` — inside the existing RE851D `_N` preprocessing block (right after the `xml` variable is decoded, before the existing `parens/braces` normalizers around lines 3973–4051).

Add three small XML-level normalizers, strictly scoped to `{{ ... }}` merge-tag bodies so they cannot touch document prose:

1. **Internal-whitespace collapse inside merge tags.** Inside any `{{ ... }}` token, collapse `_ N` → `_N` and ` _N` → `_N`. Restricted to known RE851D field-key prefixes (`pr_p_`, `pr_li_`, `ln_p_`, `property_type_`, `propertytax`) to avoid touching unrelated prose.

2. **Fix missing closing brace** for `{{property_type_land_income_N}` → `{{property_type_land_income_N}}` (4 occurrences). Use a strict regex requiring a single trailing `}` not followed by another `}`.

3. **Same brace fix** generalized to the same RE851D field-key prefixes, so any other future single-`}` defect inside this template family auto-heals.

After these run, the existing `_N` rewriter (which runs immediately afterward inside the same try block) will see clean tag bodies and will rewrite every per-property tag correctly.

### Verification
- Deploy the edge function.
- Regenerate RE851D for the current deal (`db7517e9-…`) and re-open the docx.
- Confirm Property blocks #1–#5 now show: street address, owner, appraisal value/date, square feet, construction type, encumbrances, LTV, etc.
- Confirm no surviving `{{...}` tokens remain in the rendered XML.

### Out of scope
- No template upload (server-side normalization avoids touching the storage object).
- No DB schema changes.
- No UI / form / field-dictionary edits.
- No changes to other templates or to RE851A/RE851B/RE885 logic.
- No changes to publishers or anti-fallback shield (those are already correct — the bug is purely tag-body sanitization).
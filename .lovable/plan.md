
## Root cause analysis

Looking at the latest edge-function logs for `generate-document`:

```
[generate-document] Cache HIT for deal=a4eefafb… template=dbd0d674… (cached at 2026-05-29T14:00:44…); skipped full regeneration
```

The DOCX the user is downloading is being **served from the 5-minute generation cache** (in `supabase/functions/generate-document/index.ts` lines 199–310). That cache only invalidates when `deal_section_values` or related contacts are updated — **it does not invalidate when the underlying template `file_path` changes**.

So even though:
- `rewrite-addendum-default-template` already published `…_v4.docx` with the `{{#if ln_p_defaultInterestModifierEnabled}} … {{else if ln_p_defaultInterestFlatRateEnabled}} … {{/if}}` block, and
- the publisher at lines 1911–1917 already emits `ln_p_defaultInterestModifierEnabled` / `ln_p_defaultInterestFlatRateEnabled` as `"true"`/`"false"` and `ln_p_defaultInterestFlatRate` as a passthrough decimal,

…the user keeps seeing the **pre-v4 cached output** ("Option 1 + Option 2 both rendered, flat-rate value blank, modifier visible at 0%"). That single issue accounts for Bugs 1–3.

Bug 4 (borrower name) is a separate, real resolver bug: the UI field labeled **"Entity Name"** (`BorrowerPrimaryForm.tsx` line 216) writes to `borrower.full_name` → legacy `br_p_fullName`. But the auto-compute block at `generate-document/index.ts` 3712–3738 *only* runs when `br_p_fullName` is empty, and the fall-through chain happily concatenates `first_name + middle + last_name` ("Blue" + "James" + "Ridge") when those exist — silently dropping the LLC entity suffix "Capital LLC" that lives in the Entity Name field. For LLC/Corp/Trust borrowers, the Entity Name must win over the first/middle/last concatenation.

No template, schema, UI, or other field needs to change.

## Plan

### 1. Add `ADDENDUM TO NOTE EVENT OF DEFAULT` to the cache-bypass list

In `supabase/functions/generate-document/index.ts` around line 209 the cache is already bypassed for `RE851D`, `RE851A`, `RE870`, Guaranty, and Note Purchaser templates. Extend that same condition to also bypass the Addendum-Event-of-Default template so every generation actually re-runs the publisher + the v4 template and never reuses a stale DOCX:

```ts
if (
  isTemplate851D || isTemplate870 ||
  /851a/i.test(template.name || "") ||
  /guaranty/i.test(template.name || "") ||
  /Note\s+Purchaser\s+Qualification(?:\s+Checklist)?/i.test(template.name || "") ||
  /ADDENDUM\s+TO\s+NOTE.*DEFAULT/i.test(template.name || "")
) {
  throw new Error("Template cache bypassed so runtime field publisher fixes always regenerate the DOCX");
}
```

This alone resolves Bugs 1, 2, and 3 — the existing publisher (1911–1917) already emits the correct booleans and the v4 template already has the `{{#if}}/{{else if}}/{{/if}}` block.

### 2. Re-run the v4 rewriter in verify mode, as a safety net

Call `rewrite-addendum-default-template?verify=1` once after the cache fix to confirm the live `_v4.docx` still contains:
- `{{#if ln_p_defaultInterestModifierEnabled}}`
- `{{else if ln_p_defaultInterestFlatRateEnabled}}`
- no surviving `Option 1:` / `Option 2:` / red helper text

If verification fails for any reason, re-execute the rewriter (no template key changes, no legal text changes).

### 3. Fix `br_p_fullName` resolution for LLC / Corp / Trust borrowers

In `supabase/functions/generate-document/index.ts`, replace the existing block at lines 3712–3738 with logic that:

1. Reads `borrower.borrower_type` (legacy `br_p_borrowerType`) and normalizes to lowercase.
2. If borrower type is `llc`, `corp`, `corporation`, `trust`, `partnership`, `s-corp`, `c-corp` (entity types), **always prefer the Entity Name field** (`borrower.full_name` / `borrower1.full_name` / existing `br_p_fullName` if non-empty) over any first+middle+last concatenation, even when first/middle/last are populated.
3. If borrower type is `individual` (or empty/unknown), keep the existing behavior: existing `br_p_fullName` → `borrower1.full_name` → `borrower.full_name` → first+middle+last → `loan_terms.details_borrower_name`.
4. Continue to mirror the resolved value back into `borrower.full_name` and `borrower1.full_name` (lines 3739–3748) so downstream tags stay consistent.

No new field keys are introduced; only the priority order changes, and only for entity-type borrowers. `br_p_fullName` itself is unchanged.

### 4. Deploy and verify end-to-end

1. Deploy `generate-document` and `rewrite-addendum-default-template`.
2. Hit `…/rewrite-addendum-default-template?verify=1` and confirm `success: true`.
3. Regenerate the Addendum doc for the current deal (`a4eefafb-cd04-4bf5-adb8-f432d79e0e65`) and confirm in logs:
   - No `Cache HIT` line for this template.
   - Publisher emits `ln_p_defaultInterestFlatRateEnabled=true`, `ln_p_defaultInterestFlatRate=18`, `ln_p_defaultInterestModifierEnabled=false`.
4. Open the new DOCX and confirm:
   - Single sentence: *"…shall increase to a flat rate of 18% (the "Default Rate")."*
   - No Option 1 / Option 2 lines, no red helper text.
   - Borrower line: `Borrower: Blue James Ridge Capital LLC`.

## Out of scope (explicitly unchanged)

- Field key names (`br_p_fullName`, `ln_p_loanNumber`, `ln_p_defaultInterestModifier`, `ln_p_defaultInterestFlatRate`, `ln_p_defaultInterestModifierEnabled`, `ln_p_defaultInterestFlatRateEnabled`).
- Any static legal text, the signature line, the date line, or page numbering in the template.
- The Loan → Penalties Default Interest UI, schema, or storage keys.
- Caching behavior for any template other than the Addendum.
- Borrower name resolution for non-entity (Individual) borrowers.

# Mobile Number not populating — root cause is the template itself

## Findings

The uploaded `Borrower_TCPA_and_E-Consent_v3.docx` has **no merge tags at all**. Inspection of `word/document.xml`:

- `grep -oE '\{\{[^}]+\}\}' word/document.xml` → 0 hits.
- The cell next to `Mobile Number:` is an empty paragraph (`<w:p/>`) — no placeholder, no SDT, no merge tag.
- The cell next to `Email Address:` contains the literal hard-coded string `michael.carter@blueridgecap.com`, not a merge tag.

So the document-generation engine has nothing to substitute in those cells. This is a template authoring issue — no engine change can populate a value where no placeholder exists.

The previously deployed `Borrower TCPA and E-Consent` template (id `fb98d525-…`, file `1779983999661_Borrower_TCPA_and_E-consent.wbk__1_.docx`) was the one with `{{br_p_fullName}}` / `{{ln_p_loanNumber}}` placeholders. The v3 you just uploaded appears to have lost all of them.

## Recommended fix

Patch the v3 `.docx` by replacing the contents of the two cells with merge tags, then re-upload it as the template binary. Specifically:

| Cell (label) | Current content | Replace with |
|---|---|---|
| Mobile Number | empty `<w:p/>` | `{{br_p_cellPhone}}` |
| Email Address | literal `michael.carter@blueridgecap.com` | `{{br_p_emailAddres}}` |

Both keys already resolve through the publishers added earlier:
- `br_p_emailAddres` → bridges from `borrower1.email` / `borrower.email` (already in `index.ts` ≈ L1491-1492 `publishBrAlias`).
- `br_p_cellPhone` → not yet bridged. Plan to add a third `publishBrAlias` call alongside the existing email/home/work block:

  ```text
  publishBrAlias("br_p_cellPhone", ["borrower1.phone.mobile", "borrower.phone.mobile"]);
  ```

  Mirrors the existing publishers, no behavioral change for other templates.

## Files touched

1. `supabase/functions/generate-document/index.ts` — add 1 line: `publishBrAlias("br_p_cellPhone", ["borrower1.phone.mobile", "borrower.phone.mobile"]);` next to the existing email/home/work publishers.
2. `Borrower_TCPA_and_E-Consent_v3.docx` — patch the two cells (`Mobile Number`, `Email Address`) to insert merge tags, then re-upload via the templates UI (or replace the binary in the `templates` storage bucket if you want me to do it programmatically).

## Verification

1. Redeploy `generate-document`.
2. Generate the v3 template against a deal with a known mobile number (e.g. on this route, deal `a4eefafb-…`) and confirm:
   - Mobile Number cell shows the borrower's mobile.
   - Email Address cell shows the borrower's email (no longer hard-coded).
3. Regression: regenerate one prior template that uses `borrower.email` / `borrower1.phone.mobile` to confirm no change.

## Open clarification

Two things to confirm before I make changes:

1. **Which merge tag name do you want for Mobile?** Options:
   - `{{br_p_cellPhone}}` (matches the existing `br_p_*` cell-phone field-dictionary entries `br_p_guarantoCellPhone`, `br_p_authPartyCellPhone`)
   - `{{borrower.phone.mobile}}` (already resolves via the indexed→canonical bridge with no extra publisher needed)
2. **Should I also templatize the hard-coded `michael.carter@blueridgecap.com`** into `{{br_p_emailAddres}}`? It looks like leftover sample data, but please confirm before I overwrite it.

Once you confirm, I'll patch the docx and re-upload it, add the one-line publisher, and redeploy.

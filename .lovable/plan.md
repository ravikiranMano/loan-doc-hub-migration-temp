## Diagnosis

Do I know what the issue is? Yes.

The generated RE851D file is being marked as successful even though `word/document.xml` still contains XML that Microsoft Word rejects. The current final integrity check is regex/stack-based and can miss XML namespace syntax failures such as merged element/attribute names (`<w:bookmarkEndw:id="..."/>`, `<w:szw:val="..."/>`, or adjacent attributes with no separating space). Word reports the failure at `word/document.xml` line 2 because DOCX XML is usually minified onto one long line.

I also found a separate logged RE851D bug: `detectRow is not defined` in the property-type alignment pass. That pass is failing safely, but it indicates this area has stale post-render XML mutation code and should be cleaned while fixing the corruption.

## Plan

1. **Add strict XML well-formedness validation**
   - Update the shared DOCX validator to parse each generated content XML part with `DOMParser`/strict XML parsing before upload.
   - Fail generation with a clear integrity error instead of saving a DOCX that Word cannot open.
   - Keep the existing structural checks as a second layer.

2. **Replace the fragile attribute-whitespace repair**
   - Add a tag-scoped OOXML repair helper that only edits XML tag boundaries, never visible document text.
   - Repair malformed patterns like:
     - `<w:bookmarkEndw:id="2"/>` → `<w:bookmarkEnd w:id="2"/>`
     - `<w:szw:val="16"/>` → `<w:sz w:val="16"/>`
     - `w:val="16"w:color="000000"` → `w:val="16" w:color="000000"`
   - Run this helper immediately before final validation and packaging.

3. **Fix the broken RE851D property-type alignment pass**
   - Define or inline the missing `detectRow` helper using the existing `ROW_LABELS` table.
   - Keep the pass limited to RE851D property-type paragraphs only.

4. **Add targeted diagnostics for Word error columns**
   - When validation fails, log the XML offset and surrounding snippet so future Word column errors can be traced directly.
   - Include parser-level failures that the current regex validator misses.

5. **Verify with the live RE851D flow**
   - Deploy `generate-document`.
   - Regenerate RE851D for the current deal.
   - Confirm the function either produces a parser-valid DOCX or blocks upload with an actionable integrity error.
   - Check logs for no unresolved `ld_p_vestin/ld_p_vesting` placeholders and no XML parser errors.

## Scope

- Backend document-generation fix only.
- No UI changes.
- No database/schema changes.
- No template layout redesign.
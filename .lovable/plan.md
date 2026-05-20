## Plan to fix RE851D Lender Vesting

**Root cause found**
- The generated output still shows `{ld_p_vestin` / `{{ld_p_vestin` style text, which means the template has a malformed single-brace version of the merge tag in this area.
- The previous alias fix only helps when the tag is parsed as a valid merge tag (`{{ld_p_vestin}}`). It does not catch malformed brace variants, so the parser never replaces it.
- The database confirms loan `DL-2026-0250` has multiple lenders; the currently selected lender records include vesting values, including `Vesting123` for `Adwait Verma`.

**Implementation**
1. In `supabase/functions/generate-document/index.ts`, add a narrowly scoped RE851D pre-render repair for the lender vesting tag variants:
   - `{ld_p_vestin`
   - `{ld_p_vestin}`
   - `{{ld_p_vestin}`
   - whitespace/run-fragmented equivalents inside the ACKNOWLEDGEMENT / prospective lender area
2. Normalize those variants into the resolved value directly, or into a valid `{{ld_p_vestin}}` token before the standard renderer runs.
3. Strengthen the lender vesting value source so `ld_p_vestin` is populated from the first lender with a non-empty vesting value if the initially selected participant has no usable vesting.
4. Keep the change scoped to RE851D document generation only. No UI, schema, template layout, or PDF layout changes.

**Validation**
1. Generate RE851D for deal `DL-2026-0250`.
2. Verify the ACKNOWLEDGEMENT OF RECEIPT / `NAME OF PROSPECTIVE LENDER/PURCHASER` line no longer contains raw `{ld_p_vestin` text.
3. Confirm the line renders the lender vesting value and remains aligned in both preview/docx output and PDF generation path.
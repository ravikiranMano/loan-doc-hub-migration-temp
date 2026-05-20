## Plan

1. **Keep the fix scoped to RE851D document generation only**
   - Edit only `supabase/functions/generate-document/index.ts`.
   - Do not change UI, database schema, APIs, save flow, calculations, validations, session handling, or document layout.

2. **Harden the appraiser conditional rewrite**
   - Update the existing RE851D appraiser conditional matcher so it recognizes the broken DOCX/template variants shown in the generated output, including:
     - `{{#if (eq pr_p_performeBy_N "Broker")}}N/A{{else}}{{/if}}`
     - `#if (eq pr_p_performeBy_N "Broker")N/A{{else}}{{/if}}`
     - missing/partial closing braces from Word XML run splitting
     - optional empty `{{else}}` branches
     - both `pr_p_performeBy_*` and `pr_p_performedBy_*`
     - `_N` and `_1` through `_5`
   - Preserve the existing safe rule that only rewrites recognized appraiser payloads:
     - `BPO Performed by Broker` → `{{pr_p_appraiserName_K}}`
     - `N/A` → `{{pr_p_appraiserAddress_K}}`
   - Keep the guard that skips any non-empty `else` payload so unrelated conditionals are not silently changed.

3. **Preserve per-property business logic**
   - Use the already-published per-property values:
     - Broker → `pr_p_appraiserAddress_K = "N/A"`
     - Third Party → `pr_p_appraiserAddress_K = ""`
   - Ensure the property index is resolved by the PROPERTY #1–#5 region, so DL-2026-0250 renders independently for each property.
   - Based on the backend data checked for `DL-2026-0250`, expected address results are:
     - Property #1 Third Party → blank
     - Property #2 Broker → N/A
     - Property #3 Broker → N/A
     - Property #4 Third Party → blank
     - Property #5 Broker → N/A

4. **Validate narrowly**
   - Verify the updated logic contains no broad formatting/layout changes.
   - Deploy only the updated `generate-document` backend function.
   - Validate by generating/previewing RE851D for the current deal and confirming:
     - no raw `#if`, `{{else}}`, or `{{/if}}` appears in ADDRESS OF APPRAISER
     - Broker renders `N/A`
     - Third Party renders blank
     - existing NAME OF APPRAISER behavior remains unchanged
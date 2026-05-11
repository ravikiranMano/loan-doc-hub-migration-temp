The issue is still the backend document generation path, not a missing merge value: the latest RE851D run is being killed with `CPU Time exceeded` after rendering the large `word/document.xml` file (~4.8 MB). `EdgeRuntime.waitUntil()` returns the UI response quickly, but it does not bypass Lovable Cloud function CPU limits, so the heavy RE851D post-processing still gets terminated.

Plan:

1. Reduce RE851D-only backend work before rendering
   - Keep the existing data calculations and aliases intact.
   - Avoid full-template preprocessing unless the RE851D template actually contains the specific `_N` placeholders that need rewriting.
   - Narrow valid-field lookup work for RE851D to the template-specific field keys plus generated aliases instead of carrying the full field dictionary where possible.

2. Consolidate or skip expensive RE851D post-render safety passes
   - Keep essential value population for liens, encumbrances, property values, and the new `pr_netPropertyValue` field.
   - Disable repeated XML-scanning checkbox safety passes when their anchor text is absent.
   - Reuse a single visible-text projection only where a pass truly needs it, and avoid rebuilding it after unrelated string mutations.
   - Move simple literal tag replacement into the main merge-tag render path where possible so it does not require another full DOCX scan.

3. Fix job status handling so the UI does not show stale “running” work as a new failure
   - Mark the current job failed if the backend is killed and no completion update arrives within the timeout window.
   - Prevent duplicate clicks from starting overlapping RE851D generation jobs for the same deal/template while one is already running.
   - Keep the existing realtime/polling behavior, only make the status reporting more accurate.

4. Validate against the actual failing deal/template
   - Deploy the updated `generate-document` function.
   - Run a single RE851D generation for deal `db7517e9-f124-4031-98c8-3e0f33caf889` / template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
   - Confirm the job reaches `success` and does not log `CPU Time exceeded`.
   - Confirm the generated document still includes `li_lt_anticipatedAmount`, `ln_p_amountOfEquity_N`, and `pr_netPropertyValue` values.
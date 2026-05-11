Current finding: the latest deployed run still dies with `CPU Time exceeded` after the main DOCX render finishes. The logged render itself is ~400ms; the function is being killed in the remaining RE851D-only work after `processDocx`, before upload/job completion. One job is still `running`, confirming the failure path never reaches the catch/update block.

Plan:

1. **Stop repeated RE851D post-render scans**
   - Replace the separate RE851D post-render safety passes with a single combined pass over `word/document.xml`.
   - Build visible text/property-region anchors once.
   - Collect all intended checkbox/value/addendum mutations first, then apply them once in reverse-offset order.
   - Avoid calling `__xmlSet()` between sub-passes so the projection/lowercase caches are not invalidated repeatedly.

2. **Remove duplicated pre-render XML normalization**
   - For RE851D `_N` expansion, avoid normalizing the full 4.8 MB XML before the main render unless unresolved `_N` placeholders are actually present.
   - Keep the existing `_N → _1.._5` behavior, but make it a cheap targeted rewrite path and let the main render own normalization.

3. **Keep required RE851D calculations intact**
   - Preserve existing publishers for `li_lt_anticipatedAmount`, `ln_p_amountOfEquity_N`, and `pr_netPropertyValue`.
   - Cache property/lien totals once and reuse them across generated aliases.
   - Do not alter document output mappings except where needed to avoid CPU-heavy duplicate work.

4. **Make stuck-job cleanup deterministic**
   - Add a lightweight cleanup on document-page load / job refresh that marks stale `running` RE851D jobs as `failed` after the timeout window, so the UI no longer stays stuck until another generation is attempted.
   - Keep the current realtime/polling behavior unchanged.

5. **Validate against the reported case**
   - Deploy `generate-document` after the code change.
   - Test with deal `db7517e9-f124-4031-98c8-3e0f33caf889` and template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
   - Confirm: no new `CPU Time exceeded`, job reaches `success` or explicit `failed`, and the generated document record appears.

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>
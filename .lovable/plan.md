Plan to fix RE851D generation without changing UI polling behavior:

1. Backend job guard and stale cleanup
- Move stale-running cleanup before creating a new `generation_jobs` record.
- Before inserting a new RE851D single-document job, check for an existing non-stale running job for the same deal/template and return that job instead of starting another.
- Mark stale/killed RE851D jobs as failed with a clear timeout message so the UI no longer stays on Running.

2. Restrict RE851D data/dictionary work
- For RE851D, avoid full field-dictionary expansion where possible and build the valid-key set from:
  - template field map keys,
  - keys actually present in `deal_section_values`,
  - RE851D dynamic alias families (`_1.._5`, encumbrance slot aliases, calculated aliases).
- Keep `li_lt_anticipatedAmount`, `ln_p_amountOfEquity_N`, and `pr_netPropertyValue` calculations unchanged, but compute their source lien/property aggregates once and reuse them.

3. Remove repeated large XML scans
- Gate the `_N` preprocessing so it only unzips/normalizes when the DOCX XML actually contains `_N` indexed placeholders.
- For the 4.8 MB `word/document.xml`, consolidate RE851D pre-render rewrites into one pass and avoid calling `normalizeWordXml` both before preprocessing and again during `processDocx` when the XML was already normalized.
- Disable post-render checkbox safety passes when their anchor text is absent, using cached lowercase/visible-text projections instead of rebuilding projections after each mutation.
- Keep one final rezip/flush after all RE851D post-render mutations.

4. Preserve document mapping behavior
- Ensure `li_lt_anticipatedAmount` is still published from UI lien anticipated amount values.
- Ensure `ln_p_amountOfEquity_N` remains per-property and currency formatted.
- Ensure `pr_netPropertyValue` remains backend-only, null-safe, currency formatted, and available as `{{pr_netPropertyValue}}`.

5. Deploy and validate
- Deploy only the `generate-document` backend function.
- Test the specified deal/template:
  - Deal: `db7517e9-f124-4031-98c8-3e0f33caf889`
  - Template: `43492f94-60ad-44c3-a8c2-24dabf36eac7`
- Verify recent function logs no longer show `CPU Time exceeded` and the job reaches `success` or a clear `failed` state.
- Confirm generated output includes the three required values.
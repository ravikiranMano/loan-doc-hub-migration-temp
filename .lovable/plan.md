Do I know what the issue is? Yes.

The failure is not from Word split tags anymore; the latest logs show the generated XML becomes malformed after the `INVESTOR NAME:` paragraph:

```text
</w:p> LenderHorizon Capital LLC</w:t><w:br/><w:t ...
```

That means the paragraph/run opening tags for the lender-name line were removed, but the closing `</w:t>` remained. The root cause is the nested conditional currently injected into the RE870 investor-name cell:

```text
{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}
```

After `{{#each lenders}}` expands it, the conditional parser matches the outer `#if` to the inner `{{/if}}` for `middle`, then `removeConditionalBlock()` deletes the surrounding `<w:p><w:r><w:t>` structure. That produces the exact orphan `</w:t>` shown in the logs.

Plan:

1. Update `supabase/functions/rewrite-re870-multi-lender/index.ts`
   - Rebuild only the RE870 `INVESTOR NAME` table cell.
   - Keep the two-paragraph layout:
     - paragraph 1: `INVESTOR NAME:`
     - paragraph 2: `{{#each lenders}}{{displayName}}{{/each}}`
   - Remove nested `#if` logic from this cell entirely.
   - Bump the rewrite marker to a new version so already-rewritten templates are reprocessed cleanly.
   - Keep all other RE870 fields unchanged.

2. Add a targeted parser regression test
   - Verify `{{#each lenders}}{{displayName}}{{/each}}` inside a single `<w:t>` expands to multiple lender names separated with `<w:br/>`.
   - Verify the result has balanced `<w:p>`, `<w:r>`, and `<w:t>` tags.
   - Include the failing nested-conditional shape as a guard so it does not silently corrupt XML again.

3. Deploy and re-run the RE870 template rewrite
   - Deploy `rewrite-re870-multi-lender`.
   - Invoke it with `force: true` for the three known RE870 templates.
   - Confirm logs show the templates were rewritten with the new marker.

4. Validate with the actual generation path
   - Regenerate the `Investor Questionnaire` for the current deal.
   - Check `generate-document` logs for no `word/document.xml is not well-formed` error.
   - Confirm the rendered cell structure is:

```text
INVESTOR NAME:
Horizon Capital LLC
BlueStone Investments Inc
Sarah Lynn Mitchell, a single woman
Michael Andrew Carter
```

No database schema changes are needed.
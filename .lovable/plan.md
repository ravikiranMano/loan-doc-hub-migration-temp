## Plan: Fix RE851D values still not populating

### Confirmed root cause from latest logs
The latest generation is still failing before rendering:

```text
RE851D _N preprocessing failed: Cannot access '__xmlGet' before initialization
```

That means the RE851D `_N` placeholder rewrite is skipped entirely. The document then reaches the renderer with literal `_N` tags, so property-indexed fields resolve blank even though the data exists.

### Changes to implement
1. **Fix helper initialization order only**
   - Move or duplicate the lightweight XML decode/encode helpers used by RE851D `_N` preprocessing so they are defined before the preprocessing block runs.
   - Keep the existing post-render cache helpers unchanged.
   - No database changes, no UI changes, no schema changes.

2. **Keep the existing RE851D mapping logic intact**
   - Do not refactor the publisher, calculations, field dictionary, or document flow.
   - Preserve the existing property-index rewrite logic and anti-fallback shield.

3. **Verify with function logs**
   - Regenerate RE851D for the current deal/template.
   - Confirm the error log disappears.
   - Confirm logs show `RE851D regions ... total=<nonzero>` and the existing `publish-snapshot` entries contain values.

4. **If values still do not render after the preprocessing fix**
   - Inspect the next logs only for the remaining binding gap.
   - Apply the smallest follow-up fix, likely adding `pr_p_ownerName` to the anti-fallback/publisher alias set if that specific key is blanked.

### Out of scope
- No template upload unless malformed `{{property_type_land_income_N}` tags are still visibly surviving after generation.
- No edits to unrelated templates or RE851A/RE885 logic.
- No database schema or API changes.
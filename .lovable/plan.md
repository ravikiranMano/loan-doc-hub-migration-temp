## Plan

1. **Fix property counting for the post-render safety pass**
   - Update the RE851D “Multiple / Additional Securing Property” post-render pass so it counts only real properties with identifying data, matching the earlier publisher logic.
   - Avoid counting placeholder/stale `propertyN.*` keys such as copied boolean defaults, which can make the checkbox state wrong.

2. **Make the checkbox anchor detection more robust**
   - Expand the visible-text question matcher to tolerate punctuation, casing, line breaks, and OCR/template spacing variants around “Is there Additional Securing Property?”.
   - Keep the change scoped to RE851D only.

3. **Handle label/control ordering consistently**
   - For each detected question occurrence, choose the YES and NO checkbox controls closest to their labels within the local question window.
   - Preserve existing support for Word SDT checkboxes, bare glyph checkboxes, and inline `☐ YES ☐ NO` runs.

4. **Prevent literal merge tags from surviving**
   - Add a final RE851D-scoped fallback that directly resolves any remaining `{{pr_p_multipleProperties_yes/no(_glyph)?(_N|_1.._5)?}}` tags after the normal merge pass.
   - This covers templates where Word splits the tag or where the tag variant differs from the current allowlist.

5. **Validate with the affected deal/template**
   - Regenerate or inspect the generated RE851D output for the current deal/template.
   - Confirm Properties #1 through #5 all show actual checkbox glyphs/controls and no `pr_p_multipleProperties` literals remain.
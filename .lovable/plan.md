## Plan

1. **Remove the corrupting RE851D balloon-label insertion path**
   - The latest logs show the final XML now fails with `unbalanced <w:r>` and the diagnostic window contains `</w:r>w:r>... NO #if`.
   - That points to the RE851D post-render encumbrance balloon pass inserting a synthetic `YES / NO / Unknown` label run at an unsafe run boundary.
   - Keep the checkbox/glyph forcing logic, but stop injecting new label runs there. The template already contains those labels; this avoids creating malformed Word run XML.

2. **Tighten the RE851D balloon cleanup**
   - Keep cleanup limited to `<w:t>` text nodes.
   - Strip leftover balloon Handlebars fragments like `#if`, `else`, `/if`, and `pr_li_*_balloon*` text after glyph forcing so the document does not display template syntax.
   - Do not alter surrounding paragraphs, tables, or runs beyond those text bodies.

3. **Reduce CPU risk on the failing flow**
   - Avoid unnecessary extra insert/edit work in the large RE851D post-render section.
   - Preserve the existing final integrity check, but the pass should now have fewer edits and avoid the malformed run that triggers retries/timeouts.

4. **Validate against the actual failing case**
   - Deploy `generate-document` after the code change.
   - Invoke generation for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` and template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
   - Confirm logs no longer show `DOCX_INTEGRITY` or `CPU Time exceeded` and that a new successful `generated_documents` record appears.

5. **Clear/handle stale running jobs if needed**
   - If the existing `running` job remains stale from the prior CPU-killed attempt, mark or let the next request mark it failed via the existing stale-job sweep so the UI can reflect the new result.

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>
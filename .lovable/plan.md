## Root cause

The RE851D template itself is well-formed; the corruption is introduced during generation after the normal DOCX render succeeds.

The failing XML fragment is:

```text
</w:sdt><w:r><w:rPr><w:color w:v<w:r><w:rPr>...
```

That means a post-render replacement was applied at an offset inside an XML tag (`<w:color w:v...`) instead of at a full Word run boundary. This leaves an unfinished parent `<w:rPr>` / `<w:r>` and inserts a new checkbox/value run inside it, so validation fails with:

```text
expected </w:rPr> before </w:p> at offset 343087
```

The current `repairUnclosedRunProperties` pass does not fix this because the XML is not just missing `</w:rPr>`; it also contains a partial tag fragment (`<w:color w:v`) caused by stale replacement offsets.

The specific source is the RE851D post-render encumbrance pass: it queues inserts/replacements using offsets from one XML string, then the balloon-token scrub mutates `xml` before those queued edits are applied. Once that scrub changes length, the queued offsets no longer point to the original run boundaries, so a later replacement can splice into the middle of `<w:rPr>`.

## Fix plan

1. **Make the RE851D encumbrance post-render pass offset-safe**
   - Stop mutating `xml` immediately inside the balloon-token scrub block.
   - Convert balloon-token cleanup into queued edits with original `start/end` offsets.
   - Apply value-cell inserts, balloon checkbox replacements, and token-scrub removals together in one sorted edit pass against the same original XML snapshot.
   - Keep the existing overlap-drop guard so competing edits are skipped instead of corrupting XML.

2. **Add boundary validation before applying queued edits**
   - For every replacement edit, verify it starts at a safe XML element boundary and does not start inside an open tag.
   - If an edit is unsafe, drop it and log a concise diagnostic rather than corrupting the document.

3. **Keep strict final DOCX validation**
   - Keep `validateContentXmlPart` enabled before upload.
   - Keep the current internal context logging around any future failing offset.
   - Do not bypass validation and do not mark corrupt DOCX files as successful.

4. **Verify with the live RE851D case**
   - Deploy the updated `generate-document` function.
   - Regenerate RE851D for deal `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` and template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
   - Confirm the `generation_jobs` row reaches `success`.
   - Download the produced DOCX and validate `word/document.xml` locally for well-formed XML.
   - Confirm the same malformed fragment no longer appears.

## Files to change

- `supabase/functions/generate-document/index.ts`
  - Update only the RE851D encumbrance post-render edit application.
  - Add safe-boundary checks near the existing edit queue.

No schema changes, no frontend changes, and no template upload changes are needed.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>
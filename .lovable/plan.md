## Findings

The mismatch is caused by the RE851D encumbrance rewrite using the wrong column geometry. The generated document currently changes the checkbox area to two equal-width columns:

```text
left column 5723 / right column 5723
```

The original reference uses a narrow right checkbox column:

```text
left column 9398 / gutter 73 / right column 2049
```

That is why the generated YES/NO rows float around the page and sometimes appear far right or mid-page instead of lining up next to the dotted question rows.

## Plan

1. Update only `supabase/functions/rewrite-re851d-encumbrance-layout/index.ts`.
2. Stop forcing `<w:jc w:val="right"/>` on checkbox paragraphs; the reference does not right-align those paragraphs inside the checkbox column.
3. Normalize the RE851D encumbrance section column breaks to match the original template exactly:
   - full-width text section for question rows,
   - two-column checkbox section with `w:w="9398"`, `w:space="73"`, and `w:w="2049"`,
   - return to full-width section after each checkbox pair group.
4. Preserve current field keys and checkbox values exactly; no business logic changes.
5. Keep the existing keep-with-next/keep-lines behavior, but apply it without changing the original visual geometry.
6. Deploy the updated backend function and run it against the RE851D template path.
7. Generate/inspect a fresh RE851D output and compare the encumbrance pages against the uploaded reference, confirming:
   - question text stays full width with dotted leaders,
   - YES/NO pairs sit in the narrow right column like the original,
   - no orphaned floating checkbox rows,
   - all five property sections use the same layout.
## Fix RE885 Other Liens — alignment under Lienholder / Amount Owing / Priority

### Diagnosis

Data publishing is already correct. `pr_li_lienHolder`, `pr_p_currentBalanc`, `pr_li_lienPrioriNow`, `li_lt_anticipatedAmount`, and `pr_li_lienPrioriAfter` are emitted by the publishers in `supabase/functions/generate-document/index.ts` (lines ~2595–2797). The values shown in image-530 (`Stephen / 18,000.00 / 1st`, `Stephen / 12,000.00 / 2nd`) are correct.

The shift seen is a **template layout problem**, not a code problem:

- In the current RE885 template (section XVI – Other Liens), the three column labels and the three merge tags below them are placed in a single paragraph using **tab stops / spaces**, not in a Word table.
- When `{{pr_p_currentBalanc}}` (16 chars) becomes `18,000.00` (9 chars) and `{{pr_li_lienPrioriNow}}` becomes `1st`, the tab columns reflow because Word recomputes tab positions from the resulting text width. That is why the second column drifts left and the third column shifts right of its header.
- This cannot be fixed reliably from the doc-gen engine — the only stable fix is to bind the values into a fixed-width Word table in the template itself.

### Required template change (RE885 section XVI)

Replace each of the two tab-aligned blocks with a real 3-column Word table.

Block 1 — "Currently obligated":

```
┌──────────────────────┬──────────────────────┬─────────────────────────┐
│ Lienholder's Name    │ Amount Owing         │ Priority                │   ← header row (italic)
├──────────────────────┼──────────────────────┼─────────────────────────┤
│ {{pr_li_lienHolder}} │ {{pr_p_currentBalanc}} │ {{pr_li_lienPrioriNow}} │
└──────────────────────┴──────────────────────┴─────────────────────────┘
```

Block 2 — "Liens that will remain or are anticipated":

```
┌──────────────────────┬──────────────────────────────┬──────────────────────────┐
│ Lienholder's Name    │ Amount Owing                 │ Priority                 │
├──────────────────────┼──────────────────────────────┼──────────────────────────┤
│ {{pr_li_lienHolder}} │ {{li_lt_anticipatedAmount}}  │ {{pr_li_lienPrioriAfter}}│
└──────────────────────┴──────────────────────────────┴──────────────────────────┘
```

Rules for the template edit:

1. Each merge tag must live entirely inside one `<w:tc>` cell — no split runs, no surrounding tabs/spaces in the cell.
2. Set fixed column widths in DXA on the table and on each cell (e.g. 3120 / 3120 / 3120 for a 9360 DXA content area) and disable AutoFit ("Fixed column width").
3. Keep the existing italic style on the header row. If the visual underline rule below the data row is required, keep it as a bottom cell border instead of the current paragraph underline.
4. Do NOT change any field key names, the Roman numeral XVI, the question text, the YES/NO checkboxes, the descriptive sentences between the two tables, or any other section.

### Code changes

**None.** The publishers already emit the correct values. No edits to publishers, doc-gen engine, schema, or UI.

### What's needed to apply the fix

The `.docx` template lives in the `templates` storage bucket and is not in the repo. To proceed I need one of:

- The current RE885 `.docx` re-uploaded here, so I can rebuild section XVI as the two fixed-width tables and re-upload via the existing `upload-template` flow; **or**
- Confirmation that you will edit the template manually in Word using the structure above.

### Validation after the template is updated

Generate RE885 against the same deal and verify:

- Single lien per section: `Stephen | 18,000.00 | 1st` sits exactly under the three header cells.
- Multiple liens: each lien renders in its own row with stable column alignment regardless of name/amount length.
- No drift, no wrapped text, no extra blank rows, no other section affected.

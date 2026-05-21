## Plan: deep fix for RE870 INVESTOR NAME placement

### What I found
- The current rewrite does put the lender loop into a cell that contains `INVESTOR NAME:`.
- But in at least one live template, that cell has `w:gridSpan="2"` and centered paragraph styling, so visually it still lands under/near the centered INVESTOR header area instead of the true left column position.
- The issue is therefore not only “wrong tag text in wrong cell”; it is also the Word table geometry/paragraph styling around the INVESTOR header/name rows.
- `NAME OF PERSON COMPLETING` is already targeted, but I’ll make it use the primary lender display-name alias consistently and remove stale conditional/name-part output.

### Implementation steps
1. **Rewrite the RE870 INVESTOR table structurally**
   - Locate the table containing both `INVESTOR NAME` and `CO-INVESTOR NAME`.
   - Identify the exact row/cells around the investor header/name area.
   - Rebuild only that row/cell group so the left cell is the actual investor-name cell and contains exactly:
     - Paragraph 1: `INVESTOR NAME:`
     - Paragraph 2: the requested lender loop
   - Preserve the rest of the table and document unchanged.

2. **Remove visual causes of the misplaced output**
   - Remove/avoid `w:gridSpan="2"` on the rebuilt left investor-name cell when it causes the left cell to span into the center column.
   - Use left-aligned paragraph properties for the investor-name label/value paragraphs instead of inheriting centered header styling.
   - Ensure any center header cell remains header-only (`INVESTOR`) and never contains lender loop text.

3. **Use the requested loop expression**
   - Set the investor-name value paragraph to:
   ```text
   {{#each lenders}}{{#if isIndividual}}{{firstName}}{{#if middle}} {{middle}}{{/if}} {{last}}{{else}}{{vesting}}{{/if}}{{/each}}
   ```
   - This matches the requested template structure while still relying on the existing per-lender `isIndividual`, `firstName`, `middle`, `last`, and `vesting` data.

4. **Fix NAME OF PERSON COMPLETING**
   - Replace conditional/name-part output with primary lender display name only:
   ```text
   NAME OF PERSON COMPLETING THIS QUESTIONNAIRE
   {{ld_p_displayName}}
   ```
   - Strip stale `firstName`, `middle`, `last`, `vesting`, and `isIndividual` template fragments from that cell.

5. **Add regression coverage**
   - Extend the RE870 rewrite test fixture to include a row where `INVESTOR NAME` has `gridSpan="2"` and centered styling.
   - Assert that after rewrite:
     - the center `INVESTOR` header cell has no lender loop,
     - the left `INVESTOR NAME:` cell has the loop in paragraph 2,
     - `NAME OF PERSON COMPLETING` uses display name only.

6. **Deploy and validate against live templates**
   - Deploy `rewrite-re870-multi-lender`.
   - Run it with `force: true` for the three RE870 templates.
   - Re-run debug inspection to confirm the template XML structure, including cell widths/spans and loop placement.
   - Confirm generated-document logs no longer show the old misplaced-loop behavior.
## Plan

1. **Confirm the per-property data path is already indexed correctly**
   - Verify the existing publisher continues to produce these booleans per property and slot:
     - `pr_li_rem_balloonYes_{property}_{slot}`
     - `pr_li_rem_balloonNo_{property}_{slot}`
     - `pr_li_rem_balloonUnknown_{property}_{slot}`
     - `pr_li_ant_balloonYes_{property}_{slot}`
     - `pr_li_ant_balloonNo_{property}_{slot}`
     - `pr_li_ant_balloonUnknown_{property}_{slot}`
   - Keep the current default behavior: if neither YES nor NO is true, resolve to UNKNOWN.

2. **Fix the actual rendering failure for cloned Property 2–5 sections**
   - The current SDT-aware balloon checkbox sub-pass queues replacements for `<w:sdt>...</w:sdt>` checkbox controls, but the shared edit safety gate only allows replacements for `<w:r>` or `<w:t>` fragments.
   - As a result, the queued SDT checkbox replacements for Properties 2–5 can be dropped as “unsafe,” leaving all boxes unchecked.
   - Update the RE851D post-render edit safety gate to allow whole `<w:sdt>...</w:sdt>` replacements when the fragment contains a Word checkbox control (`<w14:checkbox>`).
   - Scope this only to the existing RE851D encumbrance post-render pass.

3. **Strengthen the SDT checkbox rewrite**
   - Ensure each YES / NO / UNKNOWN SDT is paired with the nearest visible label in the current `BALLOON PAYMENT?` window, not with Property 1 or another slot.
   - Force both representations in sync:
     - `<w14:checked w14:val="1|0"/>`
     - the visible inner checkbox glyph inside `<w:sdtContent>`
   - Preserve the existing bare-glyph fallback path so Property 1 behavior does not regress.

4. **Validate loop/index behavior for both encumbrance sections**
   - Confirm the pass iterates each detected property region (`region.k`) and each slot (`bSlot = 1..2`) for:
     - `ENCUMBRANCE(S) REMAINING`
     - `ENCUMBRANCE(S) EXPECTED OR ANTICIPATED`
   - Confirm no hardcoded Property 1 keys are used in the checkbox forcing logic.

5. **Deploy and verify with loan file `DL-2026-0250`**
   - Redeploy the `generate-document` function.
   - Regenerate RE851D for `DL-2026-0250`.
   - Check Preview and final PDF output confirm exactly one of YES / NO / UNKNOWN is checked for every visible encumbrance record on Properties 1–5.
   - Confirm no layout shifts, extra paragraphs, duplicate values, or malformed checkbox artifacts are introduced.
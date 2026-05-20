## Goal

In `supabase/functions/generate-document/index.ts`, fix the RE851D BALLOON PAYMENT? YES / NO / UNKNOWN checkbox forcing so it works for Properties 2–5 in both the ENCUMBRANCE(S) REMAINING and ENCUMBRANCE(S) EXPECTED OR ANTICIPATED sections. Validated against deal `DL-2026-0250`, whose REM Property 4 / Property 5 cells and ANT Property 1 / Property 2 cells currently render with all three options unchecked even though `balloon_amount` values (600, 800, 111, 444) populate correctly.

## Root cause

The per-property/per-slot balloon state is already published correctly upstream (lines 4158–4164: `pr_li_rem_balloonYes_<N>_<S>` / `_balloonNo_…` / `_balloonUnknown_…`), and the post-render value publisher around lines 9830–9905 successfully writes `priority`, `beneficiary`, `originalAmount`, `principalBalance`, `monthlyPayment`, `maturityDate`, and `balloonAmount` into the cloned cells for every property — proving the per-region (`region.k`) iteration and the lookup keys are sound.

The defect lives strictly in the BALLOON YES / NO / UNKNOWN glyph pass at lines 9908–10046:

- The pass walks each property region, anchors on `BALLOON PAYMENT?`, then scans the following window for **bare checkbox glyph runs** (`[\u2610\u2611\u2612]`) and **unresolved Handlebars runs** referencing `pr_li_(rem|ant)_balloon(Yes|No|Unknown)`.
- It explicitly skips anything `insideExistingSdt(...)` (lines 9947–9954, 9957, 9962) to avoid corrupting native Word checkbox content controls.
- For Property 1 the template ships with bare glyph runs (or unresolved Handlebars runs) for those three options, so the anchor‑aligned `inserts` flow forces them to ☑ / ☐ correctly.
- For Properties 2–5 the cloner at ~line 6967 duplicates Property 1's encumbrance block **after** earlier RE851D passes (e.g. the Property-Type SDT promotion around lines 8431–8673, the 60-day / encumbrance-of-record SDT updaters around 8948–9320) have already promoted some of those bare glyph runs into `<w:sdt><w14:checkbox>…</w14:checkbox></w:sdt>` controls with intrinsic `<w14:checked w14:val="0"/>` state. The cloned blocks therefore arrive at the balloon pass as **all-SDT** cells, every candidate is filtered out by `insideExistingSdt`, and the per-region forcing becomes a no-op — leaving YES / NO / UNKNOWN all unchecked.

The ANT side fails for Property 1 too because the cloner-fed ANT block in the ANT section of Property 1 was itself sourced from a cell that had already been SDT-promoted by an earlier pass.

## Changes (scoped to the balloon pass inside `supabase/functions/generate-document/index.ts` lines 9908–10046)

All edits stay strictly inside the existing `for (let bSlot = 1; bSlot <= 2; bSlot++)` loop and its `region` scope — no new top-level passes, no schema changes, no template changes, no UI changes. Mirrors the SDT-aware pattern already in use at lines 7177–7196, 7810–7825, 8948–8970, 9135–9160, and 9308–9325.

### 1. Add a SDT-checkbox sub-pass alongside the existing glyph / handlebars pass

After computing `yesK / noK / unkK / isYes / isNo / isUnk / winner` (lines 9921–9933), and **before** the existing glyph/handlebars hit collection (line 9942), add an SDT-first sub-pass scoped to the same `[rawWinStart, rawWinEnd]` window:

- Match every `<w:sdt …>…<w14:checkbox>…</w:sdt>` block whose raw start position falls inside the window using the same `sdtCheckboxRe` regex used by the other RE851D safety passes (`/<w:sdt\b[^>]*>[\s\S]*?<w14:checkbox\b[\s\S]*?<\/w:sdt>/g`).
- For each SDT, find the *visible label that immediately follows it* (`YES` / `NO` / `UNKNOWN`) using the same `txt` projection + `map[]` already in scope; pair the SDT with that label.
- Keep only the first SDT for each of the three labels (closest to BALLOON PAYMENT?, dedup mirrors lines 9981–9986).
- For each paired (SDT, label) write a single `inserts` entry that replaces the SDT block in place with the same block but with `<w14:checked w14:val="X"/>` forced (`X = 1` when `label === winner`, else `0`). When the SDT lacks any `<w14:checked …/>`, inject one immediately after `<w14:checkbox …>` exactly as lines 7373–7374, 8632–8635, and 9318 do; when it has one, swap its `w14:val` using the same regex as lines 7186, 7819, 8957, 9144, 9318.
- Also force the *inner* `<w:sdtContent><w:r>…<w:t>…</w:t>…</w:r></w:sdtContent>` glyph to ☒ (`\u2612`) when checked, else ☐ (`\u2610`), so PDF renderers that ignore `<w14:checked>` still display the correct mark in Preview mode and final PDF output. This mirrors the inner-glyph normalization already applied by the encumbrance-of-record / 60-day passes.
- If any SDT in the window was matched, **skip the existing glyph / handlebars `labelAnchors` path** for this `bSlot` (return `continue`) so the two sub-passes do not race for the same option and produce double ☑ / leftover ☐ artifacts. When no SDT matches, fall through to the existing bare-glyph / Handlebars logic unchanged — preserving Property 1's working path.

### 2. Mark cloned-region SDTs distinguishable from Property 1's SDTs (defensive)

The cloner at ~line 7053 already gives the cloned PROPERTY INFORMATION anchor a fresh paragraph; the SDT `<w:id w:val="…">` values are namespaced per property index in the cloner's existing ID-rewriting step. Verify (no edit required if already true) that each cloned BALLOON PAYMENT? SDT still has a unique `<w:id>` so the per-region replacement pass at lines 9787–10046 cannot collide between regions during the rezip phase. If a collision is found, extend the cloner's existing `<w:id>` rewrite list (already enumerating `w:bookmarkStart/End`, `w:commentRangeStart/End`, `w14:checkbox` parents) to also stamp a `_${i}` suffix on the SDT ids in the encumbrance subtree — no behavior change for Property 1.

### 3. Keep the defensive Handlebars-token scrub at lines 10048–10120 untouched

That scrub already runs per region and removes any `{{pr_li_(rem|ant)_balloon…}}` literals leaked into visible text; the SDT-first sub-pass above writes only inside `<w:sdt>` blocks and never produces visible Handlebars text, so the scrub remains correct as-is.

### 4. Logging

Extend the existing `debugLog(\`[generate-document] RE851D enc post-render P${region.k} … balloon=…\`)` line at 10043 to also report which sub-pass actually forced the state (`mode=sdt` vs `mode=glyph`) and how many SDTs were touched. Use the same `debugLog` helper already in scope so production output stays gated.

## Verification

After edits, generate RE851D for deal `DL-2026-0250` and confirm:

- ENCUMBRANCE(S) REMAINING — for Properties 1–5, the BALLOON PAYMENT? row shows exactly one of ☑ YES / ☑ NO / ☑ UNKNOWN matching the lien's stored `balloon` value (or ☑ UNKNOWN when blank).
- ENCUMBRANCE(S) EXPECTED OR ANTICIPATED — same expectation per property.
- Property 1's existing behavior is preserved (no glyph regression in either section).
- `balloon_amount` cells (600, 800, 111, 444 in the user's screenshot) continue to render in the IF YES, AMOUNT cell only when YES is the winner.
- Both Preview mode and the final PDF render the same checkbox states (the inner ☐/☒ glyph + `<w14:checked>` are kept in sync).
- No layout regression: no extra paragraphs, no extra cells, no shifted column widths in either ENCUMBRANCE table.

No UI, schema, template, or other-template changes. Strictly additive edits inside the RE851D-scoped balloon publisher.

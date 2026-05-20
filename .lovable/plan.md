
## Goal

Make every BALLOON PAYMENT? row in RE851D render exactly one ☑ / ☐ / ☐ across YES / NO / UNKNOWN — including Properties 2–5 in both ENCUMBRANCE(S) REMAINING and ENCUMBRANCE(S) EXPECTED OR ANTICIPATED — for deal `DL-2026-0250`, matching Property 1's working behavior.

## Root cause

The current balloon publisher in `supabase/functions/generate-document/index.ts` (lines 9908–10135) is built around two strategies, both *reactive*:

1. Find existing bare `[☐☑☒]` glyph runs (or unresolved `{{…balloon…}}` Handlebars runs) and rewrite them.
2. Find existing `<w:sdt><w14:checkbox>…</w:sdt>` controls (added by the prior fix) and force `<w14:checked>` + inner glyph.

The cloner at line 6967 duplicates Property 1's lien-detail slice *after* Handlebars rendering but *before* the balloon publisher runs. The user-supplied screenshots show that in Properties 2–5 the cloned BALLOON PAYMENT? cells arrive with **neither** a bare glyph run **nor** an SDT checkbox in front of the YES / NO / UNKNOWN labels — just plain text. Both strategies therefore find zero candidates and leave the row visually empty (no ☑, no ☐), while Property 1 works because the original template path produced glyph runs there.

There is no reliable way to retroactively reconstruct which authoring shape was lost during cloning + earlier RE851D passes, so the publisher must stop assuming a candidate exists.

## Fix

All edits scoped to the existing per-region `for (let bSlot = 1; bSlot <= 2; bSlot++)` loop inside the balloon pass at lines 9908–10135. No UI, schema, template, cloner, or other-template changes.

### 1. Add a deterministic "inject glyph before each label" fallback (third sub-pass)

After the existing SDT sub-pass (lines 9944–10021) and the existing glyph/Handlebars `labelAnchors` pass (lines 10056–10131), add a third sub-pass with this contract: **after the first two passes run, for each of YES / NO / UNKNOWN, verify that a checkbox glyph (☐/☑/☒) exists in the raw XML in the small window immediately before that label. If none exists, queue an `inserts` entry that injects a fresh glyph run (`☑` for the winner, `☐` for the other two) immediately before the label's `<w:r>…<w:t>…YES…</w:t>…</w:r>` run.**

Implementation specifics:

- Reuse the already-computed `dedupedAnchors` (YES/NO/UNKNOWN positions in `txt` / raw XML) and `winner`.
- For each anchor, locate the enclosing `<w:r>` opening tag immediately before `anchor.rawIdx` (use `xml.lastIndexOf("<w:r", anchor.rawIdx)` and validate it's followed by `>` or ` `).
- Define a "candidate-present" check: scan `xml.slice(prevRawBoundary, runOpenStart)` for either `[\u2610\u2611\u2612]` or a `<w14:checkbox` tag. If found, skip — the earlier passes already handled this slot.
- If absent, build a small injection run using the same font/size profile already in use at line 10085:
  `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${glyph} </w:t></w:r>`
  followed by a non-breaking single space so the rendered output reads `☑ YES`.
- Queue it as `inserts.push({ at: -runOpenStart, html: `${injection}|||INSERT_BEFORE|||${runOpenStart}` })` using the existing inserts queue. If the queue's apply step does not already support an `INSERT_BEFORE` marker, extend the apply step (search for the `|||REPLACE|||` handling) to also recognize `|||INSERT_BEFORE|||` and splice without consuming characters.
- Skip injection when the SDT sub-pass already handled this `bSlot` (i.e. inside the existing `continue` branch at line 10018).

### 2. Idempotency + safety

- The candidate-present check guarantees this pass is a no-op for Property 1 and any other cell that already has a glyph or SDT in place — no double ☑.
- The injection is scoped strictly to the `[prevRawBoundary, labelRawAbs]` window, so it cannot leak into adjacent cells.
- Maintain `prevRawBoundary = labelRawAbs` between anchors so each YES/NO/UNKNOWN gets at most one injection.

### 3. Inserts-queue extension (if needed)

Search the inserts-apply code (downstream of this pass, the same site that already processes `|||REPLACE|||sortedByOffset` entries) and add a second marker `|||INSERT_BEFORE|||<absStart>` that splices `html` at `absStart` without deleting any characters. This preserves all existing `|||REPLACE|||` semantics.

### 4. Logging

Extend the existing `debugLog` at line 10132 to also report the third pass:
`mode=sdt|glyph|inject injected=<N>`.

## Verification

After deploy, regenerate RE851D for `DL-2026-0250` and confirm:

- ENCUMBRANCE(S) REMAINING — Properties 1–5 each show exactly one ☑ of YES / NO / UNKNOWN matching the stored balloon value (or ☑ UNKNOWN when blank/null per existing business rule).
- ENCUMBRANCE(S) EXPECTED OR ANTICIPATED — same expectation per property.
- Property 1's existing rendering is unchanged (no double ☑, no extra ☐).
- `IF YES, AMOUNT` cell continues to render `balloon_amount` only when YES is the winner — untouched by this fix.
- Preview mode and final PDF render identically.
- No layout regression: no extra paragraphs added outside the BALLOON PAYMENT? cell, no shifted columns.

## Scope guardrails

- Strictly inside lines 9908–10135 of `supabase/functions/generate-document/index.ts` plus the inserts-apply marker addition (if not already present).
- No edits to: the cloner (line 6967), the per-property value publisher (lines 9787–9905), the defensive Handlebars scrub (lines 10137+), the SDT-promotion passes, the field dictionary, the template, the UI, or any other document type.
- No new top-level passes, no new files.

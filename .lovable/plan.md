# Fix Multi-Lender Signature Blocks (Universal Solution)

## Where the logic lives today

All lender signature rendering currently flows through one place:
`supabase/functions/generate-document/index.ts` lines **7687–7803** — the
"AUTO-APPEND ADDITIONAL LENDER SIGNATURE BLOCKS" pass that runs after every
DOCX render, for every template.

This will be hardened into the single source of truth for lender signature
blocks. No per-template branches will be added.

## Problems found

1. **Label** — emits `ADDITIONAL LENDER {a}:` (line 7767) where `a` starts at 1
   for lenders 2..N, so primary lender keeps the template's original label and
   extras are numbered from 1 with the "ADDITIONAL" prefix.
2. **Skipped lenders** — skip-detection (line 7708) bails out whenever the
   rendered XML contains the literal text `ADDITIONAL LENDER 1/2/3` *anywhere*
   (boilerplate, footers, "Additional Lender Information" headings, prior
   appends, etc.). When it matches, **zero** extra blocks are appended and the
   document looks fine for 2 lenders but silently drops 3..N.
3. **Extra fields** — `Entity Name:` / `Print Name:` lines (7762–7763, 7773)
   add noise the spec wants removed.
4. **No validation / no per-lender logging** — only a single aggregate log line
   exists; missing names fail silently.

## Changes (all inside the existing block in `generate-document/index.ts`)

### A. Replace the skip-detection heuristic
Instead of matching the loose phrase `ADDITIONAL LENDER \d`, count actual
rendered signature blocks (any of: `Lender\s+\d+\s*:`,
`ADDITIONAL\s+LENDER\s+\d+\s*:`, or template-emitted
`{{additionalLenders…}}` artifacts that survived). If the count of detected
blocks is `>= lenderCount - 1`, skip; otherwise append the **missing** ones
only. This guarantees:
- Templates with a full hard-coded repeater → no double append.
- Templates that hard-code only lender 2 → lenders 3..N get appended.
- Boilerplate text mentioning "Additional Lender" never blocks the append.

### B. New universal signature block format
For each missing lender index `i` (mapped to `Lender ${i+1}:` so primary stays
Lender 1 and appended start at Lender 2):

```
Lender {N}:                            (bold)
{displayName or full name or vesting}
Signature: ____________________     Date: ______________
```

Removed: the `hr()` divider, `Entity Name:` line, `Print Name:` line, and the
extra blank paragraphs. Spacing tightened to one blank paragraph between
blocks (small gap after label, single blank before next lender) per the spec.

### C. Validation gate (pre-append)
Before generating blocks, validate the lender array shape using existing
`fieldValues` aliases:
- `lender_count` is an integer ≥ 1.
- For each `i` in `1..lenderCount-1`, `additionalLenders{i}.displayName` (or
  computed first/middle/last/vesting fallback) is non-empty.

On failure: log a structured warning that includes template name
(`templateName` is already in scope), the offending index, and the reason,
then **skip only the invalid lender** (do not abort the whole document — keeps
existing single-lender templates safe). A second warning is logged summarizing
how many were skipped so QA sees it.

### D. Structured logging
Add `console.log` lines (gated on existing `debugLog` where applicable):
- `lenders.received = {lenderCount}`
- `lenders.alreadyRendered = {detectedCount}`
- `lenders.appended = {appendedCount}`
- `lenders.skippedInvalid = [{index, reason}, ...]`
- `template = {templateName}`

### E. Templates affected
The six templates listed (Investor Acknowledgement, Investor Questionnaire,
Lender Identification Form, Lender Placed Insurance Disclosure, Multiple
Lender Testing, re870) all flow through this same post-render pass — no
template files need editing. They automatically pick up the new format.

If any of those templates currently hard-code an `ADDITIONAL LENDER 1:` block
for lender 2, the new detector will see it and not double-append; the
hard-coded label text itself is template content and out of scope of this
backend change. (If the user wants those hard-coded labels rewritten to
`Lender 2:`, that is a template-file edit and would be a follow-up.)

## Out of scope (per "do not modify" directive)
- Database schema, field_dictionary, RLS, save APIs.
- Template .docx files in storage.
- Primary lender's existing signature block (rendered by each template).
- Any other post-render pass (RE851D, RE885, encumbrance pipeline, etc.).

## Files touched
- `supabase/functions/generate-document/index.ts` — only the block at
  lines 7687–7803 is rewritten in place. No other code paths change.

## Acceptance check (manual, after deploy)
1. Generate Investor Acknowledgement with 1, 3, and 10 lenders → expect
   1 / 3 / 10 signature blocks, labeled `Lender 1..N:` (primary keeps
   template label, extras `Lender 2..N:`).
2. Verify no `ADDITIONAL LENDER`, `Entity Name`, or `Print Name` text remains
   in appended blocks.
3. Check edge function logs show `lenders.received` / `lenders.appended`
   matching the input count.

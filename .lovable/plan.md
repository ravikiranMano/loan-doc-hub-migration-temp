## Goal

In `supabase/functions/generate-document/index.ts`, fix RE851D so the ENCUMBRANCE(S) REMAINING and ENCUMBRANCE(S) EXPECTED OR ANTICIPATED grids correctly populate INTEREST RATE, MATURITY DATE, and BALLOON PAYMENT (YES/NO/UNKNOWN + amount) for Properties 2, 3, 4, and 5 — not just Property 1. Validated against deal `DL-2026-0250`, which has liens correctly assigned to `property1..property5` with interest_rate / maturity_date / balloon / balloon_amount populated.

## Root cause

The RE851D template's encumbrance value cells contain only static labels; values come from the post-render **label-anchored encumbrance publisher** at `index.ts` ~lines 9640–10213. The earlier **multi-property cloner** (~line 6967) duplicates Property 1's label-only block for properties 2..K and the publisher then walks each `PROPERTY INFORMATION` region and writes per-property/per-slot values from already-published `pr_li_(rem|ant)_<field>_<K>_<S>` keys.

Three defects break that flow for Properties 2–5:

1. **`INTEREST RATE` is missing from the `ENC_LABELS` list** (~lines 9676–9685). Without an entry mapping the visible `INTEREST RATE` cell label to the `interestRate` value suffix, the publisher never appends an interest-rate paragraph into any property region — Property 1 only renders correctly via a Property-1-specific fallback that does not propagate when the block is cloned.

2. **`fmtVal` date formatting**: the in-render publisher emits `maturityDate` with dataType `"date"` (raw `yyyy-MM-dd` from the DB, e.g. `2026-08-05`). `formatByDataType(..., "date", ...)` must return `MM/DD/YYYY`; for Properties 2–5 cells the appended paragraph currently renders the raw ISO string or blank when the value is null. Need to confirm and, if needed, route through the same MM/DD/YYYY formatter Property 1 uses.

3. **BALLOON PAYMENT glyph pass** (~line 9899) keys off `${tagPrefix}_balloonYes/No/Unknown_${region.k}_${bSlot}`. The in-render publisher already emits these keys per pIdx/slot, but the BALLOON PAYMENT? anchor scan uses a stateful `RegExp` with `lastIndex` set only once per section; verify it correctly advances to the per-property anchor and that `cellAlreadyPopulated` is not short-circuiting the `IF YES, AMOUNT` insertion for Properties 2–5 (Property 1's block — once mutated by an earlier safety pass before clone — would carry over its rendered amount into cloned regions and block the per-property insert).

## Changes (scoped to `supabase/functions/generate-document/index.ts`)

### 1. Add INTEREST RATE to ENC_LABELS
At line 9676–9685, add:
```ts
{ rx: /\bINTEREST\s+RATE\b/i, suffix: "interestRate" },
```
positioned after `PRIORITY` and before `BENEFICIARY`. This makes the per-property publisher emit an interest-rate paragraph into each label cell for slots 1 and 2 in both REM and ANT sections, using the already-published `pr_li_rem_interestRate_<K>_<S>` / `pr_li_ant_interestRate_<K>_<S>` values. `fmtVal` already strips the trailing `%` so the cell's static `%` glyph is preserved.

### 2. Guarantee MM/DD/YYYY for maturityDate cell inserts
In `fmtVal` (~line 9656), for dataType `"date"`, force MM/DD/YYYY output regardless of upstream formatter behavior — e.g. when `formatByDataType` returns an ISO `yyyy-MM-dd` (the value stored in DB), convert to `MM/DD/YYYY` before returning. Strictly local to this RE851D publisher's helper; no impact on other templates or other date fields.

### 3. Per-property safety for cloned blocks (BALLOON + value cells)
The clone pass (~line 6967) copies Property 1's block before this publisher runs. If any earlier RE851D safety pass mutated Property 1's value cells before cloning (e.g. inline-prose insertion), `cellAlreadyPopulated` would return true for the cloned cells in Properties 2–5 and the per-property value would be skipped. Add a per-property override path:

- For each region with `region.k >= 2`, when computing `cellAlreadyPopulated`, **also strip out any text that matches Property 1's published value** (`pr_li_(rem|ant)_<suffix>_1_<slot>`). If, after that strip, the cell still looks empty (label only), continue with the insert. This lets the per-property `_K_S` value override Property-1 carry-over from the clone.

- Apply the same per-region override to the BALLOON glyph pass: when `region.k >= 2`, force the Y/N/U glyph triple from `_K_<bSlot>` even if the cloned cell already carries Property 1's forced glyphs (currently the glyph pass replaces glyph runs without skipping — verify and, if a guard exists, scope it to `k=1`).

### 4. Verification

After edits, generate RE851D for deal `DL-2026-0250` and confirm:
- Property 1: unchanged behavior (interest rate, maturity date, balloon Y/N/U still render correctly).
- Properties 2–5: each ENCUMBRANCE row shows that property's own interest rate (`%`-suffixed), maturity date (`MM/DD/YYYY`), balloon Y/N/U checkbox, and balloon amount.
- Both REMAINING and EXPECTED/ANTICIPATED sections populate per property.
- Empty data on a slot leaves the cell blank without breaking layout.

No UI, schema, template, or other field changes. Strictly additive edits inside the RE851D-scoped publisher.
## Goal

Make RE851D PART 1 totals work for any number of properties (N), with no hardcoded indexes.

All edits stay inside `supabase/functions/generate-document/index.ts`. No UI, no schema, no new edge functions.

## Current state

- `ln_p_amountOfEquity_${pi}` is already emitted dynamically inside the per-property loop at line 3467, but the value is computed as `Market Value − Total Senior Encumbrances`. The user's new spec says it must be sourced from the property's `pledgedEquity` field directly.
- `pr_p_pledgedEquity_${idx}` is already bridged per property at line 1358 from `propertyN.pledged_equity` / `propertyN.pledgedEquity`.
- `ln_totalEquitySecuringLoan` and `ln_totalLoanAmountSecured` are not emitted anywhere today.
- The per-property rollup loop already iterates `propIdxSet` (every CSR-known property), so dynamic N is already supported once we attach the new emission to that loop.

## Changes

### 1. Per-property: `ln_p_amountOfEquity_N` from pledgedEquity (lines ~3504–3527)

Replace the `mv - tot` equity formula with a strict read from the property's pledged equity. LTV stays on `tot/mv*100` (separate spec, untouched).

```
const pledgedRaw =
  fieldValues.get(`pr_p_pledgedEquity_${pi}`)?.rawValue ??
  fieldValues.get(`property${pi}.pledged_equity`)?.rawValue ??
  fieldValues.get(`property${pi}.pledgedEquity`)?.rawValue;

let equityNum = 0;
let equityStr = "";
if (pledgedRaw !== null && pledgedRaw !== undefined && String(pledgedRaw).trim() !== "") {
  equityNum = parseAmt2(pledgedRaw);
  equityStr = equityNum.toFixed(2);
}
// Always emit the per-property equity tag so {{ln_p_amountOfEquity_N}} renders
// "0.00" when pledgedEquity is missing rather than leaving the cell blank.
fieldValues.set(`ln_p_amountOfEquity_${pi}`, {
  rawValue: equityStr || "0.00",
  dataType: "currency",
});
```

LTV block (lines 3518–3526) keeps using `mv`/`tot` exactly as today.

### 2. Totals after the loop (insert after line 3533)

Sum equity across all properties and publish the loan amount total. Both keys are scalar (no `_N`).

```
let totalEquity = 0;
for (const pi of propIdxSet) {
  const v = fieldValues.get(`ln_p_amountOfEquity_${pi}`)?.rawValue;
  if (v !== undefined && v !== null && String(v).trim() !== "") {
    totalEquity += parseAmt2(v);
  }
}
fieldValues.set("ln_totalEquitySecuringLoan", {
  rawValue: totalEquity.toFixed(2),
  dataType: "currency",
});

const loanAmtTotal = Number.isFinite(loanAmtRollup) ? loanAmtRollup : 0;
fieldValues.set("ln_totalLoanAmountSecured", {
  rawValue: loanAmtTotal.toFixed(2),
  dataType: "currency",
});

debugLog(
  `[generate-document] RE851D Part1 totals: properties=${propIdxSet.size}, ` +
  `totalEquity=${totalEquity.toFixed(2)}, totalLoanSecured=${loanAmtTotal.toFixed(2)}`
);
```

### 3. Anti-fallback shield

Add `ln_totalEquitySecuringLoan` and `ln_totalLoanAmountSecured` to the bare-key safe list around line 5202 so they don't pick up an arbitrary fallback value if upstream code ever sets a same-named alias. `ln_p_amountOfEquity_N` is already in the per-N safe list (lines 3949 / 4082 / 4106) — no change needed there.

### 4. No changes to template expansion

The template already uses `{{ln_p_amountOfEquity_N}}` inside a per-property repeated row. The existing `_N` expansion driven by `propIdxSet` covers any N. No new expansion logic required.

## Verification

- Re-run end-to-end generate against a deal with 1, 2, and 3 properties.
- In `edge_function_logs`, confirm the new `RE851D Part1 totals` line shows the expected sum.
- In the rendered docx confirm:
  - Each `{{ln_p_amountOfEquity_N}}` matches that property's pledged equity (or `0.00`).
  - `{{ln_totalEquitySecuringLoan}}` equals the sum.
  - `{{ln_totalLoanAmountSecured}}` equals `ln_p_loanAmount`.

## Out of scope

UI, schema, Part 2 logic, LTV formula, lien rollup, template authoring.

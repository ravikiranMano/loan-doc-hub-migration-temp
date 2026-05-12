## Root cause

In `supabase/functions/generate-document/index.ts` (around lines 3505–3520), both `ln_p_amountOfEquity_${pi}` and `ln_p_equitySecuringLoan_${pi}` are assigned the same value derived from `pr_p_pledgedEquity_${pi}`. This is why the two PART 1 columns render identical numbers.

Per spec:
- `{{ln_p_amountOfEquity_N}}` must be **calculated**: `Market Value − Total Senior Encumbrances`, clamped to `0` when negative.
- `{{ln_p_equitySecuringLoan_N}}` must be the **direct pledged equity** value from Property → Valuation.

## Fix (additive, scoped to one block)

**File:** `supabase/functions/generate-document/index.ts`
**Block:** the per-property publisher inside the RE851D Part 1 rollup loop (lines ~3505–3520).

1. Move the existing Market Value lookup (`mvRaw` → `mv = parseAmt2(mvRaw)`) earlier so it is available before the equity assignments. The LTV computation below continues to use the same `mv`.
2. Compute `amountOfEquityStr`:
   - If `mvRaw` is present: `amt = max(0, mv − tot)` → `amt.toFixed(2)`.
   - Else: fallback to `"0.00"` (preserves current "always emit" behavior so the cell never renders blank).
3. Compute `pledgedEquityStr` from the existing pledged-equity lookup chain (`pr_p_pledgedEquity_${pi}` → `property${pi}.pledged_equity` → `property${pi}.pledgedEquity`), defaulting to `"0.00"`.
4. Assign:
   - `fieldValues.set("ln_p_amountOfEquity_${pi}", { rawValue: amountOfEquityStr, dataType: "currency" });`
   - `fieldValues.set("ln_p_equitySecuringLoan_${pi}", { rawValue: pledgedEquityStr, dataType: "currency" });`
5. Update the debug log to print both values (`amountOfEquity=…, pledgedEquity=…`).

No change to:
- Footer totals. `ln_totalEquitySecuringLoan` already prefers `ln_p_equitySecuringLoan_${pi}` (pledged equity sum), which remains correct.
- LTV calculation, MV lookup chain, or any other tag.
- `RE851D_INDEXED_TAGS`, `PART1_TAGS`, `PART2_TAGS` allowlists (both tags already registered).
- Templates, schema, UI, or formatting.

## Deploy & verify

1. Deploy `generate-document`.
2. Regenerate RE851D for the open deal:
   - Property 1: MV `250,000`, Total Senior Encumbrance `25,000`, Pledged `6,778` → Amount of Equity `225,000.00`, Equity Securing Loan `6,778.00`.
   - Property 2: MV `234`, Total Senior Encumbrance `24,654`, Pledged `23,432` → Amount of Equity `0.00` (negative clamped), Equity Securing Loan `23,432.00`.
3. Confirm the two columns now show distinct values per property and footer totals are unchanged.

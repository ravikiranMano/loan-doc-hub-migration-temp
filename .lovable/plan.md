## Fix: register `ln_p_equitySecuringLoan_N` in the RE851D region rewrite allowlist

### Root cause
The per-property publisher writes `ln_p_equitySecuringLoan_${pi}` correctly (we added that last turn), and the footer totals are wired. But RE851D uses a region-restricted `_N` → `_1/_2/...` template rewrite driven by two allowlists in `supabase/functions/generate-document/index.ts`:

- `PART1_TAGS` (~lines 4105–4126)
- `PART2_TAGS` (~lines 4127–4150)

`ln_p_amountOfEquity_N` is whitelisted; **`ln_p_equitySecuringLoan_N` is not**. So the literal `{{ln_p_equitySecuringLoan_N}}` in the template is never expanded into per-property tags and resolves to blank, regardless of the publish step.

### Change (additive only)
**File:** `supabase/functions/generate-document/index.ts`

Add the new tag to both allowlists alongside `ln_p_amountOfEquity_N`:

- In `PART1_TAGS` (after line 4113):
  ```ts
  "ln_p_equitySecuringLoan_N",
  ```
- In `PART2_TAGS` (after line 4137):
  ```ts
  "ln_p_equitySecuringLoan_N",
  ```

No other code, schema, or template changes. Footer keys (`ln_totalEquitySecuringLoan`, `ln_totalLoanAmountSecured`) are non-`_N` and don't need allowlist entries.

### Deploy & verify
1. Deploy `generate-document`.
2. Regenerate RE851D for the open deal (2 properties, pledged 23,432 and 6,778).
3. Confirm:
   - Property 1 "Amount of Equity Securing the Loan" = `23,432.00`
   - Property 2 = `6,778.00`
   - Footer totals already populating (per prior fix).
4. Check log line `[generate-document] RE851D Part1 rollup property{N}: ... pledgedEquity=...` to confirm publish, and inspect that the literal `{{ln_p_equitySecuringLoan_N}}` no longer appears in the output.

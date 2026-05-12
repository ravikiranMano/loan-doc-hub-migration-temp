## Root cause

`{{ln_p_equitySecuringLoan_N}}` is whitelisted in `PART1_TAGS` (line 4114) and `PART2_TAGS` (line 4139), but the rewrite scan that drives `_N → _K` expansion only iterates the master list `RE851D_INDEXED_TAGS` (built into `tagsByLengthDesc` at line 4619 of `supabase/functions/generate-document/index.ts`):

```ts
const tagsByLengthDesc = RE851D_INDEXED_TAGS
  .filter((t) => xml.includes(t))
  .sort((a, b) => b.length - a.length);
```

`RE851D_INDEXED_TAGS` (lines 3968–4097) contains `ln_p_amountOfEquity_N`, `ln_p_totalEncumbrance_N`, `ln_p_remainingEncumbrance_N`, etc., but **does not contain `ln_p_equitySecuringLoan_N`**. Result:

- The scanner never visits any `ln_p_equitySecuringLoan_N` occurrence in the XML.
- No rewrite is generated for it, so the literal `{{ln_p_equitySecuringLoan_N}}` survives into the final tag-resolution pass.
- The resolver has no value for the literal `_N` key (only `_1`, `_2`, … were published by the publisher at line 3518), so the cell renders blank.

The PART1_TAGS/PART2_TAGS allowlist only acts as a region filter *after* a candidate match is found — it cannot enable a tag that was never scanned. This explains why the prior fix (adding to PART1_TAGS/PART2_TAGS) did not change behavior, while sibling tags like `ln_p_amountOfEquity_N` work correctly because they are members of the master list.

The footer totals (`ln_totalEquitySecuringLoan`, `ln_totalLoanAmountSecured`) populate fine because they are non-`_N` tags that bypass this rewrite path entirely.

## Fix (additive, single line)

**File:** `supabase/functions/generate-document/index.ts`

Add `ln_p_equitySecuringLoan_N` to `RE851D_INDEXED_TAGS` directly next to its sibling, on line 3980:

Change:
```ts
"ln_p_totalEncumbrance_N", "ln_p_totalWithLoan_N", "ln_p_amountOfEquity_N", "property_number_N",
```
to:
```ts
"ln_p_totalEncumbrance_N", "ln_p_totalWithLoan_N", "ln_p_amountOfEquity_N", "ln_p_equitySecuringLoan_N", "property_number_N",
```

No other change needed:
- PART1_TAGS / PART2_TAGS allowlist entries (lines 4114, 4139) stay as-is — they correctly scope the rewrite to PART 1 and PART 2 regions.
- Per-property publisher (line 3518) already emits `ln_p_equitySecuringLoan_${pi}` for each property.
- Footer wiring (line 3545) already reads from this key.
- No template, schema, UI, or formatting change.

## Deploy & verify

1. Deploy `generate-document`.
2. Regenerate RE851D for the open deal (2 properties, pledged equity 23,432 and 6,778).
3. Confirm:
   - PART 1 row 1 "Amount of Equity Securing the Loan" = `$23,432.00`
   - PART 1 row 2 = `$6,778.00`
   - Rows 3–5 remain blank (no property), as today.
   - PART 2 column populates identically.
   - Footer totals unchanged (already working).
4. Confirm the literal `{{ln_p_equitySecuringLoan_N}}` no longer appears anywhere in the rendered DOCX.

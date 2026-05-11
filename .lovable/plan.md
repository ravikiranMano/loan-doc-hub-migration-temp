## Goal

Publish per-property `ln_p_amountOfEquity_N` for RE851D Part 1 → "LOAN TO VALUE RATIO", computed as Market Value − Remaining Senior Encumbrances.

## Formula

```
ln_p_amountOfEquity_N = pr_p_appraiseValue_N − ln_p_remainingEncumbrance_N
```

Both inputs are already published per property by the existing pipeline:
- `pr_p_appraiseValue_N` — from Property → Valuation → Estimate of Value (publisher around line 1351).
- `ln_p_remainingEncumbrance_N` — sum of senior liens with condition Will Remain / Remain‑Paydown, excluding payoffs (publisher at line 3298). Anticipated and junior contributions are NOT included here, satisfying the exclusion rules.

## Edge cases

- No senior liens → remaining is `0.00` → equity = market value.
- Missing market value → leave `ln_p_amountOfEquity_N` blank (do not emit a `0` that would mask a data gap).
- Negative equity (remaining > market) → emit the negative number as-is.

## Implementation (single file, minimal change)

`supabase/functions/generate-document/index.ts` — extend the existing per-property publish loop only. Do not refactor.

1. **Inside the existing `for (const pi of propIdxSet)` loop (lines 3290–3331)**, after the `pr_p_remainingEncumbrance_${pi}` set:

   - Read raw market value: `const mvRaw = fieldValues.get(\`pr_p_appraiseValue_${pi}\`)?.rawValue ?? fieldValues.get(\`property${pi}.appraise_value\`)?.rawValue;`
   - Parse with the existing `parseAmt2` helper already in scope.
   - If `mvRaw` is null/empty/undefined → do NOT set `ln_p_amountOfEquity_${pi}` (leave blank; SHIELD will default to empty).
   - Else compute `equity = mv − rem` and `fieldValues.set(\`ln_p_amountOfEquity_${pi}\`, { rawValue: equity.toFixed(2), dataType: "currency" })`.
   - Append to the existing console log line to include `equity=${...}`.

2. **Add to `SHIELD_BASES`** (around line 4973 group): `"ln_p_amountOfEquity"` (currency, no `_glyph`) so unmatched indices render blank instead of leaking the merge tag.

3. **Add to `RE851D_INDEXED_TAGS`** (the `_N` whitelist around lines 3874/3897/3738 — wherever the canonical RE851D indexed tag list lives; verify and add to all three lists where the sibling encumbrance keys appear): `"ln_p_amountOfEquity_N"`.

4. **Deploy** the `generate-document` edge function.

## Out of scope

- No UI, DB, `field_dictionary`, or `.docx` template changes.
- No change to how `pr_p_appraiseValue_N` or `ln_p_remainingEncumbrance_N` are computed.
- Junior liens, expected/anticipated, and total encumbrances are intentionally not used.

## Validation

Generate RE851D for a deal with:
- P1: market 100,000, one senior lien remain 30,000 → equity 70,000.00
- P2: market 200,000, no senior liens → equity 200,000.00
- P3: market 50,000, senior remain 80,000 → equity −30,000.00
- P4: market blank, senior remain 10,000 → equity blank

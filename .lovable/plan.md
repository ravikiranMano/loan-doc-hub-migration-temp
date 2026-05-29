## Context

The platform-wide precision/display contract you described is already implemented and codified in `mem://architecture/precision-and-percentage-contract`:

- **Storage** — `src/lib/precisionFormat.ts` + edge `supabase/functions/_shared/formatting.ts`
  - `roundPctForStorage` → 4dp string for percent/rate
  - `roundDollarForStorage` → 2dp string for dollars
  - All arithmetic uses `decimal.js` (no native float)
- **Display** — `formatPercentDisplay(value, max)` enforces min-2 / max-N decimals with trailing-zero suppression *beyond* the 2nd decimal, exactly matching every example in your spec (`10.0000 → 10.00`, `10.5000 → 10.50`, `10.8750 → 10.875`, `10.8756 → 10.8756`).
- **Category helpers** (already shipped):
  - `formatInterestRate` — max 3dp (Note/Default/Sold/Lender/Spread)
  - `formatProRata` — max 4dp (funding %, pct_owned, allocation %)
  - `formatLtv` / `formatRatio` — max 2dp (LTV/CLTV/Protective Equity)
  - `formatLateChargePct` — max 3dp
  - `formatCurrency` / `formatDollar` — exactly 2dp with `$` + commas
- **Category resolver** — `resolvePercentCategory(fieldKey)` + `formatPercentByFieldKey` route any field key to the right category. Mirrored verbatim in the edge formatter so docs/PDFs/exports render identically to the UI.
- **Allocations** — `allocateDollarsByPercentsWithReconciliation` already prevents penny mismatches in lender funding splits.

The vast majority of the codebase already routes through these helpers. What's needed is **closing the remaining gaps** where ad-hoc formatters bypass the contract. No schema / API / migration changes — storage is already 4dp.

## Gaps to fix (audit results)

1. **`src/lib/fieldValueResolver.ts` lines 341, 399** — `rateNum.toFixed(4).replace(/\.?0+$/, '')` and `pct.toFixed(4).replace(/\.?0+$/, '')` strip **all** trailing zeros, producing `10%` instead of `10.00%` (violates min-2dp rule). Replace with `formatRate(rateNum)` and `formatProRata(pct)` from `precisionFormat.ts`. This impacts `lender_N_rate` and `lender_N_pct_owned` merge tags surfaced to documents.

2. **`src/components/contacts/lender-detail/LenderPortfolio.tsx:137`** — `fmtPct = v => \`${v.toFixed(2)}%\`` (no smart-trim, no category awareness). Replace with `formatRatio` (column shows LTV / pct_owned ratios → 2dp).

3. **`src/components/contacts/broker-detail/BrokerPortfolio.tsx:97`** — same pattern, same fix.

4. **`src/components/deal/PropertiesTableView.tsx:212-217`** — local `formatPercentage` returns hard `0.00%` / `toFixed(2)`. Replace usage with `formatRatio` from `precisionFormat.ts` (column is LTV-style).

No other lingering bypassers were found in the rate/pct surface. The remaining `toFixed(2)` hits in the audit are all dollar-side (`LenderCharges`, `TrustLedger`, `RE885ProposedLoanTerms`, `AddFundingModal` totals) where 2dp is already the storage + display contract for currency.

## Out of scope

- No edits to storage precision (already 4dp).
- No edits to APIs / Supabase schema (`deal_section_values` stores raw 4dp strings end-to-end).
- No mass refactor of files already using the canonical helpers.
- No changes to document-generation templates — the edge `formatting.ts` mirror already follows the same rules.

## Verification

- Re-grep `toFixed(` after the change to confirm no surviving percent-side bypassers.
- Existing `src/lib/precisionFormat.test.ts` covers the formatter contract; run targeted tests.
- Spot-check Properties grid, Lender/Broker Portfolio grids, and a lender-loop merge tag in a generated document to confirm `10.00%`, `10.50%`, `10.875%`, `27.2727%` render exactly per spec.

## Files to edit

- `src/lib/fieldValueResolver.ts` — swap 2 inline formatters for `formatRate` / `formatProRata`.
- `src/components/contacts/lender-detail/LenderPortfolio.tsx` — swap `fmtPct` for `formatRatio`.
- `src/components/contacts/broker-detail/BrokerPortfolio.tsx` — swap `fmtPct` for `formatRatio`.
- `src/components/deal/PropertiesTableView.tsx` — swap local `formatPercentage` for `formatRatio`.
## Goal

Update LTV calculation in `PropertyDetailsForm.tsx` so:

- **Origination LTV** = `loan_terms.loan_amount` ÷ `property{N}.appraised_value` × 100 (keeps current dynamic recompute — confirmed).
- **Current LTV** = **latest `loan_history.principal_balance`** ÷ `property{N}.appraised_value` × 100 (replaces today's "sum of lien current_balance" source).
- All percentage storage/display follows the existing 4dp-store / smart-trim-display standard already shipped in `src/lib/precisionFormat.ts`.
- Inline validation message + skipped calc when Estimate of Value is 0/empty or balances are negative.

CLTV (sum of all liens ÷ Estimate of Value) is unchanged.

## Files to change

### 1. `src/components/deal/PropertyDetailsForm.tsx` (main change)

- Add a hook to read the **latest** `loan_history` row for `deal_id` and expose `currentPrincipalBalance: number | null`. Use existing supabase client; subscribe via `useEffect` keyed on `dealId` so it refreshes when ledger changes (lightweight `select principal_balance order by date_received desc, created_at desc limit 1`).
- Replace the existing **Current LTV** numerator (lines 92–105 + 116, 147–150):
  - Numerator switches from `liensCurrentBalanceTotal` to `currentPrincipalBalance` from servicing ledger.
  - Keep `liensCurrentBalanceTotal` only for the existing `property1.lien_current_balance` write and Protective Equity (those are not LTV).
- Add inline validation state for the LTV block:
  - If `estValue <= 0` → show small `text-destructive` line under Estimate of Value: "Estimate of Value must be greater than 0", skip Current LTV + Origination LTV writes.
  - If `loanAmount < 0` → inline error under Loan Amount mirror display, skip Origination LTV.
  - If `currentPrincipalBalance < 0` → inline error under Current Principal Balance display, skip Current LTV.
- Add a small read-only "Current Principal Balance" display row in the same LTV block so the operator sees what's driving Current LTV (formatted with `formatDollar`). No new editable field.
- Keep using `roundPctForStorage` (already 4dp) and `formatPercentByFieldKey` for display — no formatting changes required.

### 2. `src/components/deal/PropertyModal.tsx`

- The modal currently shows Current LTV / Origination LTV / CLTV as percent inputs. Make Current LTV display read-only (it now derives from servicing) and add a tooltip/help text "Live value — derived from servicing ledger". Keep manual entry available only if no servicing rows exist (graceful fallback).

### 3. No schema migration

`loan_history.principal_balance` already exists. No new dictionary entries (Origination LTV / Current LTV / CLTV are already registered).

### 4. No changes to

- `src/lib/precisionFormat.ts` — already implements the storage (4dp) + smart-trim display rule the spec asks for, and `formatRatio` covers LTV display (2dp, max 4dp via existing category resolver, which already routes `*_ltv` → `ratio`). One adjustment: the spec wants up to 4dp with trailing-zero trim, but current `ratio` is locked to 2dp. → **Switch LTV/CLTV from `ratio` to a new `ltv` category** (or bump `ratio` max to 4dp). See "Technical Notes".
- `supabase/functions/_shared/formatting.ts` — same change mirrored server-side (doc-gen output).

## Technical Notes

**Display precision discrepancy**

Current `resolvePercentCategory` maps any `*_ltv` / `*_cltv` to category `ratio`, which is hardcoded to 2dp. The new spec wants min 2dp / max 4dp with trailing zeros stripped beyond the 2nd decimal — i.e. the same rule that `proRata` already implements (just labelled differently). Cleanest minimal change:

- Change the `ratio` branch in both `src/lib/precisionFormat.ts::formatPercentByFieldKey` and `supabase/functions/_shared/formatting.ts::formatPercentByFieldKey` from `formatRatio(value)` / `formatPercentage(value, 2)` to the 4dp smart-trim variant (`formatPercentDisplay(value, 4)` + `%`).
- Leaves `formatRatio` (used elsewhere) untouched.

**Current Principal Balance source**

```ts
const { data } = await supabase
  .from('loan_history')
  .select('principal_balance,date_received,created_at')
  .eq('deal_id', dealId)
  .order('date_received', { ascending: false, nullsFirst: false })
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

Cache in component state; re-fetch on `dealId` change and on a `loan_history` realtime channel (or simple invalidation when the user navigates back from the Loan History page — already common pattern in `useDealFields`).

**Validation guard (centralised helper)**

Add a tiny pure helper in `src/lib/precisionFormat.ts`:

```ts
export function computeLtv(numerator: number, denominator: number): string | null {
  if (!Number.isFinite(numerator) || numerator < 0) return null;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return roundPctForStorage((numerator / denominator) * 100);
}
```

Use it from both Origination LTV and Current LTV calcs so the divide-by-zero / negative guard is enforced in one place. Future CLTV / multi-lien logic reuses the same helper.

## Out of scope

- Origination LTV "freeze on funding" — user opted to keep current dynamic behavior.
- New editable Current Principal Balance field on Terms & Balance — user picked the servicing-ledger source.
- Doc-gen template changes (server-side formatter mirror is the only edit there).
- CLTV business rule changes.

## Verification

1. Open a deal with `Loan Amount = 800,000`, `Estimate of Value = 1,000,000` → Origination LTV reads `80.00%`.
2. Add a loan_history row with `principal_balance = 650,000`, change Estimate of Value to `1,100,000` → Current LTV reads `59.0909%` (stored `59.0909`, displayed with trailing-zero trim).
3. Set Estimate of Value to 0 → inline error appears under Estimate of Value, both LTV cells go blank.
4. Set Loan Amount to negative → inline error, Origination LTV blank, Current LTV still computes.
5. Storage check via DB: `deal_section_values` rows for `property1.ltv` / `property1.origination_ltv` show 4dp strings.
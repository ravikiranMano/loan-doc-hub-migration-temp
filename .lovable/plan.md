
# Currency Formatting Audit & Fix Plan

## Root cause (confirmed from screenshot)

The screenshot shows mixed states on the same form:
- `Down Payment` → `78,890,000.00` ✅ (recently edited, blur-formatted)
- `Purchase Price` → `200000.00` ❌ (loaded from storage, never formatted)
- `Estimate of Value` → `1200000.00` ❌
- `Pledged Equity` → `600000.00` ❌
- `Protective Equity` → `1198800.00` ❌

Two incompatible patterns exist in the codebase:

**Pattern A — "format on blur, mutate storage" (broken on load)**
Used in: `PropertyDetailsForm.tsx`, `ChargesDetailForm.tsx`, `AddFundingModal.tsx`, `PropertyModal.tsx`, `LienDetailForm.tsx`, `LienModal.tsx`, `InsuranceDetailForm.tsx`, `InsuranceModal.tsx`, `PropertyTaxForm.tsx`, `PropertyTaxModal.tsx`, `LoanTermsPenaltiesForm.tsx`, `LoanTermsServicingForm.tsx`, `OriginationFeesForm.tsx`, `OriginationPropertyForm.tsx`, `OriginationApplicationForm.tsx`, `OriginationInsuranceConditionsForm.tsx`, `FundingDetailForm.tsx`, `FundingAdjustmentModal.tsx`, `RE885ProposedLoanTerms.tsx`, `ChargesSectionContent.tsx`, `ChargesModal.tsx`, `TrustLedgerModal.tsx`, `LenderDisbursementModal.tsx`, `PropertyLiensForm.tsx`, `PropertyInsuranceForm.tsx`, `LoanTermsDetailsForm.tsx`, `LoanTermsFundingForm.tsx`, contact `*Charges.tsx` / `*TrustLedger.tsx` (6 files).

Issue: `<Input value={getFieldValue(key)} … onBlur={…format…}>` — raw value is rendered as-is on first paint. Only the blur handler writes the formatted string back into the form state, which then persists the commaed string to the DB. Values that arrive via load, defaults, calculations, paste, or that were saved before this code shipped, render unformatted.

**Pattern B — "format-on-display, raw-in-storage" (correct)**
Used in: `LoanTermsBalancesForm.tsx` via a `focusedCurrencyField` state and `value={isFocused ? raw : formatCurrencyDisplay(raw)}`. Storage stays raw numeric; display is always formatted. This is what we standardize on.

## Approach

Replace Pattern A everywhere with a single shared component, **`<CurrencyInput>`**, that implements Pattern B internally. No backend or schema changes.

### Step 1 — Build `src/components/ui/currency-input.tsx`

A controlled input with:
- Props: `value: string`, `onValueChange: (raw: string) => void`, `disabled`, `placeholder`, `className`, optional `showDollarPrefix` (default true), `allowNegative` (default false), `id`, `aria-label`.
- Internal `focused` state.
  - When **focused**: display the raw value as-is (so the user can edit digits/decimal without commas getting in the way).
  - When **blurred**: display `formatCurrencyDisplay(value)` — `1,200,000.00`.
- `onChange`: sanitize keystroke via existing `sanitizeNumericValue` (digits, single `.`, optional leading `-`), pass the **unformatted** raw string up.
- `onBlur`: normalize raw to 2dp via `roundDollarForStorage(value)` and emit it, so storage is always `200000.00` (string, 2dp), never `200,000.00`.
- `onFocus`: emit `unformatCurrencyDisplay(value)` once to migrate any legacy commaed strings already in state to raw.
- `onPaste`: strip non-numeric, keep one decimal point, emit raw.
- `onKeyDown`: existing `numericKeyDown` filter.
- Built-in `$` prefix span (absolute-positioned, `pl-6`) matching today's visual.
- Right-aligned text optional via `align="right"` for grid cells.

Backed by `formatCurrencyDisplay`, `unformatCurrencyDisplay`, `numericKeyDown`, `numericPaste` (already in `src/lib/numericInputFilter.ts`) and `roundDollarForStorage` (already in `src/lib/precisionFormat.ts`). No new deps.

### Step 2 — Strengthen `formatCurrencyDisplay`

Today: `parseFloat(value.replace(/,/g, ''))` then `toLocaleString`. Add:
- Pre-strip `$`, spaces, and a trailing `.` so values like `"$1,000."` round-trip.
- Use `Decimal` (already imported elsewhere) to do `HALF_UP` rounding to 2dp before locale formatting, so `1000000.756` → `1,000,000.76` (matches the spec example; native `toLocaleString` is bank-rounding in some runtimes).
- Return `''` for non-finite input. Negative handling: keep the sign, format the absolute value.

### Step 3 — Add a read-only display helper for grids/cards/reports

Export `<CurrencyText value={raw} />` (thin span using `formatDollar` from `precisionFormat.ts` which already emits `$1,200,000.00`). Use in:
- `LoanFundingGrid.tsx` cells (currently call `formatCurrencyDisplay` ad hoc).
- All summary cards / read-only balance totals in `LoanTermsBalancesForm.tsx`, `RE885ProposedLoanTerms.tsx`, lender / borrower / broker `*TrustLedger.tsx` and `*Charges.tsx` rows.
- Any place currently doing `parseFloat(raw.replace(/[, $]/g, ''))` for math should pass the resulting number back through `formatDollar` for re-display.

### Step 4 — Replace Pattern A call sites

For every file listed in "Pattern A" above:
1. Delete the inline `renderCurrencyField` / `onBlur` / `onFocus` boilerplate.
2. Swap the `<Input … />` (with surrounding `<span>$</span>` and `<div className="relative">`) for `<CurrencyInput value={getValue(key)} onValueChange={(v) => onValueChange(key, v)} disabled={disabled} />`.
3. Where `onValueChange` previously received a commaed string (e.g. `setFormData({ [field]: formatCurrencyDisplay(v) })` paths in `PropertyModal.tsx` lines 106/165, `AddFundingModal.tsx` lines 415/429/482/483/531), change them to store the raw 2dp string. Display formatting is the input's job.

### Step 5 — One-time normalize on load (no migration)

In the consuming forms' value loaders (e.g. `useDealFields`'s `values` map and the modal `useEffect` hydrators in `PropertyModal`, `AddFundingModal`, `ChargesModal`, etc.), run incoming dollar field values through `unformatCurrencyDisplay` once before storing into local state. This silently migrates any legacy `"200,000.00"` strings already in the DB to raw `"200000.00"` for the session; the next save persists raw.

No SQL migration is required — the format change happens lazily as records are touched.

### Step 6 — Calculated / derived fields

`computeLtv`, `allocateDollarsByPercent`, and the pro-rata calc in `AddFundingModal` already produce numeric strings. After this change the inputs they feed into accept raw values directly — drop the `formatCurrencyDisplay(...)` wrapping before assignment (only the display layer formats).

## Out of scope

- Database schema and column types (already strings; no migration).
- Edge function formatting (`supabase/functions/_shared/formatting.ts`) — used only for document generation, already correct.
- Percentage / interest rate fields — handled by `precisionFormat.ts` and a separate memory.
- Date / phone / SSN formatters.
- New design tokens, colors, or layout changes.

## Files touched

New:
- `src/components/ui/currency-input.tsx`
- `src/components/ui/currency-text.tsx`

Modified (formatter hardening):
- `src/lib/numericInputFilter.ts` — strengthen `formatCurrencyDisplay`.

Modified (swap to `<CurrencyInput>` / `<CurrencyText>`), ~30 files in `src/components/deal/` and `src/components/contacts/*-detail/` — see Pattern A list. Each change is mechanical (replace input block, remove blur/focus handlers).

## QA checklist

| Scenario | Expected |
|---|---|
| Load existing deal with legacy raw `200000.00` | `200,000.00` |
| Load legacy commaed `"200,000.00"` from DB | `200,000.00`, persists as `200000.00` on next save |
| Type `1000` then blur | `1,000.00` |
| Type `25000.5` then blur | `25,000.50` |
| Type `1000000.756` then blur | `1,000,000.76` (HALF_UP) |
| Paste `$1,234,567.891` | `1,234,567.89` |
| Focus formatted field, edit, blur | round-trip stays consistent |
| Page refresh on Property Details, Charges, Funding, Liens, Insurance | all currency fields formatted |
| Inline grid edit in `LoanFundingGrid` | formatted on commit |
| Calculated Pro Rata / LTV unchanged | still correct |
| Negative amounts (where allowed in trust ledger debits) | `-$1,000.00` |
| Empty field | placeholder `0.00`, no `$` orphan |

## Goal
Add a "Base Fee" currency field to the Add Funding modal (per funding record), persist it through the existing funding-records save path, and expose it as `{{ld_fd_baseFee}}` in document generation — without altering existing schema, layout, or APIs.

## Scope (strictly limited)

### 1. Field Dictionary entry (data-only)
Insert one row into `field_dictionary` (no schema change):
- `field_key` = `ld_fd_baseFee`
- `label` = `Base Fee`
- `section` = `lender`
- `form_type` = `funding`
- `data_type` = `currency`
- `allowed_roles` = `{admin, csr}` (matches the other `ld_fd_*` rows)

This mirrors the existing `ld_fd_fundingAmount` / `ld_fd_principaBalanc` entries.

### 2. UI — Add Funding modal (`src/components/deal/AddFundingModal.tsx`)
- Add `baseFee: string` to the `FundingFormData` interface (default `''`).
- Render a new currency input labeled **Base Fee** in the same header row as Funding Amount / Funding Date / Current Balance, using the existing `renderCurrencyInput('baseFee', '0.00')` helper so format ($, commas, 2dp on blur), spacing, and Label widths match the surrounding fields exactly.
- No layout shifts: insert the cell adjacent to the other currency fields in the same flex row.

### 3. Grid record shape (`src/components/deal/LoanFundingGrid.tsx`)
- Add optional `baseFee?: number` to the `FundingRecord` interface so saved rows round-trip.
- Map `baseFee` in the existing convert-to/from-record paths already used for `originalAmount` / `fundingAmount` (no new save call, no new column, no new grid column unless the user later asks).

### 4. Persistence (no new APIs)
Funding rows are already serialized as JSON under the dictionary key `loan_terms.funding_records` (see `LoanTermsFundingForm.tsx`). Because `baseFee` is just a new property on each record object inside that JSON array, it persists automatically through the existing save path — no new field-dictionary lookup, no new write code, no schema migration.

### 5. Document generation (`supabase/functions/generate-document/index.ts`)
Extend the existing bridge block right next to the `ld_fd_fundingAmount` bridge (~line 1804) to also publish `ld_fd_baseFee`:
- Read the matching funding record for the current lender context (same lookup the funding-amount bridge uses).
- If a `baseFee` value exists and `ld_fd_baseFee` is not already set, `fieldValues.set("ld_fd_baseFee", { rawValue: String(baseFee), dataType: "currency" })`.
- Add a `debugLog` line: `[generate-document] Auto-bridged ld_fd_baseFee = <value>`.

This gives `{{ld_fd_baseFee}}` correct currency formatting via the existing currency renderer — no template-engine changes.

## Out of scope (will not touch)
- No DB schema changes, no new tables/columns.
- No changes to the LoanFundingGrid columns, FundingAdjustmentModal, LenderFundingForm placeholder, or any other Funding surface.
- No changes to existing field keys, save APIs, or RLS.
- No edits to `legacyKeyMap.ts` / `fieldKeyMap.ts` (the new key uses the canonical `ld_fd_` form directly).

## Validation
1. Open Add Funding modal → Base Fee field renders inline with Funding Amount, accepts numeric input, formats as `$1,234.56` on blur.
2. Save funding row → reopen for edit → Base Fee value reloaded.
3. Generate any document containing `{{ld_fd_baseFee}}` → value renders in currency format; edge-function logs show the bridge line.
4. Existing funding fields (Funding Amount, Funding Date, Current Balance, etc.) and totals are unchanged.
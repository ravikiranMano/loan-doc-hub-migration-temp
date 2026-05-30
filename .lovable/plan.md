
# Fix the global date picker (4 bugs)

All fixes land in the shared components so every consumer benefits automatically. No screen-level patches. MM/dd/yyyy display + yyyy-MM-dd storage standards are preserved, and all parse/format continues to route through `src/lib/dateOnly.ts`.

## Root-cause summary

**Bug 1 — Year selector shows a giant number.** In `enhanced-calendar.tsx` the year-list view itself is fine, but the *month* caption button reads `format(dm, "MMMM, yyyy")` where `dm` arrives from `react-day-picker` as the rendered month. When `selected` is passed as a string (yyyy-MM-dd) instead of a `Date` from some consumers, react-day-picker forwards a numeric / invalid value into the Caption, and `format()` falls back to printing the raw epoch number. Same issue feeds `displayMonth.getFullYear()` in the year/month sub-views. Fix is to coerce `displayMonth` to a real `Date` (validating with `isValid`, falling back to `new Date()`), and to always derive the year list from a sanitized base.

**Bug 2 — Dates can't be entered on Loan/Property/etc.** `DealFieldInput.renderDatePicker` parses `value` with `parseDateOnly`, but when consumers (e.g. forms going through the new `renderInlineDateField`/`renderDateField` helpers) pass values that are already `Date` objects, ISO strings with time, or `MM/dd/yyyy` display strings, `parseDateOnly` (which only accepts `yyyy-MM-dd`) returns `undefined`, the popover opens but `onSelect` is wired only inside `EnhancedCalendar` (which calls back through `handleSelect → onSelectProp`), and `DealFieldInput` then re-formats with `formatDateOnly` — round-trip mismatch causes the value to never "stick". Fix is to harden `parseDateOnly` to accept the 3 known inputs (yyyy-MM-dd, MM/dd/yyyy, Date) and to ensure `EnhancedCalendar` always normalizes the incoming `selected` prop.

**Bug 3 — No typed entry.** The trigger is a `<Button>` with no input. Users must click through the calendar one month at a time, which is unusable for fields like Year Built (~100 yrs back). Fix is to swap the trigger to a masked `MM/DD/YYYY` text `<Input>` paired with a small calendar icon button that opens the popover. Typed input parses live; on valid date it writes `yyyy-MM-dd` to state and syncs the calendar's `month` view; on invalid it shows a soft error and leaves prior state intact.

**Bug 4 — Popup reflows as you scroll.** The DayPicker `weeks` container has no min-height, so months with 4 vs 6 rows differ by ~36px; the year/month sub-views use a different height (`260px`) than the day view. The Caption layout also re-centers because `pickerView` swaps the entire subtree. Fix is to lock the whole popover to a fixed width (288px, already partly done) AND a fixed min-height (~340px including caption + footer), reserve 6 week-rows on the day grid, and keep the year/month sub-views inside the same outer shell so the Prev/Next stack and footer never jump.

## Files to change

### 1. `src/lib/dateOnly.ts`
- Extend `parseDateOnly` to accept: `Date`, `yyyy-MM-dd`, `MM/dd/yyyy`, and ISO timestamps. All other code keeps using `formatDateOnly(d, 'yyyy-MM-dd')` for storage and `'MM/dd/yyyy'` for display.
- Add `parseDisplayDate(input: string): Date | undefined` (MM/dd/yyyy only, used by the masked input).
- Add `isValidYear(d: Date, min: number, max: number)` helper.

### 2. `src/components/ui/enhanced-calendar.tsx`
- Normalize `controlledMonth`/`selected` to a valid `Date` via `parseDateOnly` + `isValid`; never let raw numbers/strings reach `format()`.
- Replace `MMMM, yyyy` caption with explicit `format(safeMonth, 'MMMM yyyy')` using the sanitized value.
- Widen the year range: `currentYear - 120` to `currentYear + 10` (configurable via new `fromYear` / `toYear` props that default to those values).
- Lock the calendar shell: wrap day / month / year views in a single outer `<div className="w-[288px] min-h-[340px] flex flex-col">` so swapping `pickerView` no longer changes outer dimensions.
- Reserve 6 week rows: set `classNames.months` to include `min-h-[252px]` (6 × 36px + gap), so 4- and 5-row months no longer collapse.
- Make Prev/Next live in the outer shell (always visible), not inside `Caption` re-rendered per subview, so rapid-clicking the same coordinate works in day/month/year views alike.
- Year grid keeps its 4-column layout but inherits the fixed shell height; auto-scroll active year into view (already present) is retained.

### 3. `src/components/deal/DealFieldInput.tsx` (renderDatePicker only)
- Replace the single-Button trigger with a composite trigger:
  - Masked text `<Input>` of width-full with `placeholder="MM/DD/YYYY"`, `inputMode="numeric"`, auto-insert `/` separators.
  - Small `Button` (icon-only, `CalendarIcon`) on the right that toggles the Popover.
- Local state: `typedValue` (string) seeded from `formatForDisplay(value)`. On every keystroke, attempt `parseDisplayDate`; if valid → `onChange(formatDateOnly(d))` and sync `EnhancedCalendar` `month`/`selected`. If incomplete/invalid → keep typing, no error until blur.
- On blur with invalid non-empty input → red border + helper text "Use MM/DD/YYYY", do not clear the user's text.
- Calendar selection still writes via existing `handleDateSelect` and also updates `typedValue`.
- Disabled state and read-only enforcement unchanged.

## New props on `EnhancedCalendar`

- `fromYear?: number` — earliest selectable year (default `currentYear - 120`).
- `toYear?: number` — latest selectable year (default `currentYear + 10`).

Consumers don't need to pass anything; defaults cover Year Built (~100 yrs back) globally. Property forms can override to `currentYear - 200` later if needed.

## Screens / fields to QA after the fix

All consume the shared picker via `DealFieldInput` or directly via `EnhancedCalendar` and should be smoke-tested:

- **Loan → Loan Details**: Origination Date, Maturity Date, First Payment Due
- **Loan → Terms & Balances**: Payment Due Date, First Payment Due, Last Pmt Received, Paid To Date, Next Due Date
- **Loan → Penalties**: any prepay / late date fields (`LoanTermsPenaltiesForm`)
- **Loan → Funding**: `FundingDetailForm`, `AddFundingModal`, `FundingAdjustmentModal`, `LenderDisbursementModal`
- **Loan → Trust Ledger**: `TrustLedgerModal`
- **Property → Details**: Year Built (critical — 100+ yr range)
- **Property → Liens**: `PropertyLiensForm`, `LienDetailForm`, `LienModal`
- **Property → Insurance**: `PropertyInsuranceForm`, `InsuranceDetailForm`, `InsuranceModal`
- **Property → Tax**: `PropertyTaxForm`, `PropertyTaxModal`
- **Property → Notes**: `NotesDetailForm`, `NotesModal`, `NotesTableView`
- **Origination → Application / Property / Escrow & Title**: `OriginationApplicationForm`, `OriginationPropertyForm`, `OriginationEscrowTitleForm`
- **Origination → Charges**: `ChargesDetailForm`, `ChargesModal`
- **Borrower**: `BorrowerPrimaryForm` (DOB), `BorrowerBankingForm`, `BorrowerAuthorizedPartyForm`
- **Lender / Broker info**: `LenderInfoForm`, `BrokerInfoForm`
- **Contacts**: `CreateContactModal`, Borrower/Lender/Broker `ConversationLog`, `Charges`, `TrustLedger`
- **Misc**: `GridExportDialog` date range

## Out of scope

- No schema or API changes.
- No changes to per-screen form definitions, field dictionaries, or storage keys.
- No restyling beyond what's required to lock the popup footprint.

## Prompt 1 — Loan Details: On Pull style + reorder Terms fields

**File:** `src/components/deal/LoanTermsDetailsForm.tsx`

### Change 1 — On Pull label style (line 929)
Remove the green color classes so On Pull matches Military SCRA exactly.
- Replace `className="font-semibold cursor-pointer text-xs text-green-600 dark:text-green-500"` with the same className used by other checkbox labels (matches Military SCRA's `renderInlineCheckbox` output).
- Switch the whole block from the inline custom render to `renderInlineCheckbox(NEW_KEYS.typeOnPull, 'On Pull')` to guarantee identical style (same helper, same classes, same DirtyFieldWrapper).

### Change 2 — Move the 5 dropdowns from Loan Status column → Loan Categories column, directly after Current Rate
Currently (lines 1099–1110) `Rate Structure`, `Amortization`, `Interest Calculation`, `Calculation Period`, `Processing Unpaid Interest` are rendered at the bottom of the **Loan Status** column.

- **Remove** that block (lines 1099–1110) from the Loan Status column.
- **Insert** the same 5 `renderInlineSelect(...)` calls in the **Loan Categories** column immediately after the Current Rate block (after line 976, before the column's closing `</div>` at line 978), in this exact order:
  1. Rate Structure
  2. Amortization
  3. Interest Calculation
  4. Calculation Period
  5. Processing Unpaid Interest

No props, no keys, no option lists, no validators changed. Save/load bindings (`FIELD_KEYS.rateStructure`, `.amortization`, `.interestCalculation`, `.calculationPeriod`, `.processingUnpaidInterest`) are reused as-is. The downstream conditional "Adjustable / Graduated Loan Details" block keeps working because it reads `getValue(FIELD_KEYS.rateStructure)`.

---

## Prompt 2 — Escrow Impound: Remove Loan Purpose

**Confirmed safe**: The two Loan Purpose fields are stored under **different keys** in `field_dictionary`:
- Loan Details → `ln_p_loanPurpos` (section `loan_terms`) — **kept**
- Escrow Impound → `es_p_loanPurpos` (section `escrow`) — **hidden from this screen**

**File:** `src/components/deal/EscrowImpoundForm.tsx`

- Extend the existing field-filter pattern (the same approach already used for `frequencyField` and `isHiddenDuplicate`) to also drop `es_p_loanPurpos` from `remainingFields` before it's passed to `DealSectionTab`. Add the key to a small `HIDDEN_KEYS` set and exclude in the filter.
- Layout is a 2-col grid — removing one cell reflows cleanly with no empty slot.
- No data migration, no dictionary edits, no impact on Loan Details Loan Purpose.

---

## Out of scope
- No field-dictionary changes, no migrations, no save flow / persistence / validation changes.
- No edge-function / document-generation changes (no template tag uses `es_p_loanPurpos` for output — the field merely persists; existing values, if any, remain in `deal_section_values` untouched).
- No other field, label, color, or layout altered.

## Verification
1. Loan Details → On Pull renders identical to Military SCRA (same neutral text color, same weight, same checkbox size).
2. Loan Categories column order below the checkboxes: Day Due → Current Rate → Rate Structure → Amortization → Interest Calculation → Calculation Period → Processing Unpaid Interest, with no gap.
3. Loan Status column no longer shows those 5 dropdowns; existing NSF / 30-days Plus stay in place.
4. Change each of the 5 dropdowns → Save Draft → reload → values persist (same keys as before).
5. Escrow Impound: Loan Purpose row gone, neighboring fields reflow with no empty cell; Loan Details Loan Purpose still saves/loads normally.

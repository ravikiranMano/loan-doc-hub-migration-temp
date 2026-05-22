## Override Calculation Validation — Scoped Implementation Plan

The spec covers 14 test cases across UI, API, accounting, documents, and audit. Today the project has exactly **two** override surfaces:

1. **Lender Rate Override** on funding records — `lenderRateOverride` + `lenderRateOverrideValue` (in `AddFundingModal`, `FundingDetailForm`, `LoanFundingGrid`, `LoanTermsFundingForm`).
2. **Lender Disbursement Override** — `overrideEnabled` + `overrideReason` (in `LenderDisbursementModal`).

There is no override on servicing rates, accounting GL entries, payoff calc, ledger balances, or document merge tags as separate fields — those all read from the same funding/servicing values that the two overrides above produce. So the realistic scope is: make the two existing overrides **truly authoritative, persistent, audited, and visually marked**, and verify downstream consumers (payment recompute, document tags, exports) read the overridden values.

Scope is intentionally narrow per project's minimal-change policy. No DB schema migration, no new tables. All metadata stored inside the existing funding record JSON (`loan_terms.funding_records[].*`) and the existing disbursement record JSON.

---

### What changes

**1. Lender Rate Override — audit metadata (Rule 4, Test 11)**

Extend the funding record shape (in-memory + persisted JSON, no DB column change) with:
```
lenderRateOverride: boolean
lenderRateOverrideValue: string           // already exists
lenderRateOverrideOriginal: string        // NEW — snapshot of calculated value at moment override toggled on
lenderRateOverrideReason?: string         // NEW — optional text
lenderRateOverrideBy: string              // NEW — auth.uid() at toggle time
lenderRateOverrideAt: string              // NEW — ISO timestamp at toggle time
```

- Captured in `AddFundingModal` Override checkbox `onCheckedChange` and in `FundingDetailForm` Override toggle.
- Cleared (set to undefined) when Override is toggled off → restores calculated source (Test 14 revert).
- Persisted as part of the existing funding records JSON write in `LoanTermsFundingForm` / `LoanFundingGrid.handleSaveFundingRecord`.

**2. Precision storage (Rule 5, Test 12)**

- In `AddFundingModal` and `FundingDetailForm` Override input `onBlur`: store value with up to **4 decimals** using existing `truncateToDecimals(v, 4)`. Display continues using `formatPercentage(v, 3)`.
- Save path passes the stored 4-dp string, not the display-rounded value.

**3. Override locking (Rule 1, Rule 9, Test 10)**

In `AddFundingModal` sync effect (lines ~395–432) and `LoanFundingGrid` lender-rate cell renderer:
- When `lenderRateOverride === true`, **never** overwrite `lenderRate` from Sold Rate, Note Rate, or any auto-fill chain.
- The existing precedence (`Override → Sold → Note`) is already correct; this change adds an explicit guard that recompute effects watching `noteRate` / `soldRate` props skip records where `lenderRateOverride === true`.
- `recomputeLenderPayments` already uses `record.lenderRate`; verify it reads the override value through the normal field and add a comment marking the contract.

**4. Override badge + tooltip (UI Requirements)**

In `LoanFundingGrid` lender-rate cell:
- When `record.lenderRateOverride === true`, show a small `Pencil` icon next to the value with tooltip:
  `Manually overridden by {name} on {MM/DD/YYYY}. Original calculated: {original}%. Reason: {reason}`.
- Use existing `Tooltip` + `Badge` primitives. No new components.

**5. Optional confirmation modal (UI Requirements)**

When toggling Override **on** in `AddFundingModal` and `FundingDetailForm`, show a one-line `AlertDialog` confirm:
`Applying override will recalculate dependent payment values for this funding record. Continue?`
- Cancel leaves override off.
- Confirm proceeds and snapshots `lenderRateOverrideOriginal`.

**6. Disbursement Override — parity audit fields**

`LenderDisbursementModal` already has `overrideEnabled` + `overrideReason`. Add:
- `overrideOriginalAmount` (snapshot of computed amount at toggle)
- `overrideBy`, `overrideAt`
Persisted in the existing disbursement record JSON. Badge on the disbursement row in `LoanFundingGrid` showing the same tooltip pattern.

**7. Downstream verification (no code change, just validation)**

Already correct — but add inline comments documenting the contract so future changes don't regress:
- `LoanTermsFundingForm.tsx:522` — `lenderRate = override ? overrideValue : computed`. ✓
- `LoanFundingGrid.tsx:1031` — same precedence in save path. ✓
- Document merge: funding records flow through existing publishers; they read `record.lenderRate` which already resolves to the override value. No template change needed.
- Exports / reports: same — they consume `record.lenderRate`.

---

### Out of scope (explicit)

- **No new audit table.** Override metadata lives in the funding/disbursement JSON. A separate `override_audit_log` table would touch DB schema and is outside the minimal-change policy. Can be added later.
- **No servicing / GL / payoff override fields** — those entities don't expose a separate override today and the spec doesn't name new ones.
- **No new API endpoints.** Reads/writes go through the existing `deal_section_values` save path.
- **No changes to document templates.** Merge tags already render the resolved `lenderRate`.

---

### Files touched

- `src/components/deal/AddFundingModal.tsx` — metadata snapshot on toggle, precision on blur, confirmation dialog, locking guard.
- `src/components/deal/FundingDetailForm.tsx` — same toggle/snapshot/confirmation.
- `src/components/deal/LoanFundingGrid.tsx` — badge + tooltip in lender-rate cell and disbursement row; pass-through of new fields.
- `src/components/deal/LenderDisbursementModal.tsx` — snapshot original amount + by/at on toggle.
- `src/components/deal/LoanTermsFundingForm.tsx` — pass-through of new metadata fields in save payload.

No DB migration. No edge function. No template change.

---

### QA mapping

| Spec test | Covered by |
|---|---|
| 1, 2, 3, 4 | Existing precedence + new locking guard (#3) |
| 5, 7 | No-op — already flows through `record.lenderRate` |
| 6 | No-op — templates already read resolved value |
| 8, 9 | Persistence of new metadata in funding/disbursement JSON |
| 10 | Locking guard (#3) |
| 11 | Audit metadata (#1, #6) + badge tooltip (#4) |
| 12 | 4-dp storage on blur (#2) |
| 13 | Override per-record is independent; no cross-record coupling added |
| 14 | Toggle-off clears metadata and restores calculated source (#1) |

Approve to implement, or tell me which subset (e.g. just #1+#3+#4, or skip the confirmation modal) to keep it tighter.
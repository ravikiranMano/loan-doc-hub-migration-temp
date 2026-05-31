# Loan Details — V3 Spec Restructure

All changes are scoped to `src/components/deal/LoanTermsDetailsForm.tsx`. No existing field keys, save bindings, validation, or document-generation paths change. No edits to `fieldKeyMap.ts`, `legacyKeyMap.ts`, edge functions, or templates.

## 1. Section header renames

- `Loan Type (can be multiple)` → `Loan Categories (can be multiple)`
- `Status Categories (can be multiple)` → `Loan Status (can be multiple)`

## 2. Details column — reorder + insert

Render order in the Details column (left grid column):

1. Company ID
2. Previous Loan Number
3. Parent Account (move account-checkbox row up here)
4. Child Account
5. Lien Position
6. Loan Code
7. **Project Number** (NEW — `loan.project_number`, plain text via `renderInlineField`)
8. Assigned CSR
9. Originating Vendor
10. Original Loan Amount
11. **Loan Purpose** (moved here — keep same key `FIELD_KEYS.loanPurpose`, render with existing `renderInlineSelect`. Remove from Terms column.)
12. Recording Date
13. Recording Number
14. Boarding Date
15. Maturity / DIF
16. **Paid Off / Closed** (NEW — `loan.paid_off_date`, date via `renderInlineDateField`)
17. Loan Number (kept; below V3 fields)
18. Origination Date (kept)
19. Previous Account Number (kept)
20. Overpayments Applied To (kept)
21. Related Party Search (kept)

Loan Purpose is removed from the Terms column only; all other Terms column fields stay exactly as-is.

## 3. Loan Categories — append & reorder

Final order in the renamed Loan Categories column:

Owner Occupied, Multi-lender, Seller Carry, AITD / Wrap, Rehab / Construction, Variable / ARM, RESPA / Consumer, Unsecured, Cross Collateral, Limited / No Documentation, Balloon Payment, Subordination Provision, Pass Through, **Section 32** (NEW `loan.type_section32`), **Article 7** (NEW `loan.type_article7`), Transfer In (moved from Status), Document Prep (moved from Status), Military SCRA (moved from Status), **On Pull** (NEW `loan.type_on_pull`, label rendered with `text-green-600` / matching green token).

Moved checkboxes keep their original keys (`FIELD_KEYS.transferIn`, `FIELD_KEYS.documentPrep`, `FIELD_KEYS.statusMilitarySCRA`) — only their visual placement changes.

## 4. Loan Status column

After moving Transfer In / Document Prep / Military SCRA out, the column contains:

- Loan Status dropdown (new options array — see §5)
- Hold Reason (conditional)
- Closed Reason (conditional)
- Bankruptcy, Foreclosure, Modification, Forbearance, Litigation (kept)
- Assignment (kept — not in V3 but preserved)

Then a new sub-header `Send:` followed by 4 rows (checkbox + label + read-only Last Sent date) using new keys:

| Checkbox | Last Sent |
|---|---|
| `loan.send_coupon_book` | `loan.send_coupon_book_last_sent` |
| `loan.send_pmt_statement` | `loan.send_pmt_statement_last_sent` |
| `loan.send_late_notice` | `loan.send_late_notice_last_sent` |
| `loan.send_balloon_notice` | `loan.send_balloon_notice_last_sent` |

Last Sent rendered as a small `<Input readOnly disabled>` showing formatted date (blank when empty). Not user-editable.

Then two read-only count fields below:

- **NSF Previous 12 Months** — `loan.nsf_prev_12mo` (read-only number input, label + small box)
- **30-days Plus** — `loan.thirty_days_plus` (same style)

Values are surfaced as-is from `values[...]`; system-population happens elsewhere — UI is display-only.

## 5. Conditional Loan Status logic

Replace `LOAN_STATUS_OPTIONS` / `HOLD_REASON_OPTIONS` / `CLOSED_REASON_OPTIONS` with the exact V3 sets:

- Loan Status: `Active`, `Hold`, `Closed` (blank handled by Select placeholder)
- Hold Reason: `Document Needed`, `Fraud / Red Flag`, `Pending Payoff`, `Occupancy Concern`, `Pending Workout`, `Other`
- Closed Reason: `Paid`, `Transfer Out (Customer)`, `Transfer Out (Company)`, `Dead`, `Charged Off`, `Other`

Behaviour:

- Render Hold Reason only when `loanStatus === 'hold'`; render Closed Reason only when `loanStatus === 'closed'`; otherwise hide.
- On `loanStatus` change via the Select, if new value ≠ `hold` clear `holdReason` (`onValueChange(holdReasonKey, '')`); if new value ≠ `closed` clear `closedReason`. Blank/`Active` clears both.
- On initial load the existing saved value drives which conditional is visible — no extra state needed.

Existing field keys (`FIELD_KEYS.loanStatus`, `holdReason`, `closedReason`) are reused so persistence, doc-gen, and historical data are untouched.

## 6. Out of scope / untouched

- `src/lib/fieldKeyMap.ts`, `legacyKeyMap.ts`, field_dictionary, edge functions, template tag-parser, formatting helpers.
- All Terms column fields except Loan Purpose (which only moves columns).
- LoanTermsBalancesForm and any other tab.
- Styling tokens — all new controls reuse existing `renderInline*` helpers and checkbox styles.

## Acceptance verification

After build, visually confirm: new field order, renamed headers, moved checkboxes, new Section 32 / Article 7 / On Pull (green) / Project Number / Paid Off / Closed / Send block / NSF / 30-days Plus render; Loan Status conditional show/hide + clear-on-change works; existing fields still save/load.

# Loan Terms, Deal Calculations & Document Generation — Team Review Checklist

> **Purpose:** Reference document for team review. Covers all loan terminology, all calculations
> that run on deal data (World 1), and all calculations that run during document generation
> (World 2). Use this to verify nothing is missing or incorrectly implemented.
>
> **Branch:** `main`
> **Date:** 2026-06-03

---

## Table of Contents

1. [Loan Terms — Complete Reference](#1-loan-terms--complete-reference)
2. [Deal Data Calculations — World 1](#2-deal-data-calculations--world-1)
   - [Rate & Interest Calculations](#21-rate--interest-calculations)
   - [Payment Calculations](#22-payment-calculations)
   - [Balance & Reinstatement Calculations](#23-balance--reinstatement-calculations)
   - [Property & Equity Calculations](#24-property--equity-calculations)
   - [Lien & Waterfall Calculations](#25-lien--waterfall-calculations)
   - [Funding & Multi-Lender Calculations](#26-funding--multi-lender-calculations)
3. [Document Generation Calculations — World 2](#3-document-generation-calculations--world-2)
   - [Value Formatting Transforms](#31-value-formatting-transforms)
   - [Bridge Functions](#32-bridge-functions)
   - [Per-Template Calculations](#33-per-template-calculations)
4. [Known Bugs & Missing Items](#4-known-bugs--missing-items)

---

## 1. Loan Terms — Complete Reference

### 1.1 Core Loan Economics

| Term | Definition | Formula / Notes |
|---|---|---|
| **Principal** | The outstanding loan balance — what the borrower currently owes | Starts at loan amount; decreases with each payment |
| **Original Loan Amount** | The amount funded at origination | Never changes after boarding |
| **Note Rate** | Annual interest rate stated in the promissory note — what the borrower agreed to pay | e.g. 7.5% per year |
| **Sold Rate** | Rate passed to the investor when a loan is sold/assigned | If note rate = 7.5% and sold rate = 7.0%, servicer income = 0.5% |
| **Lender Rate** | Rate a specific investor earns in a multi-lender loan | Can differ per lender; falls back to note rate if not set |
| **Servicer Income / Spread** | The servicer's income from the difference between note rate and lender rate | `Note Rate − Lender Rate` |
| **Current Rate** | The rate actually in effect today | FRM: equals note rate. ARM: index + margin (clamped). GTM: stepped rate |
| **Default Rate** | Higher penalty rate charged when borrower is in default | Always > note rate; specified in loan documents |
| **Interest Guarantee** | Minimum interest contractually owed to lender regardless of prepayment | Protects lenders from prepayment interest loss |

### 1.2 Loan Structure

| Term | Definition | Notes |
|---|---|---|
| **Term** | Loan life in months | 360 = 30 years, 180 = 15 years |
| **Amortization Type** | How the balance pays down over time | See amortization types below |
| **Payment Frequency** | How often payments are made | Monthly, bi-weekly, weekly, quarterly, semi-annually, annually |
| **Number of Payments** | Total payment periods | For monthly: term in months |
| **Balloon Payment** | Large lump-sum due at maturity | Occurs when term < amortization period |
| **Interest Calculation Method** | How daily interest is calculated | Actual/360 or Actual/365 |

#### Amortization Types

| Type | How It Works | Payment Changes Over Time? |
|---|---|---|
| **Fully Amortized** | Every payment covers interest + principal; balance = $0 at end of term | No — fixed payment |
| **Partially Amortized** | Payments based on longer schedule; balloon remains at end of actual term | No — fixed payment |
| **Interest Only** | Payments cover only interest; no principal reduction | No — fixed interest-only payment |
| **Constant Amortization** | Equal principal portion each period; interest portion decreases as balance falls | Yes — payment decreases each period |
| **Add-On Interest** | Total interest calculated upfront and added to principal; fixed payment | No — but calculated differently |

#### Rate Structures

| Type | How Rate Is Determined | Key Fields |
|---|---|---|
| **FRM (Fixed Rate)** | Rate stays constant for entire loan life | `note_rate` |
| **ARM (Adjustable Rate)** | Rate = index + margin; adjusts periodically; subject to floor/ceiling | `arm_index_rate`, `arm_margin`, `arm_rate_floor`, `adj_max_interest_rate` |
| **GTM (Graduated Terms)** | Rate increases on a set schedule | `gtm_scheduled_period_rate`, `adj_initial_rate_months` |

### 1.3 Property & Collateral Terms

| Term | Definition | Formula |
|---|---|---|
| **Property Value (Appraised Value)** | Current estimated or appraised market value of the property | Set by appraisal or BPO |
| **LTV (Loan-to-Value)** | Ratio of loan amount to property value | `(loan_amount / property_value) × 100` |
| **Origination LTV** | LTV at the time the loan was originally made | Frozen at origination |
| **Current LTV** | LTV using today's outstanding principal | `(current_principal / appraised_value) × 100` |
| **CLTV (Combined LTV)** | All loans on the property combined vs. property value | `(all_lien_balances / appraised_value) × 100` |
| **Pledged Equity** | Property value above the loan amount | `appraised_value − loan_amount` |
| **Protective Equity** | Property value remaining after paying all senior liens | `appraised_value − senior_lien_balances` |
| **Down Payment** | Borrower's cash contribution at purchase | `purchase_price − loan_amount` |

### 1.4 Lien Terms

| Term | Definition | Notes |
|---|---|---|
| **Lien** | Legal claim against a property that secures a debt | Must be recorded at county to be enforceable |
| **Lien Position / Priority** | Order in which liens get paid if property is sold | 1st = paid first, 2nd = paid after 1st, etc. |
| **Senior Lien** | Lien with higher priority than this loan | Gets paid before this loan in any sale or foreclosure |
| **Junior Lien** | Lien with lower priority than this loan | Gets paid after this loan; may receive nothing if sale price is insufficient |
| **Recording Date** | Date the lien was officially filed with the county | Earlier recording = higher priority (in most cases) |
| **Lien Payoff** | Paying the entire lien balance to remove it from the property | Balance drops to zero; lien released |
| **Lien Paydown** | Partial payment to reduce the lien balance | Balance reduced; lien remains |
| **Lien Remain** | Lien stays on property without any payment | Balance unchanged |

### 1.5 Funding & Multi-Lender Terms

| Term | Definition | Formula |
|---|---|---|
| **Multi-Lender Loan** | One loan funded by multiple investors | Each investor owns a pro-rata share |
| **Pro Rata %** | Each lender's percentage share of the total loan | `(lender_amount / total_loan_amount) × 100` |
| **Funding Date** | Date a specific lender's money was transferred | Affects interest accrual start |
| **Interest From Date** | Date this lender's interest begins accruing | May differ from funding date |
| **Accrual Days** | Calendar days between funding date and interest-from date | `interest_from_date − funding_date` (UTC) |
| **Day Count Basis** | Denominator for daily interest calculation | 360 (Actual/360) or 365 (Actual/365) |
| **Rounding Adjustment** | One lender absorbs penny-rounding differences | Only one lender per loan can hold this flag |

### 1.6 Payment & Balance Terms

| Term | Definition |
|---|---|
| **Regular Payment** | Scheduled payment per period (covers interest + some principal for amortizing loans) |
| **Total Payment** | Full monthly obligation: regular payment + escrow + other additions |
| **First Payment Due** | Date of first scheduled payment |
| **Paid To Date** | Date through which the loan is considered current |
| **Next Payment Due** | Next scheduled payment date |
| **Last Payment Received** | Most recent actual payment receipt date |
| **Unpaid Interest** | Interest formally due and charged, not yet paid by borrower |
| **Accrued Interest** | Interest accumulating since last payment (not yet formally charged) |
| **Unpaid Late Charges** | Late fees assessed but not yet paid |
| **Default Interest** | Penalty-rate interest charged when borrower is in default |
| **Charges Owed** | Advances made by servicer on borrower's behalf (taxes, insurance) |
| **Suspense Balance** | Partial or unidentified payments held until a full payment accumulates |
| **Escrow Balance** | Tax and insurance impound account balance |
| **Reserve Balance** | Funds held for future expenses |
| **Amount to Reinstate** | Total to bring a delinquent loan current (without paying it off) |

### 1.7 Loan Status Terms

| Term | Definition |
|---|---|
| **Active** | Loan is in good standing, being serviced normally |
| **Hold** | Loan is paused — action required (W9 needed, fraud concern, pending payoff, etc.) |
| **Closed** | Loan is no longer active (paid off, transferred, charged off, etc.) |
| **Foreclosure** | Legal process by which lender takes property after borrower default |
| **Bankruptcy** | Borrower has filed for bankruptcy — automatic stay on collection actions |
| **Modification** | Permanent change to loan terms to assist a struggling borrower |
| **Forbearance** | Temporary suspension or reduction of payments |
| **Reinstatement** | Bringing a delinquent loan current by paying all past-due amounts |
| **Payoff** | Paying the entire loan balance — loan ends, lien released |
| **Boarding** | Process of entering a new loan into the servicing system |

### 1.8 Document Terms

| Term | Definition |
|---|---|
| **Promissory Note** | The borrower's legal promise to repay the loan |
| **Deed of Trust** | Legal document creating a lien on the property (California equivalent of a mortgage) |
| **RE-851D** | California form: Schedule of Real Property — lists all properties securing a loan |
| **RE-885** | California form: Mortgage Loan Disclosure Statement — lists all origination fees |
| **Origination Fees** | Fees charged to borrower at loan closing (points, appraisal, title insurance, etc.) |
| **Merge Tag / Placeholder** | A variable in a DOCX template that gets replaced with actual data, e.g. `{{ln_p_loanAmount}}` |

---

## 2. Deal Data Calculations — World 1

> These calculations run in the **browser** when the user edits fields.
> Results are shown on screen and **saved to the database**.

---

### 2.1 Rate & Interest Calculations

#### C1 — Current Rate (Effective Rate)
**Trigger:** When rate structure, note rate, index rate, margin, floor, or ceiling changes
**Result saved to:** `loan_terms.current_rate`
**Display:** Rate field shown as read-only in Loan Terms Details

```
FRM (Fixed Rate Mortgage):
  current_rate = note_rate

ARM (Adjustable Rate Mortgage):
  raw_rate     = index_rate + margin
  current_rate = max(rate_floor, min(raw_rate, max_interest_rate))

GTM (Graduated Terms Mortgage):
  if step_rate_product_enabled:
    current_rate = gtm_scheduled_period_rate
  else:
    current_rate = note_rate
```

**Input Fields:**

| Field Key | Description |
|---|---|
| `loan_terms.rate_structure` | FRM / ARM / GTM |
| `loan_terms.note_rate` | Annual note rate (%) |
| `loan_terms.arm_index_rate` | Market index rate (ARM only) |
| `loan_terms.arm_margin` | Fixed spread added to index (ARM only) |
| `loan_terms.arm_rate_floor` | Minimum rate (ARM only) |
| `loan_terms.adj_max_interest_rate` | Maximum rate cap (ARM only) |
| `loan_terms.gtm_step_rate_product` | Step rate enabled? (GTM only) |
| `loan_terms.gtm_scheduled_period_rate` | Stepped rate value (GTM only) |

---

### 2.2 Payment Calculations

#### C2 — Regular Payment (Borrower Scheduled Payment)
**Trigger:** When loan amount, note rate, term, amortization type, balloon, or frequency changes
**Result saved to:** `loan_terms.regular_payment`
**Only overwrites stored value if computed result drifts > $0.005 from stored**

```
Shared:
  periodsPerYear = 12 (monthly) | 26 (bi-weekly) | 52 (weekly)
                 | 4 (quarterly) | 1 (annually) | 2 (semi-annually)
  r = (note_rate / 100) / periodsPerYear
  n = number_of_payments (adjusted for frequency)

Interest Only / Add-On Interest / Unknown:
  payment = principal × r

Constant Amortization (declining payments — formula gives Period 1):
  payment = (principal / n) + (principal × r)
  [principal portion is equal each period; interest shrinks as balance falls]

Fully Amortized (balance = $0 at end):
  payment = principal × r × (1+r)^n / ((1+r)^n − 1)

Partially Amortized (balloon remains):
  B = balloon_amount
  payment = (principal − B / (1+r)^n) × r × (1+r)^n / ((1+r)^n − 1)
```

**Input Fields:**

| Field Key | Description |
|---|---|
| `loan_terms.original_amount` | Principal balance |
| `loan_terms.note_rate` | Annual rate (%) |
| `loan_terms.number_of_payments` | Total payment periods |
| `loan_terms.amortization` | Amortization method |
| `loan_terms.estimated_balloon_payment` | Balloon amount (partial amortization only) |
| `loan_terms.payment_frequency` | Payment frequency |

#### C3 — Total Payment (Display Only)
**Result saved to:** ❌ Not saved — display only

```
total_payment = regular_payment
              + additional_principal
              + servicing_fees
              + other_scheduled_payments
              + to_escrow_impounds
              + default_interest
```

---

### 2.3 Balance & Reinstatement Calculations

#### C4 — Amount to Reinstate (Display Only)
**Result saved to:** ❌ Not saved — display only

```
amount_to_reinstate = principal
                    + unpaid_late_charges
                    + accrued_late_charges
                    + unpaid_interest
                    + accrued_interest
                    + interest_guarantee
                    + unpaid_default_interest
                    + accrued_default_interest
                    + charges_owed
                    + charges_interest
                    + unpaid_other
```

*All past-due amounts, late charges, fees, and default interest — everything needed to bring a delinquent loan current without paying it off.*

#### C5 — Total Amount Due (Display Only)
**Result saved to:** ❌ Not saved — display only

```
total_amount_due = principal
                 + unpaid_interest
                 + accrued_interest
                 + charges_owed
                 + charges_interest
                 + unpaid_other
```

*Simplified payoff total — excludes late charges and default interest.*

#### C6 — Estimated Balloon Payment (Display Only)
**Result saved to:** ❌ Not saved — display only

```
estimated_balloon = loan_amount + (loan_amount × note_rate / 100 / 12)
                  = loan_amount × (1 + note_rate / 1200)
```

*Rough estimate: original principal plus one month of interest.*

#### C7 — Short Pay Bi-directional Conversion
**Trigger:** When user edits either the percent or dollar acceptance threshold
**Result saved to:** ✅ Both `loan_terms.apply_to_payment_amount` and `loan_terms.apply_to_payment_percent`

```
When user edits percent field:
  amount = (percent / 100) × regular_payment

When user edits dollar amount field:
  percent = (amount / regular_payment) × 100

Driver flag (apply_to_payment_parameters):
  Records which field was last edited ("percent" or "dollar")
```

---

### 2.4 Property & Equity Calculations

#### C8 — Down Payment
**Trigger:** When purchase price or loan amount changes
**Result saved to:** ✅ `property1.down_payment`
**Guard:** Only auto-fills if stored value is empty OR matches last auto-computed value (respects manual edits)

```
down_payment = purchase_price − loan_amount
```

#### C9 — Pledged Equity
**Trigger:** When appraised value or loan amount changes
**Result saved to:** ✅ `property1.pledged_equity`

```
pledged_equity = appraised_value − loan_amount
```

*Property value the borrower has pledged as security above the loan amount.*

#### C10 — Protective Equity
**Trigger:** When appraised value or any lien balance changes
**Result saved to:** ✅ `property1.protective_equity`

```
protective_equity = appraised_value − sum(all_lien_balances)
```

*What the lender has left after paying off every other claim on the property.*

#### C11 — Current LTV
**Trigger:** When current principal or appraised value changes
**Result saved to:** ✅ `property1.ltv`
**Returns null (clears field) if:** either input is zero, negative, or invalid

```
current_ltv = (current_principal / appraised_value) × 100
```

Stored at 4 decimal places. Displayed at 2 decimal places.

#### C12 — CLTV (Combined Loan-to-Value)
**Trigger:** When any lien balance or appraised value changes
**Result saved to:** ✅ `property1.cltv`

```
cltv = (sum_of_all_lien_balances / appraised_value) × 100
```

> ⚠️ **Bug:** For junior lien scenarios, the current loan being originated should be included
> in the numerator alongside existing senior liens. Currently it is excluded.
> Correct formula: `cltv = (existing_lien_balances + this_loan_amount) / appraised_value × 100`

#### C13 — Origination LTV
**Trigger:** User-entered — no longer auto-calculated
**Result saved to:** ✅ `property1.origination_ltv` (manual entry)

> ⚠️ **Bug (historical):** Previously auto-calculated using `loan_terms.loan_amount` as numerator.
> `loan_amount` is the current (mutable) balance — it drifts after partial payments.
> The origination LTV should use `loan_terms.original_loan_amount` and be frozen at boarding.

#### C14 — Principal Paid
**Trigger:** When original loan amount or current principal changes
**Result saved to:** ✅ `loan_terms.principal_paid`

```
principal_paid = original_loan_amount − current_principal
```

---

### 2.5 Lien & Waterfall Calculations

#### C15 — Remaining Balance per Lien
**Used by:** C16 (waterfall) and C17 (equity)

```
getRemainingBalance(lien):
  if existingPayoff  = true: return 0
  if existingPaydown = true: return max(0, current_balance − paydown_amount)
  if existingRemain  = true: return current_balance
  else:                      return anticipated_amount
                             OR new_remaining_balance
                             OR current_balance
```

#### C16 — Lien Payoff Waterfall (Balance After / Priority After)
**Trigger:** When any lien balance, disposition, or property value changes
**Result saved to:** ✅ `lien#.balance_after`, `lien#.lien_priority_after`

```
Step 1: Sort all liens by current priority (ascending — 1st paid first)
Step 2: remaining_proceeds = property_value

For each lien (in priority order):
  owed         = getRemainingBalance(lien)     [see C15]
  paid         = min(remaining_proceeds, owed)
  balance_after = owed − paid
  priority_after = balance_after > 0 ? next_rank++ : 0
  remaining_proceeds = remaining_proceeds − paid
```

*Simulates: if the property were sold today for its appraised value, how much would each lienholder receive and what would remain unpaid?*

#### C17 — Equity Summary (Senior / Junior / Total)
**Trigger:** When lien data or property value changes
**Result saved to:** ✅ `property1.protective_equity`, `property1.total_equity`, `property1.senior_liens_total`, `property1.junior_liens_total`

```
thisLoanPriority = priority of lien flagged as "This Loan"

Initialize: seniorTotal = 0, juniorTotal = 0, totalLiens = 0

For each lien:
  balance     = getRemainingBalance(lien)
  totalLiens += balance

  if priority < thisLoanPriority:   seniorTotal += balance
  if priority > thisLoanPriority:   juniorTotal += balance

Results:
  protective_equity = property_value − seniorTotal
  total_equity      = property_value − totalLiens
  senior_liens_total = seniorTotal
  junior_liens_total = juniorTotal
```

---

### 2.6 Funding & Multi-Lender Calculations

#### C18 — Per-Lender Payment (Daily Accrual — Model A)
**Trigger:** When note rate, lender rate, funding date, interest-from date, or amount changes
**Result saved to:** ✅ `fundingRecords[i].regularPayment` (inside `loan_terms.funding_records` JSON)
**Debounced:** 400ms delay before recalculation

```
effectiveLenderRate = lenderRate (if set and > 0)
                    else noteRate

accrual_days = interestFrom_date − funding_date  (UTC calendar days)
             Must be ≥ 0; if negative → bad_dates error

payment = originalAmount × (effectiveLenderRate / 100) × accrual_days / dayCountBasis

dayCountBasis = 360 (default, Actual/360)
              or 365 (Actual/365)
```

**Rounding:** Banker's rounding (HALF_EVEN) to 2 decimal places.

**Status Codes (when cannot compute):**

| Status | Condition |
|---|---|
| `ok` | Calculation succeeded |
| `missing_amount` | originalAmount is zero or missing |
| `missing_rate` | lenderRate and noteRate both unavailable |
| `missing_dates` | fundingDate or interestFrom is empty |
| `bad_dates` | Date fails strict YYYY-MM-DD format, year outside 2000–2100, or interestFrom < fundingDate |

#### C19 — Per-Lender Servicer Income
**Trigger:** Same as C18
**Result saved to:** ✅ `fundingRecords[i].servicerIncome`

```
spread = noteRate − effectiveLenderRate

if spread > 0:
  servicerIncome = originalAmount × (spread / 100) × accrual_days / dayCountBasis
else:
  servicerIncome = 0
```

*Servicer earns the spread when lender rate is below note rate. Zero when rates are equal.*

#### C20 — Pro Rata Percentage per Lender
**Trigger:** When any lender's amount or total loan amount changes
**Result saved to:** ✅ `fundingRecords[i].pctOwned` + `loan_terms.pro_rata`

```
For each lender row:
  pctOwned_i = (originalAmount_i / totalLoanAmount) × 100

totalProRata = sum(pctOwned for all lenders)
```

*Not normalized to 100% — reflects actual funded share.*

#### C21 — Multi-Lender Penny-Safe Allocation
**Used by:** Payment distribution across multiple lenders
**Input:** Total payment amount + array of pro-rata percentages

```
For each lender:
  allocation_i = total × (pctOwned_i / 100)    [rounded to 2dp HALF_UP]

sum_of_allocations = sum(all allocation_i)
residual_delta     = total − sum_of_allocations   [typically ±$0.01]

if residual ≠ 0:
  Find lender with largest absolute allocation
  Add residual to that lender's allocation

Guarantee: sum(all allocations) = total exactly (no lost cents)
```

---

### World 1 Summary

| # | Calculation | Formula (brief) | Saved? | Bug? |
|---|---|---|---|---|
| C1 | Current Rate | Note rate / index+margin (clamped) | ✅ | — |
| C2 | Regular Payment | Amortization formula (4 methods) | ✅ | — |
| C3 | Total Payment | Sum of payment components | ❌ display | — |
| C4 | Amount to Reinstate | Sum of all balance fields | ❌ display | — |
| C5 | Total Amount Due | Principal + interest + charges | ❌ display | — |
| C6 | Estimated Balloon | `P × (1 + rate/1200)` | ❌ display | — |
| C7 | Short Pay ↔ Dollar | `pct ↔ amount` via regular_payment | ✅ | — |
| C8 | Down Payment | `purchasePrice − loanAmount` | ✅ | — |
| C9 | Pledged Equity | `appraisedValue − loanAmount` | ✅ | — |
| C10 | Protective Equity | `appraisedValue − allLiens` | ✅ | — |
| C11 | Current LTV | `(principal / appraisedValue) × 100` | ✅ | — |
| C12 | CLTV | `(allLiens / appraisedValue) × 100` | ✅ | ⚠️ excludes current loan for junior lien |
| C13 | Origination LTV | User-entered (was auto-calc) | ✅ | ⚠️ was using mutable balance |
| C14 | Principal Paid | `origAmount − currentPrincipal` | ✅ | — |
| C15 | Remaining Balance (per lien) | Payoff/paydown/remain logic | internal | — |
| C16 | Lien Waterfall | Priority-sorted proceeds distribution | ✅ | — |
| C17 | Equity Summary | Senior/junior/total split | ✅ | — |
| C18 | Per-Lender Payment | `amount × rate/100 × days / 360` | ✅ | — |
| C19 | Servicer Income | `amount × spread/100 × days / 360` | ✅ | — |
| C20 | Pro Rata % | `(lenderAmt / totalLoan) × 100` | ✅ | — |
| C21 | Multi-lender Allocation | Penny-safe proportional split | ✅ | — |

---

## 3. Document Generation Calculations — World 2

> These calculations run on the **server** when "Generate Document" is clicked.
> They transform stored deal data into what the DOCX template needs.
> **Results go into the document only — never saved back to the database.**

---

### 3.1 Value Formatting Transforms

Applied to every field value before it is placed into the document.
Defined in `template_field_maps.transform_rule` per field per template.

| Transform Rule | Input Example | Output Example | Notes |
|---|---|---|---|
| `currency` | `500000.00` | `$500,000.00` | Dollar sign, thousand separators, always 2dp |
| `currency_no_cents` | `500000.00` | `$500,000` | No decimal places |
| `percentage` | `7.5000` | `7.500%` | Smart trailing-zero strip, % suffix |
| `percentage_2dp` | `76.9231` | `76.92%` | Exactly 2 decimal places |
| `date_mmddyyyy` | `2026-06-01` | `06/01/2026` | US short date format |
| `date_long` | `2026-06-01` | `June 1, 2026` | Full month name |
| `date_short` | `2026-06-01` | `Jun 1, 2026` | Abbreviated month name |
| `words` | `500000.00` | `Five Hundred Thousand Dollars` | Spelled out — used in promissory notes |
| `words_and_cents` | `3496.07` | `Three Thousand Four Hundred Ninety-Six and 07/100 Dollars` | Full legal dollar expression |
| `ssn_masked` | `123-45-6789` | `XXX-XX-6789` | Last 4 digits only |
| `phone_formatted` | `3105551234` | `(310) 555-1234` | Standard US phone format |
| `checkbox_yes_no` | `true` | `Yes` / `No` | Boolean to Yes/No text |
| `checkbox_x` | `true` | `X` or `` | Checkbox in forms |
| `uppercase` | `john smith` | `JOHN SMITH` | All caps |
| `number` | `500000.00` | `500000.00` | No $ or commas |
| `ordinal` | `1` | `1st` | 1st, 2nd, 3rd, etc. |

---

### 3.2 Bridge Functions

Bridge functions fetch data from other sources (not directly in deal field values) and inject it into the document data bag. They run at document generation time only.

#### B1 — Borrower Full Name Assembly
**Merge tags produced:** `{{br_p_fullName}}`
**Used by:** All templates referencing the borrower

```
Try in order (first non-empty value wins):
  1. borrower1.full_name              (pre-assembled stored value)
  2. borrower.full_name               (canonical key)
  3. br_p_firstName + " " + br_p_middleInitia + " " + br_p_lastName
  4. loan_terms.details_borrower_name (manually entered on loan terms form)
  5. deal.borrower_name               (deal-level name field)
```

#### B2 — Primary Lender Contact Bridge
**Source:** `deal_participants` → `contacts` table (not deal data)
**Merge tags produced:** `ld_p_firstName`, `ld_p_lastName`, `ld_p_middleName`, `ld_p_lenderName`, `ld_p_vesting`, `ld_p_firstIfEntityUse`, `lender.name`, `lender1.vesting`
**Used by:** All templates referencing the lender/investor

```
1. Query: deal_participants WHERE deal_id = X AND role = 'lender'
          ORDER BY sequence_order ASC LIMIT 1
          → primary lender's contact_id

2. Query: contacts WHERE id = contact_id
          → first_name, last_name, middle_initial, company_name, vesting_name

3. Build merge tags:
   ld_p_firstName       = contact.first_name
   ld_p_lastName        = contact.last_name
   ld_p_middleName      = contact.middle_initial
   ld_p_lenderName      = company_name (entity) OR first_name + " " + last_name (individual)
   ld_p_vesting         = vesting_name
   ld_p_firstIfEntityUse = company_name if entity, else first_name
   lender.name          = same as ld_p_lenderName
   lender1.vesting      = same as ld_p_vesting
```

#### B3 — RE885 Fee Aliases and Rate Type Flags
**Source:** Origination fee fields + rate structure flag
**Merge tags produced:** 15+ origination fee tags + rate type checkboxes + penalty flags
**Used by:** RE-885 Mortgage Loan Disclosure Statement

```
Field remapping (stored key → document merge tag):
  origination_fees.re885_subtotal_deductions  → of_re_subtotalDeductions
  origination_fees.interest_days              → of_int_days
  origination_fees.hazard_insurance_months    → of_haz_mon
  origination_fees.mi_months                  → of_mi_mon
  origination_fees.tax_months                 → of_tax_mon
  [+ all other RE885 fee line items...]

Rate type checkboxes (exactly one = "X", others = ""):
  is_frm = rate_structure === 'frm_fixed_rate'  ? "X" : ""
  is_arm = rate_structure === 'arm_adjustable_rate' ? "X" : ""
  is_gtm = rate_structure === 'gtm_graduated_terms' ? "X" : ""

Prepayment penalty flags:
  has_prepayment_penalty = prepayment_penalty_enabled === true  ? "X" : ""
  no_prepayment_penalty  = prepayment_penalty_enabled !== true  ? "X" : ""
```

#### B4 — RE851D Property Loop Assembly
**Source:** Property fields + lien fields (indexed: property1, property2, lien1, lien2, ...)
**Merge tags produced:** `properties[]` array for template loop
**Used by:** RE-851D Schedule of Real Property

```
For each property (property1, property2, ...):

  Collect:
    - Address, city, state, ZIP
    - Appraised value (estimate of value)
    - Property type → determine type checkboxes
    - All liens associated with this property

  Compute encumbrances:
    senior_encumbrances  = sum(balance of all liens with priority < this loan)
    total_encumbrances   = sum(balance of ALL liens including this loan)
    expected_encumbrances = encumbrances after applying payoff/paydown/remain

  Compute per-property ratios:
    ln_p_loanToValueRatio = (total_encumbrances / appraised_value) × 100
    ln_p_amountOfEquity   = appraised_value − total_encumbrances

  Collect property tax records

Output structure per property:
  {
    pr_p_address:            "123 Main St, Los Angeles, CA 90001",
    ln_p_loanToValueRatio:   "76.92",
    ln_p_amountOfEquity:     "150,000.00",
    ln_p_remainingEncumbrance: "500,000.00",
    pr_p_propertyType_sfr:   "X",   (or other type checkbox)
    ...tax fields...
  }

Rollup totals (outside the property loop):
  ln_totalEquitySecuringLoan = sum of equity across all properties
  ln_p_totalEncumbrance      = sum of encumbrances across all properties
```

**Template syntax:**
```
{{#properties}}
  {{pr_p_address}}
  {{ln_p_loanToValueRatio}}%
  {{ln_p_amountOfEquity}}
  {{pr_p_propertyType_sfr}}
{{/properties}}
Total equity: {{ln_totalEquitySecuringLoan}}
```

#### B5 — Current Date Injection
**Merge tag produced:** `{{currentDate}}`
**Used by:** All templates

```
currentDate = format(today, 'MMMM D, YYYY')
            → "June 3, 2026"
```

#### B6 — Nested Object Building
**Purpose:** Convert flat field keys to nested objects for dot-notation template access
**Used by:** New-style templates using `{{broker.first_name}}` syntax

```
Input (flat field keys):
  { "broker.first_name": "Mary", "broker.company": "ABC Lending" }

Output (nested):
  { broker: { first_name: "Mary", company: "ABC Lending" } }
```

---

### 3.3 Per-Template Calculations

Specific calculations run only when generating a particular template type.

#### T1 — RE-851D: Per-Property LTV
**Template:** RE-851D Schedule of Real Property
**Merge tag:** `{{ln_p_loanToValueRatio}}` (inside properties loop)

```
per_property_ltv = (total_lien_encumbrances_on_property / appraised_value) × 100

total_lien_encumbrances = sum of all lien balances on this property
                          (after applying payoff/paydown/remain dispositions)
```

#### T2 — RE-851D: Per-Property Equity
**Template:** RE-851D Schedule of Real Property
**Merge tag:** `{{ln_p_amountOfEquity}}` (inside properties loop)

```
per_property_equity = appraised_value − total_lien_encumbrances
```

#### T3 — RE-851D: Total Equity Securing Loan
**Template:** RE-851D Schedule of Real Property
**Merge tag:** `{{ln_totalEquitySecuringLoan}}`

```
total_equity_securing_loan = sum of per_property_equity across all properties
```

#### T4 — RE-851D: Property Type Checkboxes
**Template:** RE-851D Schedule of Real Property
**Merge tags:** `{{pr_p_propertyType_sfr}}`, `{{pr_p_propertyType_mf}}`, `{{pr_p_propertyType_commercial}}`, etc.

```
Infer property type from raw text value of appraisal_property_type:
  Contains "SFR", "single family", "1-4"   → pr_p_propertyType_sfr = "X"
  Contains "multi", "2-4"                  → pr_p_propertyType_mf = "X"
  Contains "condo", "townhouse"             → pr_p_propertyType_condo = "X"
  Contains "commercial"                    → pr_p_propertyType_commercial = "X"
  Contains "land"                          → pr_p_propertyType_land = "X"
  Contains "mobile"                        → pr_p_propertyType_mobile = "X"
  No match                                 → pr_p_propertyType_other = "X"
```

#### T5 — RE-885: Proposed Initial Payment (Section VII)
**Template:** RE-885 Mortgage Loan Disclosure Statement
**Merge tag:** `{{of_re_proposedInitialPayment}}`

```
Uses computeBorrowerScheduledPayment() with:
  principal    = loan_terms.loan_amount
  annualRate   = loan_terms.note_rate
  termMonths   = loan_terms.number_of_payments
  amortization = loan_terms.amortization
  frequency    = loan_terms.payment_frequency

Same formula as C2 (Regular Payment in World 1).
```

*This is the same regular payment calculation — recalculated at doc-gen time to ensure the document matches the loan terms at time of generation, even if the stored payment value is stale.*

#### T6 — RE-885: Section VII Borrower Payment Description
**Template:** RE-885 Mortgage Loan Disclosure Statement
**Merge tags:** Payment amount + frequency label + amortization description

```
Amortization description text:
  fully_amortized:    "fully amortizing"
  interest_only:      "interest only"
  partially_amortized: "partially amortizing with balloon"
  constant_amortization: "constant principal reduction"
  add_on_interest:    "add-on interest"
```

---

### World 2 Summary

| # | Category | What It Produces | Templates |
|---|---|---|---|
| F1–F16 | Value Formatting | Print-ready currency, dates, %, text | All templates |
| B1 | Borrower Full Name | `{{br_p_fullName}}` | All borrower templates |
| B2 | Lender Contact Bridge | `{{ld_p_firstName}}`, `{{ld_p_lenderName}}`, etc. | All lender templates |
| B3 | RE885 Fee Aliases | `{{of_re_subtotalDeductions}}` + 14 others | RE-885 |
| B3 | RE885 Rate Type Flags | `{{is_frm}}`, `{{is_arm}}`, `{{is_gtm}}` | RE-885 |
| B3 | RE885 Penalty Flags | `{{has_prepayment_penalty}}` | RE-885 |
| B4 | RE851D Property Loop | `{{#properties}}...{{/properties}}` | RE-851D |
| B5 | Current Date | `{{currentDate}}` | All templates |
| B6 | Nested Objects | `{{broker.first_name}}` | New-style templates |
| T1 | RE851D Per-property LTV | `{{ln_p_loanToValueRatio}}` | RE-851D |
| T2 | RE851D Per-property Equity | `{{ln_p_amountOfEquity}}` | RE-851D |
| T3 | RE851D Total Equity | `{{ln_totalEquitySecuringLoan}}` | RE-851D |
| T4 | RE851D Property Type | `{{pr_p_propertyType_sfr}}` etc. | RE-851D |
| T5 | RE885 Proposed Payment | `{{of_re_proposedInitialPayment}}` | RE-885 |
| T6 | RE885 Payment Description | Amortization text | RE-885 |

---

## 4. Known Bugs & Missing Items

Use this section as a checklist for the team review.

### Confirmed Bugs

| # | Description | Location | Correct Formula |
|---|---|---|---|
| BUG-1 | **CLTV excludes current loan for junior lien** | `PropertyDetailsForm.tsx:161` | `(existingLienBalances + thisLoanAmount) / appraisedValue × 100` |
| BUG-2 | **Origination LTV used mutable balance** | `PropertyDetailsForm.tsx:120` | Use `loan_terms.original_loan_amount` not `loan_terms.loan_amount` |
| BUG-3 | **Funding payment: interest-only formula despite amortization docstring** | `LoanTermsFundingForm.tsx:44` | Use `computeAmortizedPayment(amount, rate, remainingPayments)` |
| BUG-4 | **BorrowerPortfolio: hardcoded DB UUIDs** | `BorrowerPortfolio.tsx:168` | Look up by `field_key` string, not hardcoded UUID |
| BUG-5 | **Contact form doesn't re-sync when parent re-fetches** | `ContactBorrowerDetailLayout.tsx:68` | Add `useEffect` to re-sync when `contact.contact_data` changes |
| BUG-6 | **Tab data never re-fetches after initial load** | `useDealFields.ts:331` | Reset `hasLoadedRef` and call `refetchData()` after any save |

### Missing / Unverified Items

| # | Description | Risk Level |
|---|---|---|
| MISS-1 | `merge_tag_aliases` table not confirmed seeded on migration_v1 DB — all legacy template tags fail to resolve if empty | 🔴 Critical |
| MISS-2 | `field_key_migrations` table not confirmed seeded — old-format tags in templates won't resolve | 🔴 Critical |
| MISS-3 | `field_dictionary.is_calculated` rows not seeded — formula engine exists but no fields drive it | 🟡 Medium |
| MISS-4 | Lender payment (`computeLenderRow` output) has no field key or merge tag mapping — cannot appear in any template | 🟡 Medium |
| MISS-5 | Lien waterfall results (`distributePayoff`) have no template path — UI-only | 🟡 Medium |
| MISS-6 | No validation at template upload that checks for unresolvable merge tags | 🟠 Low |
| MISS-7 | RE851D: if template lacks `{{#properties}}` loop block, `buildRe851dPropertiesArray()` output is silently unused | 🟠 Low |
| MISS-8 | Dropdown options hardcoded in components — changing an option requires finding and editing every form that uses it | 🟠 Low |

---

## Appendix: Precision Rules

| Data Type | Storage | Display | Rounding |
|---|---|---|---|
| **Currency** | 2dp | `$1,234.56` (always 2dp) | HALF_UP (HALF_EVEN for lender rows) |
| **Interest Rate** | 4dp | 2dp min, 3dp max, trim trailing zeros | HALF_UP |
| **Pro Rata %** | 4dp | 2dp min, 4dp max, trim trailing zeros | HALF_UP |
| **LTV / CLTV / Equity %** | 4dp | Always exactly 2dp | HALF_UP |
| **Late Charge %** | 4dp | 2dp min, 3dp max, trim trailing zeros | HALF_UP |
| **Date** | `YYYY-MM-DD` | `MM/DD/YYYY` or `Month D, YYYY` | n/a |

All financial arithmetic uses `decimal.js` (28 significant digits precision). Native JavaScript floats are never used for money or rate calculations.

---

*Document generated from codebase analysis — Branch: `main`*
*For architecture details and data flow, see `LOAN_SYSTEM_KNOWLEDGE_BASE.md`*

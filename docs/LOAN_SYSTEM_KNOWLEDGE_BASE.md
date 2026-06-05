# Loan Servicing System — Complete Knowledge Base

> **Purpose:** This document provides a complete reference for the loan data model, field structure,
> calculation engine, and document generation pipeline. It is intended for developers, QA, and
> anyone who needs to understand how deal data flows from user input to generated documents.
>
> **Branch baseline:** `main` (calculations) + `migration_v1` (NestJS backend architecture)
> **Last updated:** 2026-06-02

---

## Table of Contents

1. [Loan Terminology Dictionary](#1-loan-terminology-dictionary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Deal Data Model — How Data Is Stored](#3-deal-data-model--how-data-is-stored)
4. [Deal Tabs & Sections — Every Field Explained](#4-deal-tabs--sections--every-field-explained)
   - [Tab 1: Loan Terms — Details](#tab-1-loan-terms--details)
   - [Tab 1: Loan Terms — Balances](#tab-1-loan-terms--balances)
   - [Tab 1: Loan Terms — Funding](#tab-1-loan-terms--funding)
   - [Tab 2: Property](#tab-2-property)
   - [Tab 3: Liens](#tab-3-liens)
   - [Tab 4: Charges](#tab-4-charges)
   - [Tab 5: Borrower / Co-Borrower / Contacts](#tab-5-borrower--co-borrower--contacts)
5. [All Dropdown Options](#5-all-dropdown-options)
6. [World 1 — UI Calculations (Browser)](#6-world-1--ui-calculations-browser)
7. [World 2 — Document Generation Calculations (Server)](#7-world-2--document-generation-calculations-server)
8. [Complete Data Flow: Input → Storage → Document](#8-complete-data-flow-input--storage--document)
9. [Document Generation Pipeline](#9-document-generation-pipeline)
10. [Template System & Merge Tags](#10-template-system--merge-tags)
11. [Field Key Resolution Chain](#11-field-key-resolution-chain)
12. [Precision & Rounding Rules](#12-precision--rounding-rules)
13. [Current Architecture Pain Points](#13-current-architecture-pain-points)
14. [Proposed Clean Architecture](#14-proposed-clean-architecture)

---

## 1. Loan Terminology Dictionary

Every loan-related term used in the system, explained in plain English.

| Term | Plain English Meaning |
|---|---|
| **Principal / Loan Amount** | The amount of money borrowed. If you borrow $500,000, that is your principal. Decreases as payments are made. |
| **Note Rate** | The interest rate written in the promissory note — what the borrower legally agreed to pay per year. Example: 7.5% means 7.5% of the outstanding balance per year. |
| **Sold Rate** | When a loan company sells/assigns the loan to an investor, the investor may receive a specific rate. The "sold rate" is that rate. Example: Note Rate = 7.5%, Sold Rate = 7.0%, Servicer keeps 0.5% spread. |
| **Lender Rate** | The rate each individual investor in a multi-lender loan actually earns. Can differ per lender. Falls back to note rate if not set. |
| **Servicer Income / Spread** | `Note Rate − Lender Rate`. The loan servicer keeps this as income for managing the loan. |
| **Amortization** | How the loan balance pays down over time. Fully amortized = every payment reduces both interest AND principal, balance reaches zero at end. Interest-only = payments cover only interest, balance never reduces. |
| **Term** | The life of the loan in months. A 30-year loan = 360 months. |
| **Maturity Date** | The date the loan must be fully paid off. The entire remaining balance is due on this date. |
| **Balloon Payment** | Some loans don't fully amortize. At maturity, a large lump sum ("balloon") is still owed. Example: amortized over 30 years but due in 5 years — the remaining balance after 5 years is the balloon. |
| **LTV (Loan-to-Value)** | `(Loan Amount ÷ Property Value) × 100`. Measures risk. 80% LTV = loan is 80% of what the property is worth. Lower LTV = safer for lender (more equity cushion). |
| **CLTV (Combined LTV)** | When multiple loans exist on one property: `(All Loans Combined ÷ Property Value) × 100`. Example: 1st loan $400K + 2nd loan $100K on a $650K property = 76.9% CLTV. |
| **Origination LTV** | LTV at the time the loan was originally made. Frozen — does not change as payments reduce the balance. |
| **Current LTV** | LTV today, using the current outstanding principal. Improves (decreases) as the loan pays down. |
| **Protective Equity** | `Property Value − All Senior Liens`. What's left of property value after paying off everyone who ranks above this lender. The safety cushion. |
| **Pledged Equity** | `Property Value − This Loan Amount`. Property value beyond the loan amount pledged as security. |
| **Lien** | A legal claim against a property. When you take out a mortgage, the lender has a lien on your home. If you don't pay, they can foreclose and sell it. |
| **Lien Position / Priority** | Who gets paid first if the property is sold. 1st lien = first to get paid. 2nd lien gets paid only after 1st is fully paid. If sale proceeds run out, lower-priority lienholders may get nothing. |
| **Senior Lien** | A lien with higher priority than this loan. Gets paid before this loan in a sale. |
| **Junior Lien** | A lien with lower priority than this loan. Gets paid after this loan. |
| **Deed of Trust** | Legal document creating a lien on the property. In California and many states, replaces a mortgage. Three parties: borrower (trustor), lender (beneficiary), neutral trustee. |
| **Recording Date** | Date the lien was officially registered with the county recorder's office. Establishes legal priority order. |
| **Pro Rata** | Each lender's percentage share of the total loan. If Lender A funded $300K and Lender B funded $200K on a $500K loan, Lender A is 60% pro rata, Lender B is 40%. Payments split proportionally. |
| **Day Count Basis** | How interest accrual days are counted. Actual/360 = actual calendar days ÷ 360. Actual/365 = actual calendar days ÷ 365. |
| **Regular Payment** | Scheduled payment each period. Covers interest and (for amortizing loans) some principal. |
| **Payment Frequency** | How often payments are due: monthly, bi-weekly, weekly, quarterly, semi-annually, annually. |
| **First Payment Due** | Date of the first scheduled payment, usually one period after origination. |
| **Paid To Date** | The date through which the loan is considered current on payments. |
| **Next Payment Due** | The next scheduled payment date. |
| **FRM (Fixed Rate Mortgage)** | Note rate stays the same for the entire loan life. |
| **ARM (Adjustable Rate Mortgage)** | Note rate changes based on a market index. Current Rate = Index Rate + Margin. Subject to floor and ceiling caps. |
| **GTM (Graduated Terms Mortgage)** | Rate or payment increases on a predetermined schedule. |
| **Index Rate** | For ARM loans — the base market benchmark (e.g., SOFR). Changes with the market. |
| **Margin** | For ARM loans — the fixed percentage added to the index. If margin = 2.5% and index = 5.0%, rate = 7.5%. |
| **Rate Floor** | Minimum rate an ARM can adjust to, regardless of how low the index falls. |
| **Fully Indexed Rate** | Index Rate + Margin. The ARM's theoretical current rate before applying any caps. |
| **Impound / Escrow** | Money collected monthly with payments and held to pay property taxes and insurance. Lender ensures bills are paid from this account. |
| **Suspense Balance** | Partial or unidentified payments held in a holding account until enough accumulates for a full payment or until identified. |
| **Reserve Balance** | Funds held back by the servicer for the lender's future expenses or as a reserve fund. |
| **Late Charge** | Fee charged when a payment arrives after the grace period (typically 10-15 days after due date). |
| **Default Interest** | A higher penalty interest rate applied when the borrower is in default (not paying). Usually significantly higher than the note rate. |
| **Interest Guarantee** | A contractual minimum amount of interest owed to the lender regardless of prepayment. |
| **Reinstatement** | Bringing a delinquent loan current by paying all past-due amounts, late charges, and fees — without paying off the full loan balance. |
| **Accrued Interest** | Interest that has built up since the last payment but hasn't been formally charged yet. |
| **Unpaid Interest** | Interest that was formally due and charged but not paid by the borrower. |
| **Origination Fees** | Fees charged to the borrower at loan closing (points, appraisal fee, title insurance, escrow fee, etc.). |
| **RE-885** | California disclosure form (Mortgage Loan Disclosure Statement) listing all origination fees and loan terms. Required by law for certain loans. |
| **RE-851D** | California form recording all properties securing a loan, with their values, lien positions, and LTV ratios. |
| **Multi-lender** | A single loan funded by multiple investors. Each investor owns a pro-rata share. All share in payments proportionally. |
| **Seller Carry** | The property seller acts as the lender — financing the purchase directly instead of a bank. |
| **AITD / Wrap** | All-Inclusive Trust Deed (wraparound). A second loan that wraps around the first. Borrower makes one payment to the 2nd lender who then pays the 1st lender's underlying loan. |
| **Cross-Collateral** | One loan secured by multiple properties simultaneously. If one property's value is insufficient, other properties can cover the debt. |
| **RESPA** | Real Estate Settlement Procedures Act. Federal law governing consumer mortgage disclosures and closing procedures. |
| **SCRA** | Servicemembers Civil Relief Act. Protections for active-duty military borrowers including interest rate caps at 6% and foreclosure protections. |
| **Charge** | Money advanced by the servicer on the borrower's behalf (e.g., paying property taxes when borrower didn't, forced-placed insurance). Becomes a debt the borrower owes. |
| **SLT (Senior Lien Tracking)** | Active monitoring of higher-priority liens on the property. Critical: if a senior lien goes into foreclosure, it can wipe out this lender's interest. SLT tracks payment status, delinquencies, and foreclosure proceedings. |
| **Forbearance** | Temporary agreement to suspend or reduce payments while the borrower faces hardship. Interest usually still accrues. |
| **Modification** | A permanent change to the loan terms (rate, term, or balance) to help a struggling borrower. |
| **Bankruptcy** | Borrower has filed for bankruptcy protection. Automatic stay prevents collection actions. |
| **Foreclosure** | Legal process by which lender takes ownership of the property after borrower defaults. |
| **Payoff** | Paying the entire remaining loan balance, ending the loan and releasing the lien. |
| **Boarding** | The process of adding a new loan to the servicing system. |
| **Interest-Only Period** | Phase where borrower pays only interest — no principal reduction. Common in construction loans or early phases of some ARMs. |
| **Constant Amortization** | Equal principal payment each period (declining payment schedule — each payment gets slightly smaller as the interest portion decreases). |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REACT FRONTEND                               │
│                                                                     │
│  Deal Entry Page                                                    │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┬──────────┐ │
│  │  Borrower│Loan Terms│ Property │  Liens   │Charges │Documents │ │
│  └──────────┴──────────┴──────────┴──────────┴────────┴──────────┘ │
│         │                    │                                      │
│   WORLD 1 CALCULATIONS       │                                      │
│   (browser, instant)         │                                      │
│   LTV, payment, equity, etc. │                                      │
│         │                    │                                      │
└─────────┼────────────────────┼──────────────────────────────────────┘
          │ save               │
          ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        DATABASE (Supabase/PostgreSQL)               │
│                                                                     │
│  deal_section_values (JSONB) ← primary data store                  │
│  field_dictionary            ← field metadata registry             │
│  merge_tag_aliases           ← old tag → new field_key mapping     │
│  field_key_migrations        ← renamed key → current key           │
│  template_field_maps         ← which fields each template needs    │
│  templates                   ← DOCX file locations                 │
│  generated_documents         ← output records                      │
│  generation_jobs             ← job tracking                        │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ generate document
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     NESTJS BACKEND (migration_v1)                   │
│                                                                     │
│  GenerationService                                                  │
│  ├── DealFieldValuesLoader  ← load all deal data from DB           │
│  ├── applyBridges()         ← fetch lender contacts, RE885 aliases │
│  ├── DocumentDataService    ← format values for templates          │
│  └── DocxtemplaterService   ← render DOCX from template + data     │
│                                                                     │
│   WORLD 2 CALCULATIONS                                              │
│   (server, at generation time only)                                 │
│   Format, bridge, alias, aggregate                                  │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
     Generated DOCX File (stored in Supabase Storage)
```

### The Two Worlds — Key Distinction

| | **World 1 — UI Calculations** | **World 2 — Document Calculations** |
|---|---|---|
| **When** | Every keystroke while user edits | Once when "Generate Document" is clicked |
| **Where** | Browser (React components) | Server (NestJS backend) |
| **Input** | What the user just typed | Saved deal data from the database |
| **Output** | Numbers shown on screen | Values placed inside the DOCX file |
| **Examples** | LTV on screen, payment in grid, equity in lien table | `$500,000.00` formatted for print, lender name from contacts table, property loop for RE851D |
| **Saved to DB?** | ✅ Yes — results become part of deal data | ❌ No — goes directly into the document |
| **Affects document?** | Indirectly (saved value is later read at generation) | ✅ Directly |

---

## 3. Deal Data Model — How Data Is Stored

### Primary Storage: `deal_section_values`

All deal data lives in one JSONB document per deal-section combination:

```sql
deal_section_values:
  deal_id   UUID        -- which deal
  section   TEXT        -- 'borrower', 'loan_terms', 'property', etc.
  field_values JSONB    -- the actual data

-- field_values structure:
{
  "{prefix}::{field_dictionary_id}": {
    "indexed_key": "borrower1.first_name",   -- human-readable key
    "value_text":  "John",                   -- text fields
    "value_number": null,                    -- numeric fields
    "value_date":   null,                    -- date fields
    "value_json":   null,                    -- JSON fields (arrays, objects)
    "updated_at":   "2026-06-01T10:00:00Z"
  },
  ...
}
```

### Field Key Format

Every field has a canonical key in the format `{section}.{field_name}`:

```
borrower.first_name           -- single entity field
borrower1.first_name          -- indexed (first of multiple borrowers)
borrower2.first_name          -- second borrower
lender1.company_name          -- first lender in multi-lender loan
property1.appraised_value     -- first property
lien1.current_balance         -- first lien
charge1.original_amount       -- first charge
```

### Field Dictionary (`field_dictionary` table)

The master registry of every field in the system:

```
field_key:                  "loan_terms.loan_amount"
label:                      "Loan Amount"
section:                    "loan_terms"
data_type:                  "currency"
is_calculated:              false
calculation_formula:        null        -- formula if calculated
calculation_dependencies:   []          -- field_keys this depends on
canonical_key:              "ln_p_loanAmount"  -- backward-compat alias
```

### Merge Tag Aliases (`merge_tag_aliases` table)

Maps old template placeholder names to new field keys:

```
tag_name:   "br_p_firstName"
field_key:  "borrower.first_name"
tag_type:   "merge_tag"
```

### Field Key Migrations (`field_key_migrations` table)

Maps renamed field keys to their current names:

```
old_key:  "ln_pn_loanAmount"
new_key:  "loan_terms.loan_amount"
```

---

## 4. Deal Tabs & Sections — Every Field Explained

---

### Tab 1: Loan Terms — Details

*Administrative and structural information about the loan.*

#### Details Column

| Field Key | Label | Type | Description |
|---|---|---|---|
| `loan_terms.loan_number` | Loan Number | text (14 chars) | Unique identifier in the servicing system |
| `loan_terms.company_id` | Company ID | text | Internal company identifier |
| `loan_terms.previous_loan_number` | Previous Loan Number | text | Prior servicer's loan number (if transferred in) |
| `loan_terms.lien_position` | Lien Position | dropdown | This loan's legal priority: 1st, 2nd, 3rd, or other |
| `loan_terms.details_originating_vendor` | Originating Vendor | dropdown (dynamic) | Broker or originator who brought this loan — loaded from contacts |
| `loan_terms.original_balance` | Original Loan Amount | currency | Amount funded at origination — never changes after boarding |
| `loan_terms.loan_purpose` | Loan Purpose | dropdown | "consumer" (personal use) or "business" — affects disclosure laws |
| `loan_terms.origination` | Origination Date | date | Date the loan was created and money was sent to borrower |
| `loan_terms.recording_date` | Recording Date | date | Date the deed of trust was filed with the county recorder |
| `loan_terms.recording_number` | Recording Number | text | County's document reference number |
| `loan_terms.maturity_date` | Maturity / DIF Date | date | Date entire balance is due; must be future and after first payment |
| `loan_terms.boarding` | Boarding Date | date | Date this loan was entered into the servicing system |
| `loan_terms.rate_structure` | Rate Structure | dropdown | FRM (fixed), ARM (adjustable index-based), or GTM (graduated) |
| `loan_terms.amortization` | Amortization | dropdown | How the loan pays down over its life |
| `loan_terms.current_rate` | Current Rate | % **CALCULATED** | Effective rate right now — derived from rate structure (see W1-1) |
| `loan_terms.day_due` | Day Due | integer 1–31 | Day of month payments are due |
| `loan_terms.interest_calculation` | Interest Calculation | dropdown | 360-day or 365-day basis |
| `loan_terms.calculation_period` | Calculation Period | dropdown | Standard due-to-due, actual due-to-due, or received-to-received |

#### Loan Category Flags (Checkboxes)

These describe the nature of the loan. Multiple can be true simultaneously.

| Field Key | Label | What It Means |
|---|---|---|
| `loan_terms.owner_occupied` | Owner Occupied | Borrower lives in the property — stricter consumer protections apply |
| `loan_terms.multi_lender` | Multi-lender | Multiple investors funded this loan together |
| `loan_terms.seller_carry` | Seller Carry | Property seller is financing the purchase (no bank involved) |
| `loan_terms.aitd_wrap` | AITD / Wrap | Wraparound trust deed — second loan that wraps around an existing first |
| `loan_terms.rehab_construction` | Rehab / Construction | Funds are being used for renovation or building |
| `loan_terms.variable_arm` | Variable / ARM | Interest rate adjusts over time based on market index |
| `loan_terms.respa` | RESPA / Consumer | Subject to federal consumer mortgage disclosure requirements |
| `loan_terms.balloon_payment` | Balloon Payment | A large lump-sum payment is required at end of term |
| `loan_terms.cross_collateral` | Cross Collateral | Multiple properties secure this one loan |
| `loan_terms.limited_no_doc` | Limited / No Documentation | Loan was made with reduced income/asset documentation |
| `loan_terms.subordination_provision` | Subordination Provision | This lien can be voluntarily subordinated to a new first lien |
| `loan_terms.status_military_scra` | Military SCRA | Borrower is active military — rate capped at 6%, foreclosure restricted |

#### Loan Status

| Field Key | Label | Description |
|---|---|---|
| `loan_terms.loan_status` | Loan Status | blank / active / hold / closed |
| `loan_terms.hold_reason` | Hold Reason | Why the loan is on hold (conditional on status=hold) |
| `loan_terms.closed_reason` | Closed Reason | Why the loan was closed (conditional on status=closed) |
| `loan_terms.status_bankruptcy` | Bankruptcy | Borrower has filed for bankruptcy |
| `loan_terms.status_foreclosure` | Foreclosure | Foreclosure proceedings are active |
| `loan_terms.status_modification` | Modification | Loan terms have been or are being modified |
| `loan_terms.status_forbearance` | Forbearance | Temporary payment suspension/reduction agreement |
| `loan_terms.status_litigation` | Litigation | Active lawsuit involving this loan |

#### ARM Fields (shown only when Rate Structure = ARM)

| Field Key | Label | Description |
|---|---|---|
| `loan_terms.arm_index_rate` | Index Rate | Current market benchmark (e.g., SOFR, Prime) |
| `loan_terms.arm_margin` | Margin | Fixed spread added to index. Current Rate = Index + Margin |
| `loan_terms.arm_rate_floor` | Rate Floor | Minimum rate — cannot go below this regardless of index |
| `loan_terms.adj_max_interest_rate` | Maximum Interest Rate | Rate ceiling — cannot exceed this regardless of index |
| `loan_terms.adj_fully_indexed_rate` | Fully Indexed Rate | Index + Margin (theoretical rate before caps) |
| `loan_terms.adj_initial_rate_months` | Initial Rate Period | How many months the initial fixed rate applies before first adjustment |
| `loan_terms.adj_rate_increase_percent` | Rate Increase Per Period | Maximum rate change per adjustment interval |
| `loan_terms.adj_rate_increase_months` | Adjustment Interval | How often the rate adjusts (in months) |
| `loan_terms.adj_proposed_initial_payment` | Proposed Initial Payment | Minimum payment amount in initial period |
| `loan_terms.adj_final_payment_amount` | Final Payment Amount | Payment amount after payment options end |
| `loan_terms.adj_final_payment_months` | Final Payment Months | How many months at final payment remain |

---

### Tab 1: Loan Terms — Balances

*Current financial state of the loan — balances, payments, and totals.*

#### Loan Configuration

| Field Key | Label | Type | Description |
|---|---|---|---|
| `loan_terms.original_amount` | Original Loan Amount | currency | Amount funded at origination — the starting principal |
| `loan_terms.note_rate` | Note Rate | % | Interest rate the borrower pays per year (in the promissory note) |
| `loan_terms.sold_rate_company` | Sold Rate | % | Rate earned by the investor the loan was sold to (if applicable). Enable checkbox prefills all lender rows with this rate |
| `loan_terms.number_of_payments` | Number of Payments | integer | Total scheduled payment periods (e.g., 360 for a 30-year monthly loan) |
| `loan_terms.payment_frequency` | Payment Frequency | dropdown | How often payments are made |
| `loan_terms.first_payment` | First Payment Due | date | Date of first scheduled payment |
| `loan_terms.regular_payment` | Regular Payment | currency **AUTO-CALC** | Scheduled payment per period — computed via amortization formula |
| `loan_terms.total_payment` | Total Payment | currency **DISPLAY ONLY** | Sum of all payment components |

#### Current Balance Fields

| Field Key | Label | Type | Description |
|---|---|---|---|
| `loan_terms.principal` | Principal Balance | currency | Outstanding loan balance today — decreases with each payment |
| `loan_terms.unpaid_late_charges` | Unpaid Late Charges | currency | Late fees formally assessed but not yet paid |
| `loan_terms.accrued_late_charges` | Accrued Late Charges | currency | Late fees building up (not yet formally assessed) |
| `loan_terms.unpaid_interest` | Unpaid Interest | currency | Interest that was due and charged but borrower didn't pay |
| `loan_terms.accrued_interest` | Accrued Interest | currency | Interest accumulating since last payment (not yet charged) |
| `loan_terms.interest_guarantee` | Interest Guarantee | currency | Minimum interest contractually owed regardless of prepayment |
| `loan_terms.unpaid_default_interest` | Unpaid Default Interest | currency | Penalty-rate interest that was charged but not paid |
| `loan_terms.accrued_default_interest` | Accrued Default Interest | currency | Penalty-rate interest building up |
| `loan_terms.charges_owed` | Charges Owed | currency | Advances made by servicer on borrower's behalf (taxes, insurance) |
| `loan_terms.charges_interest` | Interest on Charges | currency | Interest accruing on outstanding charges |
| `loan_terms.unpaid_other` | Unpaid Other Payments | currency | Other unpaid scheduled payments |
| `loan_terms.reserve_balance` | Reserve Balance | currency | Funds held in reserve account for future expenses |
| `loan_terms.escrow_balance` | Escrow Balance | currency | Tax and insurance impound account balance |
| `loan_terms.suspense_funds` | Suspense Balance | currency | Partial/unidentified payments held in suspense |

#### Display-Only Calculated Totals (not saved)

| Label | Formula | Description |
|---|---|---|
| Amount to Reinstate | Sum of all balance fields | Total needed to bring a delinquent loan current without paying it off |
| Total Amount Due | Principal + unpaid interest + accrued interest + charges + other | Simplified payoff (excludes late and default charges) |
| Estimated Balloon | `loanAmount × (1 + rate/1200)` | Rough estimate of what would be owed at maturity (1 month extra interest) |

---

### Tab 1: Loan Terms — Funding

*Who funded the loan and in what amounts. Used for multi-lender loans.*

The funding grid has one row per lender. Data is stored as a JSON array in `loan_terms.funding_records`.

#### Per-Row Funding Fields

| Column | Key (in record) | Type | Description |
|---|---|---|---|
| Funding Date | `fundingDate` | date | Date this lender's money was wired or transferred |
| Lender Account | `lenderAccount` | text | This lender's account/investor ID |
| Lender Name | `lenderName` | text | Investor's name |
| Amount Funded | `originalAmount` | currency | Dollar amount this lender contributed |
| Pro Rata % | `pctOwned` | % **AUTO-CALC** | This lender's share: `(amount ÷ total loan) × 100` |
| Lender Rate | `lenderRate` | % | Rate this specific lender earns (note rate, sold rate, or custom) |
| Interest From | `interestFrom` | date | Date from which interest starts accruing for this lender |
| Payment | `regularPayment` | currency **AUTO-CALC** | Daily accrual payment: `amount × rate/100 × days ÷ 360` |
| Servicer Income | `servicerIncome` | currency **AUTO-CALC** | Servicer spread: `amount × (noteRate − lenderRate)/100 × days ÷ 360` |
| Rounding Adj. | `roundingAdjustment` | boolean | This lender absorbs penny-rounding differences (only ONE per loan) |

#### Rate Selection Options per Lender

| Value | Meaning |
|---|---|
| `note_rate` | Lender earns the same rate as the promissory note |
| `sold_rate` | Lender earns the sold rate (if loan was sold to an investor) |
| `lender_rate` | Custom override rate negotiated with this specific lender |

---

### Tab 2: Property

*The real estate collateral securing the loan.*

#### Property Identity

| Field Key | Label | Type | Description |
|---|---|---|---|
| `property1.description` | Description (Nickname) | text | Informal name for this property (e.g., "Main Street Commercial") |
| `property1.property_owner` | Property Owner | dropdown | Which borrower on this deal owns this property |
| `property1.primary_collateral` | Primary Collateral | checkbox | Is this the main property securing the loan? |
| `property1.street` | Street | text | Property address line 1 |
| `property1.city` | City | text | City |
| `property1.state` | State | dropdown | US state |
| `property1.zip` | ZIP Code | text | ZIP code (validated format) |
| `property1.county` | County | text | County name (important for recording and taxes) |
| `property1.copy_borrower_address` | Copy Borrower's Address | checkbox | Auto-fills address from primary borrower's address |

#### Property Characteristics

| Field Key | Label | Type | Description |
|---|---|---|---|
| `property1.appraisal_property_type` | Property Type | dropdown | Type of real estate |
| `property1.appraisal_occupancy` | Occupancy | dropdown | Who uses the property |
| `property1.year_built` | Year Built | integer | Year the building was constructed |
| `property1.square_feet` | Square Feet | number | Building size |
| `property1.construction_type` | Construction Type | dropdown | Building material / structure type |
| `property1.zoning` | Zoning | dropdown | Legal permitted uses for the land/building |
| `property1.flood_zone` | Flood Zone | checkbox | Property is in FEMA flood zone — flood insurance required |
| `property1.fire_zone` | Fire Zone | checkbox | Property is in high fire hazard zone |
| `property1.net_monthly_income` | Net Monthly Income | currency | Monthly rental income (for income-producing properties) |

#### Purchase Information

| Field Key | Label | Type | Description |
|---|---|---|---|
| `property1.purchase_date` | Purchase Date | date | When the borrower acquired this property |
| `property1.purchase_price` | Purchase Price | currency | Price paid to acquire the property |
| `property1.down_payment` | Down Payment | currency **AUTO-CALC** | `purchasePrice − loanAmount` — borrower's cash contribution |

#### Valuation

| Field Key | Label | Type | Description |
|---|---|---|---|
| `property1.appraised_value` | Estimate of Value | currency | Current appraised or estimated market value. **Used for all LTV calculations.** |
| `property1.appraised_date` | Valuation Date | date | Date of appraisal or value estimate |
| `property1.valuation_type` | Valuation Type | dropdown | Formal Appraisal vs. BPO (Broker Price Opinion — less formal, less expensive) |
| `property1.appraisal_performed_by` | Performed By | dropdown | Broker or Independent Third Party |

#### Calculated Equity & LTV Fields

These are auto-computed when their inputs change:

| Field Key | Label | Formula | Description |
|---|---|---|---|
| `property1.down_payment` | Down Payment | `purchasePrice − loanAmount` | Borrower cash out of pocket |
| `property1.pledged_equity` | Pledged Equity | `appraisedValue − loanAmount` | Value above the loan — lender's security |
| `property1.protective_equity` | Protective Equity | `appraisedValue − seniorLiens` | Value after paying everyone senior to this loan |
| `property1.origination_ltv` | Original LTV | User-entered (no longer auto-calc) | LTV at origination — frozen reference point |
| `property1.ltv` | Current LTV | `(currentPrincipal ÷ appraisedValue) × 100` | Today's LTV — improves as principal pays down |
| `property1.cltv` | CLTV | `(allLienBalances ÷ appraisedValue) × 100` | Combined LTV including all loans on property |

---

### Tab 3: Liens

*All legal claims against the property, in priority order.*

Each lien is a separate entry. Field keys use the pattern `lien1.field`, `lien2.field`, etc.

#### Core Lien Fields

| Field Key | Label | Type | Description |
|---|---|---|---|
| `lien#.priority` | Priority | text | Lien's position: 1st, 2nd, 3rd, etc. Determines payment order in a sale |
| `lien#.holder` | Holder | text | The company or person who owns this lien |
| `lien#.account` | Account Number | text | This lienholder's loan reference number |
| `lien#.original_balance` | Original Balance | currency | Balance when this lien was first created |
| `lien#.current_balance` | Current Balance | currency | What is owed on this lien today |
| `lien#.interest_rate` | Interest Rate | % | Interest rate charged on this other loan |
| `lien#.maturity_date` | Maturity Date | date | When this other loan is due |
| `lien#.regular_payment` | Regular Payment | currency | Monthly payment on this other loan |
| `lien#.balloon` | Balloon | checkbox | This lien has a balloon payment |
| `lien#.balloon_amount` | Balloon Amount | currency | Amount of the balloon payment |
| `lien#.this_loan` | This Loan | checkbox | Marks this lien as the loan being serviced (for equity calculations) |
| `lien#.recording_number` | Recording Number | text | County recorder's document number for this lien |
| `lien#.recording_date` | Recording Date | date | Date this lien was recorded |
| `lien#.last_verified` | Last Verified | date | Last time this lien's status was confirmed |

#### Lien Disposition — What Happens at Sale/Payoff

| Field Key | Label | Description |
|---|---|---|
| `lien#.existing_payoff` | Payoff | This lien will be fully paid off from sale proceeds or new loan |
| `lien#.existing_paydown` | Paydown | This lien's balance will be partially reduced |
| `lien#.existing_paydown_amount` | Paydown Amount | How much to reduce the balance |
| `lien#.existing_remain` | Remain | This lien stays on the property — not being paid |
| `lien#.anticipated_amount` | Anticipated Amount | Expected new balance for this lien after the transaction |

#### Auto-Calculated Lien Fields

| Field Key | Label | How Computed | Description |
|---|---|---|---|
| `lien#.lien_priority_after` | Priority After | Waterfall calculation | New priority position after paid liens are removed |
| `lien#.balance_after` | Balance After | Waterfall calculation | Remaining balance after sale proceeds are distributed |

#### Senior Lien Tracking (SLT) Fields

Monitoring the health of higher-priority liens — critical because a senior lien foreclosure wipes out this loan.

| Field Key | Description |
|---|---|
| `lien#.slt_active` | SLT monitoring is active for this lien |
| `lien#.slt_current` | Senior lien is current on payments |
| `lien#.slt_delinquent` | Senior lien is behind on payments |
| `lien#.slt_delinquent_days` | How many days delinquent |
| `lien#.slt_foreclosure` | Senior lien is in foreclosure proceedings |
| `lien#.slt_foreclosure_date` | Date foreclosure was initiated |
| `lien#.slt_paid_off` | Senior lien has been fully paid off |
| `lien#.slt_current_balance` | Current balance of the senior lien |
| `lien#.slt_last_payment_made` | Last payment date on the senior lien |
| `lien#.slt_next_payment_due` | Next payment due on the senior lien |
| `lien#.slt_request_submitted` | Date status verification was requested |
| `lien#.slt_response_received` | Date response was received |
| `lien#.slt_unable_to_verify` | Could not verify senior lien status |
| `lien#.slt_lender_notified` | Our lender was notified of senior lien issue |
| `lien#.slt_borrower_notified` | Borrower was notified |

---

### Tab 4: Charges

*Money advanced by the servicer, fees owed by the borrower.*

Each charge is a separate entry. Field keys use `charge1.field`, `charge2.field`, etc.

| Field Key | Label | Type | Description |
|---|---|---|---|
| `charge#.description` | Description | text | What the charge is for (e.g., "Property Tax Advance Q1 2026") |
| `charge#.date_of_charge` | Date of Charge | date | When this charge was created |
| `charge#.original_amount` | Original Amount | currency | Full amount when first charged |
| `charge#.current_balance` | Current Balance | currency | What remains unpaid today |
| `charge#.interest_rate` | Interest Rate | % | Rate charged on this outstanding amount |
| `charge#.interest_from` | Interest From | date | Date interest starts accruing on this charge |
| `charge#.unpaid_balance` | Unpaid Balance | currency | Amount currently unpaid |
| `charge#.deferred` | Deferred | checkbox | Charge is deferred — will be collected at payoff |
| `charge#.advanced_by_amount` | Advanced By Amount | currency | Amount funded by a specific lender for this charge |
| `charge#.on_behalf_of_amount` | On Behalf Of Amount | currency | Amount advanced on behalf of a specific lender |
| `charge#.owed_to` | Owed To | text | Who this charge is payable to |
| `charge#.owed_from` | Owed From | text | Who owes this charge |
| `charge#.category` | Category | text | Classification for reporting |
| `charge#.charge_type` | Charge Type | text | Type of charge |
| `charge#.notes` | Notes | text | Internal notes about this charge |

---

### Tab 5: Borrower / Co-Borrower / Contacts

*Personal and entity information for all parties to the loan.*

Stored with prefix `borrower1.field`, `co_borrower1.field`, etc.

#### Key Borrower Fields

| Field Key | Label | Type | Description |
|---|---|---|---|
| `borrower.first_name` | First Name | text | Legal first name |
| `borrower.last_name` | Last Name | text | Legal last name |
| `borrower.middle_initial` | Middle Initial | text | Middle initial or name |
| `borrower.ssn` | SSN | text (masked) | Social Security Number — stored encrypted, displayed masked |
| `borrower.date_of_birth` | Date of Birth | date | Used for identity verification |
| `borrower.email` | Email | email | Primary contact email |
| `borrower.phone` | Phone | phone | Primary phone number |
| `borrower.street` | Street | text | Home address |
| `borrower.city` | City | text | City |
| `borrower.state` | State | dropdown | US state |
| `borrower.zip` | ZIP | text | ZIP code |
| `borrower.marital_status` | Marital Status | dropdown | Married, Single, Separated, etc. |
| `borrower.vesting` | Vesting | text | How borrower takes title to property (e.g., "John Smith, a married man") |
| `borrower.entity_name` | Entity Name | text | For business borrowers — LLC, Corp name |
| `borrower.entity_type` | Entity Type | dropdown | LLC, Corporation, Trust, etc. |
| `borrower.tax_id` | Tax ID / EIN | text | For entity borrowers |

---

## 5. All Dropdown Options

Complete list of every dropdown field and its available options.

| Field | Options |
|---|---|
| **Lien Position** | `1st`, `2nd`, `3rd`, `other` |
| **Loan Purpose** | `consumer` (personal/residential), `business` (commercial/investment) |
| **Rate Structure** | `frm_fixed_rate` (FRM – Fixed Rate), `arm_adjustable_rate` (ARM – Adjustable Rate), `gtm_graduated_terms` (GTM – Graduated Terms), `other` |
| **Amortization** | `fully_amortized`, `partially_amortized`, `interest_only`, `constant_amortization`, `add_on_interest`, `other` |
| **Interest Calculation** | `360_day_period` (Actual/360), `365_day_period` (Actual/365) |
| **Calculation Period** | `standard_due_to_due`, `actual_due_to_due`, `received_to_received` |
| **Processing Unpaid Interest** | `include_when_calculating_interest`, `pay_automatically`, `both` |
| **Accrual Method** | `30_360`, `actual_360`, `actual_365`, `actual_actual` |
| **Payment Frequency** | `monthly` (12/yr), `bi_weekly` (26/yr), `weekly` (52/yr), `quarterly` (4/yr), `semi_annually` (2/yr), `annually` (1/yr) |
| **Loan Status** | (blank), `active`, `hold`, `closed` |
| **Hold Reason** | `w9_document_needed`, `fraud_red_flag`, `pending_payoff`, `occupancy_concern`, `pending_workout`, `other` |
| **Closed Reason** | `paid`, `transfer_out_customer`, `transfer_out_company`, `dead`, `charged_off`, `other` |
| **Short Pay Handling** | `short_pay`, `reject`, `apply_to_suspense`, `apply_to_regular_payment` |
| **Short Pay Application** | `application`, `unpaid_interest`, `principal` |
| **Funding Holdback Held By** | `lender`, `company`, `other` |
| **Property Type** | `SFR 1-4`, `Multi-family`, `Condo / Townhouse`, `Mobile Home`, `Commercial`, `Commercial Income`, `Mixed-use`, `Land SFR Residential`, `Land Residential`, `Land Commercial`, `Land Income Producing`, `Farm`, `Restaurant / Bar`, `Group Housing` |
| **Occupancy** | `Owner Occupied`, `Vacant`, `NA`, `Rental / Tenant` |
| **Construction Type** | `Wood Frame`, `Wood Frame / Stucco`, `Modular`, `Steel Frame`, `Brick / Block`, `NA`, `Concrete / Block` |
| **Zoning** | `R1 SFR`, `R2 SFR`, `R3 Multi-family`, `R-M Multi-family`, `PUD`, `Residential Lot / Parcel`, `Mixed Use`, `C Commercial`, `Agriculture`, `NA` |
| **Valuation Type** | `Appraisal`, `Broker Determined Value (BPO)` |
| **Performed By** | `Broker`, `Third Party` |
| **Information Provided By** | `Broker`, `Borrower`, `Public Record`, `Other` |
| **Land Classification** | `Land SFR Residential`, `Land Residential`, `Land Commercial`, `Land Income Producing` |
| **Lender Rate Selection** | `note_rate`, `sold_rate`, `lender_rate` |
| **Originating Vendor** | Dynamic — loaded from contacts database (contact_type = 'broker') |
| **Property Owner** | Dynamic — loaded from deal participants (borrowers on this deal) |
| **State** | All 50 US States + DC |

---

## 6. World 1 — UI Calculations (Browser)

*These run instantly in the browser when the user changes a field. Results are displayed on screen and saved to the database.*

---

### W1-1: Current Rate

**File:** `src/components/deal/LoanTermsDetailsForm.tsx`
**Field written:** `loan_terms.current_rate`
**Trigger:** useEffect on rate structure + all rate inputs
**Saved:** ✅ Yes

```
FRM (Fixed Rate):
  current_rate = note_rate

ARM (Adjustable Rate):
  current_rate = index_rate + margin
  current_rate = max(rate_floor, min(current_rate, max_interest_rate))

GTM (Graduated Terms):
  if step_rate_product enabled:
    current_rate = scheduled_period_rate
  else:
    current_rate = note_rate
```

**Input fields:**
- `loan_terms.rate_structure`
- `loan_terms.note_rate`
- `loan_terms.arm_index_rate` + `loan_terms.arm_margin` + `loan_terms.arm_rate_floor`
- `loan_terms.adj_max_interest_rate`
- `loan_terms.gtm_step_rate_product` + `loan_terms.gtm_scheduled_period_rate`

---

### W1-2: Regular Payment (Borrower Scheduled Payment)

**File:** `src/lib/borrowerPaymentFormula.ts` called from `src/components/deal/LoanTermsBalancesForm.tsx`
**Field written:** `loan_terms.regular_payment`
**Trigger:** useEffect on all inputs; only overwrites if result drifts > $0.005 from stored value
**Saved:** ✅ Yes

```
Interest Only / Add-On / Unknown / Other:
  r = (annualRate / 100) / periodsPerYear
  payment = P × r

Constant Amortization (equal principal):
  r = (annualRate / 100) / periodsPerYear
  n = termMonths / 12 × periodsPerYear
  payment = (P / n) + (P × r)
  [first period only — payment decreases each period as interest portion shrinks]

Fully Amortized (balance reaches zero):
  r = (annualRate / 100) / periodsPerYear
  n = termMonths / 12 × periodsPerYear
  payment = P × r × (1+r)^n / ((1+r)^n − 1)

Partially Amortized (balloon remains):
  r = (annualRate / 100) / periodsPerYear
  n = termMonths / 12 × periodsPerYear
  B = balloon_amount
  payment = (P − B/(1+r)^n) × r × (1+r)^n / ((1+r)^n − 1)

Periods per year by frequency:
  monthly=12, bi_weekly=26, weekly=52
  quarterly=4, annually=1, semi_annually=2
```

**Input fields:**
- `loan_terms.original_amount` (principal)
- `loan_terms.note_rate` (annual rate)
- `loan_terms.number_of_payments` (term in periods)
- `loan_terms.amortization` (method)
- `loan_terms.estimated_balloon_payment`
- `loan_terms.payment_frequency`

---

### W1-3: Total Payment

**File:** `src/components/deal/LoanTermsBalancesForm.tsx`
**Saved:** ❌ Display only

```
total_payment = regular_payment
              + additional_principal
              + servicing_fees
              + other_scheduled_payments
              + to_escrow_impounds
              + default_interest
```

---

### W1-4: Amount to Reinstate

**File:** `src/components/deal/LoanTermsBalancesForm.tsx`
**Saved:** ❌ Display only

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

*Everything needed to bring a delinquent loan fully current.*

---

### W1-5: Total Amount Due

**File:** `src/components/deal/LoanTermsBalancesForm.tsx`
**Saved:** ❌ Display only

```
total_amount_due = principal
                 + unpaid_interest
                 + accrued_interest
                 + charges_owed
                 + charges_interest
                 + unpaid_other
```

*Simplified payoff — excludes late charges and default interest.*

---

### W1-6: Estimated Balloon Payment

**File:** `src/components/deal/LoanTermsBalancesForm.tsx`
**Saved:** ❌ Display only

```
estimated_balloon = loanAmount + (loanAmount × noteRate / 100 / 12)
                  = loanAmount × (1 + noteRate/1200)
```

*Original principal plus one month of interest — rough estimate only.*

---

### W1-7: Down Payment

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `property1.down_payment`
**Trigger:** onChange on purchasePrice or loanAmount
**Saved:** ✅ Yes (only when result has not been manually overridden)

```
down_payment = purchase_price − loan_amount
```

*Guards against overwriting manual edits: only auto-fills if the stored value is empty or equals the last auto-computed value.*

---

### W1-8: Pledged Equity

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `property1.pledged_equity`
**Saved:** ✅ Yes

```
pledged_equity = appraised_value − loan_amount
```

*How much property value the borrower has pledged as security above the loan amount.*

---

### W1-9: Protective Equity

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `property1.protective_equity`
**Saved:** ✅ Yes

```
protective_equity = appraised_value − sum(all_lien_balances)
```

*The lender's safety cushion: what's left of the property value after paying off every lien.*

---

### W1-10: Current LTV

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `property1.ltv`
**Trigger:** onChange on currentPrincipal or appraisedValue
**Saved:** ✅ Yes

```
current_ltv = (current_principal / appraised_value) × 100

Returns null (clears the field) if:
  - Either input is empty, zero, or negative
  - Denominator (appraised_value) is zero or negative
```

---

### W1-11: CLTV — Combined Loan-to-Value

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `property1.cltv`
**Saved:** ✅ Yes

```
cltv = (sum_of_all_lien_balances / appraised_value) × 100
```

> ⚠️ **Known Bug:** For junior lien scenarios, the current loan being originated should be included
> in the numerator. Currently it is excluded. Correct formula:
> `cltv = (existingLienBalances + thisLoanAmount) / appraisedValue × 100`

---

### W1-12: Principal Paid

**File:** `src/components/deal/PropertyDetailsForm.tsx`
**Field written:** `loan_terms.principal_paid`
**Saved:** ✅ Yes

```
principal_paid = original_loan_amount − current_principal
```

---

### W1-13: Per-Lender Payment (Daily Accrual Model)

**File:** `src/lib/lenderPaymentFormula.ts` called from `src/components/deal/LoanTermsFundingForm.tsx`
**Fields written:** `fundingRecords[i].regularPayment`, `fundingRecords[i].servicerIncome`
**Trigger:** useEffect (400ms debounce) on noteRate or any funding record change
**Saved:** ✅ Yes (into `loan_terms.funding_records` JSON)

```
effectiveLenderRate = lenderRate (if set and > 0) else noteRate

payment = originalAmount × (effectiveLenderRate / 100) × days / dayCountBasis

servicerIncome = originalAmount × ((noteRate − effectiveLenderRate) / 100) × days / dayCountBasis

where:
  days         = interestFrom_date − fundingDate  (UTC calendar days)
  dayCountBasis = 360 (Actual/360) or 365 (Actual/365)
```

**Status codes (when calculation cannot proceed):**
- `ok` — calculation successful
- `missing_amount` — originalAmount is zero or missing
- `missing_rate` — lenderRate and noteRate both unavailable
- `missing_dates` — fundingDate or interestFrom is empty
- `bad_dates` — dates fail strict YYYY-MM-DD format OR year outside 2000–2100 OR interestFrom < fundingDate

**Rounding:** Banker's rounding (HALF_EVEN) to 2 decimal places.

---

### W1-14: Pro Rata Percentage

**File:** `src/components/deal/LoanTermsFundingForm.tsx`
**Fields written:** `fundingRecords[i].pctOwned`, `loan_terms.pro_rata`
**Trigger:** useEffect on any lender amount or total loan amount change
**Saved:** ✅ Yes

```
For each lender row:
  pctOwned_i = (originalAmount_i / totalLoanAmount) × 100

totalProRata = sum(all pctOwned_i)
```

*Total pro rata reflects actual funded share — not normalized to 100% until all lenders fully fund.*

---

### W1-15: Multi-Lender Penny-Safe Allocation

**File:** `src/lib/precisionFormat.ts` → `allocateDollarsByPercentsWithReconciliation()`
**Used by:** Payment distribution across lenders

```
For each lender:
  allocation_i = total × (pctOwned_i / 100)    [rounded to 2dp HALF_UP]

residual = total − sum(all allocations)         [may be ±$0.01]

residual assigned to: lender with largest absolute allocation
                      (ties: first lender in array wins)

Guarantee: sum(allocations) === total  (no lost cents)
```

---

### W1-16: Short Pay Bi-directional Amount ↔ Percent

**File:** `src/components/deal/LoanTermsBalancesForm.tsx`
**Fields written:** `loan_terms.apply_to_payment_amount` and `loan_terms.apply_to_payment_percent`
**Trigger:** onChange on either field; `apply_to_payment_parameters` flag tracks which was last edited
**Saved:** ✅ Both fields

```
When user edits percent:
  amount = (percent / 100) × regular_payment

When user edits dollar amount:
  percent = (amount / regular_payment) × 100
```

---

### W1-17: Lien Priority Waterfall (Balance After / Priority After)

**File:** `src/lib/lienCalculationEngine.ts` → `distributePayoff()` called from `LienSectionContent.tsx`
**Fields written:** `lien#.balance_after`, `lien#.lien_priority_after`
**Trigger:** useEffect on lien data or property value change
**Saved:** ✅ Yes

```
getRemainingBalance(lien):
  if existingPayoff:   return 0
  if existingPaydown:  return max(0, currentBalance − paydownAmount)
  if existingRemain:   return currentBalance
  else:                return anticipatedAmount OR newRemainingBalance OR currentBalance

distributePayoff(liens, propertyValue):
  Sort liens by priority ascending
  remaining = propertyValue

  For each lien (in priority order):
    owed    = getRemainingBalance(lien)
    paid    = min(remaining, owed)
    balanceAfter = owed − paid
    priorityAfter = (balanceAfter > 0) ? next_rank++ : 0
    remaining = remaining − paid
```

---

### W1-18: Equity Summary (Senior / Junior / Total)

**File:** `src/lib/lienCalculationEngine.ts` → `computeEquity()` called from `LienSectionContent.tsx`
**Fields written:** `property1.protective_equity`, `property1.total_equity`, `property1.senior_liens_total`, `property1.junior_liens_total`
**Saved:** ✅ Yes

```
thisLoanPriority = priority of lien flagged as "This Loan"

For each lien:
  balance = getRemainingBalance(lien)
  totalLiens += balance

  if priority < thisLoanPriority:  seniorTotal += balance
  if priority > thisLoanPriority:  juniorTotal += balance

Results:
  protectiveEquity = propertyValue − seniorTotal
  totalEquity      = propertyValue − totalLiens
```

---

### W1 Calculation Summary

| # | Calculation | Formula (simplified) | Saved? | File |
|---|---|---|---|---|
| W1-1 | Current Rate | Note rate OR index+margin (clamped) | ✅ | LoanTermsDetailsForm |
| W1-2 | Regular Payment | Amortization formula (4 methods) | ✅ | borrowerPaymentFormula.ts |
| W1-3 | Total Payment | Sum of 6 payment components | ❌ | LoanTermsBalancesForm |
| W1-4 | Amount to Reinstate | Sum of all balance fields | ❌ | LoanTermsBalancesForm |
| W1-5 | Total Amount Due | Principal + interest + charges | ❌ | LoanTermsBalancesForm |
| W1-6 | Estimated Balloon | `P × (1 + rate/1200)` | ❌ | LoanTermsBalancesForm |
| W1-7 | Down Payment | `purchasePrice − loanAmount` | ✅ | PropertyDetailsForm |
| W1-8 | Pledged Equity | `appraisedValue − loanAmount` | ✅ | PropertyDetailsForm |
| W1-9 | Protective Equity | `appraisedValue − allLienBalances` | ✅ | PropertyDetailsForm |
| W1-10 | Current LTV | `(principal / appraisedValue) × 100` | ✅ | PropertyDetailsForm |
| W1-11 | CLTV | `(allLiens / appraisedValue) × 100` | ✅ | PropertyDetailsForm |
| W1-12 | Principal Paid | `originalAmount − currentPrincipal` | ✅ | PropertyDetailsForm |
| W1-13 | Per-Lender Payment | `amount × rate/100 × days / 360` | ✅ | lenderPaymentFormula.ts |
| W1-14 | Servicer Income | `amount × spread/100 × days / 360` | ✅ | lenderPaymentFormula.ts |
| W1-15 | Pro Rata % | `(lenderAmount / totalLoan) × 100` | ✅ | LoanTermsFundingForm |
| W1-16 | Multi-lender Allocation | Penny-safe proportional split | ✅ | precisionFormat.ts |
| W1-17 | Short Pay ↔ Dollar | `pct ↔ dollar` via regular_payment | ✅ | LoanTermsBalancesForm |
| W1-18 | Lien Waterfall | Priority-sorted proceeds distribution | ✅ | lienCalculationEngine.ts |
| W1-19 | Equity Summary | Senior/junior/total split by lien priority | ✅ | lienCalculationEngine.ts |

---

## 7. World 2 — Document Generation Calculations (Server)

*These run on the NestJS backend when "Generate Document" is clicked. Results go into the DOCX file only — never saved back to the database.*

---

### W2-1: Currency and Value Formatting

**File:** `backend/src/modules/generation/utils/formatting.util.ts`
**When:** Applied to every field value before it enters the render data

```
Transform Rules (applied per template_field_maps.transform_rule):

"currency"        → $500,000.00   ($ prefix, commas, 2dp)
"percentage"      → 7.500%        (smart trailing-zero strip, % suffix)
"date_mmddyyyy"   → 06/01/2026    (MM/DD/YYYY)
"date_long"       → June 1, 2026  (full month name)
"date_short"      → Jun 1, 2026   (abbreviated month)
"words"           → "Five Hundred Thousand Dollars"  (for promissory notes)
"ssn_masked"      → XXX-XX-1234   (last 4 digits only)
"checkbox_yes_no" → "Yes" / "No"
"checkbox_x"      → "X" or ""    (for checkbox fields in forms)
"uppercase"       → ALL CAPS
"number"          → 500000.00     (no $ prefix, no commas)
```

---

### W2-2: Borrower Full Name Assembly

**File:** `backend/src/modules/documents/deal-field-values.loader.ts` → `applyBasicBridges()`
**Merge tag produced:** `{{br_p_fullName}}`
**Used by:** All templates that show borrower name

```
Attempt in order (first non-empty wins):
  1. borrower1.full_name              (pre-assembled)
  2. borrower.full_name               (canonical key)
  3. br_p_firstName + " " + br_p_middleInitia + " " + br_p_lastName
  4. loan_terms.details_borrower_name (manually entered)
  5. deal.borrower_name               (deal-level name)
```

---

### W2-3: Lender Contact Bridge

**File:** `backend/src/modules/documents/deal-field-values.loader.ts` → `applyLenderBridges()`
**Merge tags produced:** `ld_p_firstName`, `ld_p_lastName`, `ld_p_lenderName`, `ld_p_vesting`, etc.
**Used by:** All templates that reference the lender

```
1. Query deal_participants WHERE deal_id = X AND role = 'lender'
   ORDER BY sequence_order ASC LIMIT 1
   → get primary lender's contact_id

2. Query contacts WHERE id = contact_id
   → retrieve: first_name, last_name, middle_initial,
                company_name, vesting_name

3. Build merge tags:
   ld_p_firstName       = contact.first_name
   ld_p_lastName        = contact.last_name
   ld_p_middleName      = contact.middle_initial
   ld_p_lenderName      = company_name (entity) OR first_name + last_name (individual)
   ld_p_vesting         = vesting_name
   ld_p_firstIfEntityUse = company_name if entity, else first_name
   lender.name          = same as ld_p_lenderName
   lender1.vesting      = same as ld_p_vesting
```

---

### W2-4: RE885 Fee Aliases and Flags

**File:** `backend/src/modules/documents/deal-field-values.loader.ts` → `applyRe885Bridges()`
**Used by:** RE-885 disclosure form template

```
Field remapping (stored key → merge tag):
  origination_fees.re885_subtotal_deductions  → of_re_subtotalDeductions
  origination_fees.interest_days              → of_int_days
  origination_fees.hazard_insurance_months    → of_haz_mon
  origination_fees.mi_months                  → of_mi_mon
  origination_fees.tax_months                 → of_tax_mon
  [15+ additional aliases for all RE885 fee line items]

Rate type boolean flags (mutually exclusive, exactly one is "X"):
  is_frm = (rate_structure === 'frm_fixed_rate')   → "X" or ""
  is_arm = (rate_structure === 'arm_adjustable_rate') → "X" or ""
  is_gtm = (rate_structure === 'gtm_graduated_terms') → "X" or ""

Prepayment penalty flags:
  has_prepayment_penalty = (prepayment_penalty_enabled === true)
  no_prepayment_penalty  = (!has_prepayment_penalty)
```

---

### W2-5: RE851D Property Loop Assembly

**File:** `backend/src/modules/documents/re851d-properties.builder.ts` → `buildRe851dPropertiesArray()`
**Used by:** RE-851D Schedule of Real Property template

```
For each property (property1, property2, ...):

  1. Collect property fields:
     - Address, city, state, ZIP
     - Appraised value, property type, occupancy

  2. Collect all liens on this property:
     - Filter lien records by property reference
     - Determine senior vs. junior relative to "This Loan"

  3. Compute encumbrances:
     seniorEncumbrances  = sum(lien balances where priority < thisLoan)
     totalEncumbrances   = sum(all lien balances including thisLoan)
     expectedEncumbrances = sum(lien balances after payoff/paydown)

  4. Compute ratios:
     ln_p_loanToValueRatio = (totalEncumbrances / appraisedValue) × 100
     ln_p_amountOfEquity   = appraisedValue − totalEncumbrances

  5. Set property type checkboxes (SFR, Multi-family, Commercial, etc.)

  6. Collect property tax records

Output: properties[] array for template loop

  {{#properties}}
    {{pr_p_address_N}}
    {{ln_p_loanToValueRatio_N}}
    {{ln_p_amountOfEquity_N}}
    {{ln_p_remainingEncumbrance_N}}
    ... property type checkboxes ...
  {{/properties}}

Rollup totals (outside the loop):
  ln_totalEquitySecuringLoan = sum(equity across all properties)
  ln_p_totalEncumbrance      = sum(encumbrances across all properties)
```

---

### W2-6: Current Date Injection

**File:** `backend/src/modules/documents/document-data.service.ts`
**Merge tag:** `{{currentDate}}`
**Used by:** All templates (most documents show the generation date)

```
currentDate = format(new Date(), 'MMMM d, yyyy')
           → "June 2, 2026"
```

---

### W2-7: Nested Object Building

**File:** `backend/src/modules/documents/document-data.service.ts`
**Purpose:** Convert flat field keys into nested JavaScript objects for dot-notation templates

```
Input (flat):
  { "broker.first_name": "Mary", "broker.company": "ABC Lending" }

Output (nested):
  { broker: { first_name: "Mary", company: "ABC Lending" } }

Allows templates to use:  {{broker.first_name}}
Without pre-processing the key names.
```

---

### W2 Calculation Summary

| # | Transformation | What It Produces | Used By |
|---|---|---|---|
| W2-1 | Currency/date/text formatting | Print-ready formatted values | All templates |
| W2-2 | Borrower full name | `{{br_p_fullName}}` | All borrower templates |
| W2-3 | Lender contact bridge | `{{ld_p_firstName}}`, `{{ld_p_lenderName}}`, etc. | All lender templates |
| W2-4 | RE885 fee aliases | `{{of_re_subtotalDeductions}}` + 15 others | RE-885 form |
| W2-5 | RE851D property loop | `{{#properties}}...{{/properties}}` array | RE-851D form |
| W2-6 | Current date | `{{currentDate}}` | All templates |
| W2-7 | Nested object building | `{{broker.first_name}}` accessible | New-format templates |

---

## 8. Complete Data Flow: Input → Storage → Document

```
Step 1: USER ENTERS DATA
━━━━━━━━━━━━━━━━━━━━━━━━
CSR opens deal, navigates to Loan Terms tab
Types: Loan Amount = $500,000 | Note Rate = 7.5% | Term = 360

Step 2: WORLD 1 CALCULATIONS (instant, browser)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
React triggers useEffect:
  computeBorrowerScheduledPayment(500000, 7.5, 360, 'fully_amortized', 'monthly')
  → regular_payment = $3,496.07

Screen shows: Regular Payment = $3,496.07

Step 3: SAVE TO DATABASE
━━━━━━━━━━━━━━━━━━━━━━━━
PATCH /api/deals/{id}/sections/loan_terms
{
  field_values: {
    "loan_terms::uuid-loan-amount":    { value_text: "500000.00" },
    "loan_terms::uuid-note-rate":      { value_text: "7.5000" },
    "loan_terms::uuid-term-months":    { value_text: "360" },
    "loan_terms::uuid-regular-payment": { value_text: "3496.07" }
  }
}

Step 4: USER CLICKS "GENERATE DOCUMENT"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POST /api/deals/{id}/documents/generate-api
{ templateId: "re885-template-uuid" }

Step 5: BACKEND LOADS DEAL DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DealFieldValuesLoader reads all deal_section_values
Parses JSONB composite keys → field_key → value map:
{
  "loan_terms.loan_amount":    "500000.00",
  "loan_terms.note_rate":      "7.5000",
  "loan_terms.regular_payment": "3496.07",
  "borrower.first_name":       "John",
  "borrower.last_name":        "Smith",
  ...
}

Step 6: WORLD 2 CALCULATIONS (server, at gen time)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
applyLenderBridges():
  → fetch lender contact from deal_participants + contacts
  → ld_p_firstName = "Mary", ld_p_lenderName = "First National Bank"

applyRe885Bridges():
  → origination_fees.re885_subtotal_deductions → of_re_subtotalDeductions
  → rate_structure='frm_fixed_rate' → is_frm = "X", is_arm = "", is_gtm = ""

applyBasicBridges():
  → br_p_fullName = "John A. Smith"

DocumentDataService applies format transforms:
  "500000.00"  → "$500,000.00"    (transform: "currency")
  "7.5000"     → "7.500%"         (transform: "percentage")
  "3496.07"    → "$3,496.07"      (transform: "currency")
  "2026-06-01" → "June 1, 2026"   (transform: "date_long")

Step 7: FILE DATA BAG IS ASSEMBLED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "br_p_firstName":        "John",
  "br_p_lastName":         "Smith",
  "br_p_fullName":         "John A. Smith",
  "ln_p_loanAmount":       "$500,000.00",
  "ln_p_noteRate":         "7.500%",
  "ln_p_regularPayment":   "$3,496.07",
  "ld_p_firstName":        "Mary",
  "ld_p_lenderName":       "First National Bank",
  "of_re_subtotalDeductions": "$6,250.00",
  "is_frm":                "X",
  "currentDate":           "June 2, 2026"
}

Step 8: DOCXTEMPLATER RENDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Template DOCX has placeholders:
  {{br_p_fullName}}     → "John A. Smith"
  {{ln_p_loanAmount}}   → "$500,000.00"
  {{ln_p_noteRate}}     → "7.500%"
  {{ld_p_lenderName}}   → "First National Bank"

Step 9: OUTPUT
━━━━━━━━━━━━━━
Filled DOCX uploaded to Supabase Storage
Generated document record written to DB
Signed download URL returned to frontend
CSR downloads the document
```

---

## 9. Document Generation Pipeline

### Four Generation Routes

| Route | Engine | Persists Records | Use Case |
|---|---|---|---|
| `POST /generate` | NestJS + docxtemplater | ✅ Yes | Primary generation path |
| `POST /generate-api` | NestJS + raw XML merge engine | ✅ Yes | Port of original Supabase edge function |
| `POST /generate-edge` | Supabase edge function (proxy) | ✅ Yes | Original Deno implementation — baseline/fallback |
| `POST /generate-v2` | NestJS + docxtemplater | ❌ No (stream only) | Experimental download — no DB records |

### Generation Service Sequence (generate-api path)

```
1. refreshCacheIfNeeded()
   - Load merge_tag_aliases → build mergeTagMap
   - Load field_key_migrations → build migrationsMap
   - Cache expires after 5 minutes

2. Load template from DB
   - Get file_path (DOCX location in Supabase Storage)
   - Get template name

3. Create generation_job record (status: 'running')

4. Load deal field values
   - DealFieldValuesLoader.loadByFieldKey(dealId)
   - Returns Map<field_key, {rawValue, dataType}>

5. Apply bridges
   - applyLenderBridges()    → lender contact merge tags
   - applyBasicBridges()     → borrower full name
   - applyRe885Bridges()     → fee aliases and flags
   - applyRe851dBridges()    → property loop (for RE851D)

6. Build field transforms
   - Load template_field_maps (which fields template needs + transform rules)
   - Apply: currency, date, percentage, words, masked, checkbox formats

7. Download DOCX template
   - StorageService.download('templates', file_path)

8. processDocx(templateBuffer, fieldValues, transforms, mergeTagMap, ...)
   - Unzip DOCX (fflate)
   - Parse XML to find merge tag placeholders
   - For each placeholder:
       a. Resolve tag → field_key (7-step fallback chain)
       b. Apply transform
       c. Replace placeholder with value
   - Re-zip DOCX

9. Upload result
   - StorageService.upload('generated-docs', '{dealId}/{filename}')

10. Create generated_document record (status: 'success')

11. Update generation_job record (status: 'success', completed_at)

12. Create activity_log entry

13. Return { successCount: 1, docxUrl, templateName }
```

---

## 10. Template System & Merge Tags

### Template Database Record

```
templates:
  id          UUID        -- unique identifier
  name        TEXT        -- "RE-885 Mortgage Loan Disclosure"
  file_path   TEXT        -- "templates/re885_v3.docx" (Supabase Storage)
  state       TEXT        -- "CA" (California) or null (all states)
  product_type TEXT       -- loan type this applies to
  version     INTEGER     -- version number
  is_active   BOOLEAN     -- whether available for generation
```

### Template Field Maps (`template_field_maps`)

Declares which fields each template needs and how to format them:

```
template_id      UUID   → templates.id
field_dictionary_id UUID → field_dictionary.id
required_flag    BOOLEAN -- is this field mandatory?
transform_rule   TEXT    -- how to format: "currency", "date_mmddyyyy", etc.
display_order    INTEGER -- order for UI display
```

### Known Template Types

| Template | Description | Key Merge Tags | Special Features |
|---|---|---|---|
| **RE-851D** | Schedule of Real Property | `{{#properties}}` loop, per-property LTV, encumbrance, equity | Property loop requires `buildRe851dPropertiesArray()` |
| **RE-885** | Mortgage Loan Disclosure Statement | Rate type checkboxes, fee section, Section VII payment | `applyRe885Bridges()` required |
| **Promissory Note** | Legal borrower payment obligation | `{{ln_p_loanAmount}}`, `{{ln_p_regularPayment}}`, LTV | Standard field mapping |
| **Deed of Trust** | Legal lien instrument | Borrower/lender legal names, property description | Vesting language critical |
| **Servicing Agreement** | Loan servicing terms | Lender payment details, servicer income | Lender payment from funding grid |
| **Change of Beneficiary** | Assignment of beneficial interest | Lender name, property, date | Minimal field set |

### Merge Tag Naming Conventions (Legacy)

Old templates use prefix codes:

| Prefix | Meaning | Example |
|---|---|---|
| `br_p_` | Borrower Primary | `br_p_firstName` = borrower first name |
| `ln_p_` | Loan/Note Primary | `ln_p_loanAmount` = loan amount |
| `ln_pn_` | Loan Note | `ln_pn_noteRate` = note rate |
| `pr_p_` | Property Primary | `pr_p_appraisedValue` = appraised value |
| `ld_p_` | Lender Primary | `ld_p_firstName` = lender first name |
| `of_re_` | Origination Fees RE885 | `of_re_subtotalDeductions` = fee subtotal |
| `of_int_` | Origination Fees Interest | `of_int_days` = interest days |

New templates (migration_v1 and later) use clean dot notation:
- `{{borrower.first_name}}` instead of `{{br_p_firstName}}`
- `{{loan_terms.loan_amount}}` instead of `{{ln_p_loanAmount}}`

---

## 11. Field Key Resolution Chain

When the generation engine encounters a template placeholder, it resolves it to a field key through up to 7 steps:

```
Template placeholder: "br_p_firstName"

Step 1: Exact match in valid field keys
        → not found

Step 2: Strip trailing underscores
        "br_p_firstName_" → "br_p_firstName" (no change here)

Step 3: Check field_key_migrations table
        old_key = "br_p_firstName" → not in migrations

Step 4: Check canonical_key in field_dictionary
        canonical_key = "br_p_firstName" → matches field_key "borrower.first_name"
        → RESOLVED: "borrower.first_name"

Step 5 (if not yet resolved): Case-insensitive match
        Lower-case index lookup

Step 6: Underscore-to-dot conversion
        "br_p_first_name" → "br.p.first.name" (try as key)

Step 7: Check merge_tag_aliases table
        tag_name = "br_p_firstName" → field_key = "borrower.first_name"
        → RESOLVED

Result: field_key = "borrower.first_name"
        value     = "John"
        render    = {{ br_p_firstName }} → "John"
```

**Why so many steps?** Templates were authored over many years with inconsistent naming. The chain handles: renamed fields, case variations, underscore vs. dot, legacy prefix codes.

---

## 12. Precision & Rounding Rules

All financial math uses `decimal.js` (28 significant digits). Never native JavaScript floats.

### Storage Precision

| Data Type | Decimal Places | Example Stored | Reason |
|---|---|---|---|
| Currency | 2dp | `"500000.00"` | Cent-level accuracy |
| Rate / Percentage | 4dp | `"7.5000"` | Basis point accuracy (0.0001%) |
| LTV / CLTV | 4dp (stored), 2dp (display) | `"76.9231"` stored, `"76.92%"` shown | Precision preserved, display rounded |
| Date | ISO 8601 | `"2026-06-01"` | YYYY-MM-DD always |

### Display Precision

| Field Category | Min Decimals | Max Decimals | Trailing Zeros | Example |
|---|---|---|---|---|
| Interest rates (Note, Default) | 2 | 3 | Stripped beyond 2nd | `7.5%` not `7.500%` |
| Pro Rata / allocation % | 2 | 4 | Stripped beyond 2nd | `33.3333%` |
| LTV / CLTV / equity % | 2 | 2 | Always 2 | `76.92%` |
| Late charge % | 2 | 3 | Stripped beyond 2nd | `5.0%` |
| Currency | 2 | 2 | Always 2 | `$500,000.00` |

### Rounding Method

| Context | Method | Reason |
|---|---|---|
| Storage (most cases) | HALF_UP | Standard financial rounding |
| Per-lender payments | HALF_EVEN (Banker's) | Reduces cumulative rounding bias over many periods |
| Multi-lender allocation | HALF_UP per row + residual reconciliation | Guarantees exact sum |

---

## 13. Current Architecture Pain Points

| Issue | Impact | Location |
|---|---|---|
| **Funding: interest-only formula claims to be amortized** | Wrong payment amounts shown and stored | `LoanTermsFundingForm.tsx:44` |
| **CLTV excludes current loan for junior lien** | Understated CLTV for 2nd lien loans | `PropertyDetailsForm.tsx:161` |
| **Origination LTV uses mutable current balance** | LTV changes after partial payments (should be frozen) | `PropertyDetailsForm.tsx:120` |
| **Portfolio columns blank (hardcoded UUIDs)** | All portfolio data fields show "—" if DB differs from dev | `BorrowerPortfolio.tsx:168` |
| **Tab data stale after external save** | CSR sees old values after another user saves | `useDealFields.ts:331` |
| **Contact form doesn't re-sync when contact prop updates** | Stale form data after parent re-fetch | `ContactBorrowerDetailLayout.tsx:68` |
| **7-step resolution chain runs on every generation** | Slow, complex, prone to failures if DB tables not seeded | `field-resolver.util.ts` |
| **Transform rules hardcoded (20+ switch cases)** | Adding a new transform requires editing the service | `document-data.service.ts:204` |
| **Dropdown options hardcoded in each component** | Changing an option requires finding and editing every form | Multiple components |
| **Calculations in React, not in DB** | No batch-recalculate path if formula changes | Multiple components |
| **`merge_tag_aliases` and `field_key_migrations` must be seeded** | If empty, all legacy template tags fail to resolve | Database |
| **Bridge functions run only at document generation** | LTV, equity values in UI may differ from document values | `DealFieldValuesLoader` |
| **No pre-generation tag validation** | Template with unknown tags fails at render, not at upload | `DocxtemplaterService` |

---

## 14. Proposed Clean Architecture

### Core Principle
**The template is the source of truth for what fields it needs.**  
**The field dictionary is the source of truth for what fields exist.**  
**These two should connect automatically — no manual maintenance.**

### The Tag-Map Approach (Templates Don't Change)

At template upload time (once):
```
1. InspectModule reads DOCX → extracts all {{placeholders}}
2. For each placeholder, run resolution chain ONCE
3. Store result in templates.tag_map:
   { "br_p_firstName": "borrower.first_name",
     "ln_p_loanAmount": "loan_terms.loan_amount", ... }
4. Store templates.required_keys: all resolved field_keys
5. Flag any unresolved tags as warnings
```

At generation time (every run, now simple):
```
1. Load templates.tag_map (pre-computed at upload)
2. Load deal_data (clean flat JSON)
3. Apply tag_map: renderData[templateTag] = dealData[fieldKey]
4. docxtemplater.render(renderData)
```

**Result: Zero resolution chain at generation time. Templates never change.**

### Clean Deal Data Storage

Replace composite-key JSONB with flat field-key JSON:

```json
{
  "borrower.first_name":         "John",
  "borrower.last_name":          "Smith",
  "loan_terms.loan_amount":      "500000.00",
  "loan_terms.note_rate":        "7.5000",
  "loan_terms.regular_payment":  "3496.07",
  "property.appraised_value":    "650000.00",
  "computed.ltv":                "76.9231",
  "lender.1.company_name":       "First National Bank",
  "lender.2.company_name":       "Pacific Capital"
}
```

### Centralized Calculation Engine (Backend)

Move all calculations from React components to a backend service:

```
POST /api/deals/{id}/compute-fields
→ Returns all calculated field values
→ Frontend only displays results

CalculationEngineService:
  - Load all field_dictionary rows where is_calculated=true
  - Topological sort by dependencies
  - Evaluate each formula in dependency order
  - Bridge formulas: concat, DB-fetch (lender contact), sum-across-sections
  - Return complete map of field_key → computed_value
```

### Field Options in Database

```sql
-- New table
field_options (field_key, value, label, display_order, is_active)

-- Example:
('loan_terms.amortization', 'fully_amortized', 'Fully Amortized', 1, true)
('loan_terms.amortization', 'interest_only',   'Interest Only',   2, true)
```

Frontend fetches options at runtime — one change in DB updates all forms.

### Migration Phases

```
Phase 1 (Low risk): Add templates.tag_map column; populate at upload; validate
Phase 2 (Low risk): New generation uses tag_map instead of resolution chain
Phase 3 (Medium):   Add deal_data table; write to both old + new on save
Phase 4 (Medium):   Add field_options table; replace hardcoded dropdown arrays
Phase 5 (Medium):   Move calculations to CalculationEngineService
Phase 6 (High):     Switch reads to new deal_data; deprecate deal_section_values
```

---

## Appendix: File Locations Reference

| Purpose                                         | File                                                          |
| -------------------------------------------------| ---------------------------------------------------------------|
| Borrower payment formula (4 amortization types) | `src/lib/borrowerPaymentFormula.ts`                           |
| Lender daily accrual formula                    | `src/lib/lenderPaymentFormula.ts`                             |
| LTV, currency, precision utilities              | `src/lib/precisionFormat.ts`                                  |
| Lien waterfall & equity                         | `src/lib/lienCalculationEngine.ts`                            |
| Field-dictionary-driven formula engine          | `src/lib/calculationEngine.ts`                                |
| Property LTV/CLTV/equity inline calcs           | `src/components/deal/PropertyDetailsForm.tsx`                 |
| Balances, total payment, reinstatement          | `src/components/deal/LoanTermsBalancesForm.tsx`               |
| Lender payment grid                             | `src/components/deal/LoanTermsFundingForm.tsx`                |
| Lien section with waterfall                     | `src/components/deal/LienSectionContent.tsx`                  |
| Deal data loading (all sections)                | `backend/src/modules/documents/deal-field-values.loader.ts`   |
| RE885 bridges & aliases                         | `backend/src/modules/documents/deal-field-values.loader.ts`   |
| RE851D property loop builder                    | `backend/src/modules/documents/re851d-properties.builder.ts`  |
| Document data assembly                          | `backend/src/modules/documents/document-data.service.ts`      |
| Docxtemplater rendering                         | `backend/src/modules/documents/docxtemplater.service.ts`      |
| Template tag inspection                         | `backend/src/modules/documents/template-inspect.util.ts`      |
| Raw XML merge engine                            | `backend/src/modules/generation/utils/docx-processor.util.ts` |
| Field key resolution chain                      | `backend/src/modules/generation/utils/field-resolver.util.ts` |
| Value formatting                                | `backend/src/modules/generation/utils/formatting.util.ts`     |
| Generation orchestration                        | `backend/src/modules/generation/generation.service.ts`        |

---

*This document was generated from codebase analysis on 2026-06-02.*  
*Branch: `migration_v1` (NestJS backend) based on `main` (calculation standards).*

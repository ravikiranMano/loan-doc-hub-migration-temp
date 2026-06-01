/**
 * Borrower Scheduled Payment — single source of truth used by:
 *   - Loan Terms & Balances → Regular Payment
 *   - RE 885 Section VII   → Proposed Initial (Minimum) Loan Payment
 *
 * Branches on the loan's amortization method. All math in Decimal.js;
 * never throws; returns `null` when required inputs are missing.
 */

import Decimal from 'decimal.js';

export type AmortizationMethod =
  | 'interest_only'
  | 'fully_amortized'
  | 'partially_amortized'
  | 'constant_amortization'
  | 'add_on_interest'
  | 'other'
  | '';

export type PaymentFrequency =
  | 'monthly'
  | 'bi_weekly'
  | 'weekly'
  | 'quarterly'
  | 'annually'
  | 'semi_annually'
  | '';

export interface BorrowerPaymentInputs {
  /** Loan principal in dollars (number or string). */
  principal: number | string | null | undefined;
  /** Annual note rate in percent (e.g. 7.5 for 7.5%). */
  annualRatePct: number | string | null | undefined;
  /** Total scheduled term length in months. Optional for interest_only. */
  termMonths?: number | string | null;
  amortization?: AmortizationMethod;
  /** Balloon balance owed at end of term (partially_amortized). */
  balloonAmount?: number | string | null;
  frequency?: PaymentFrequency;
}

const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  bi_weekly: 26,
  weekly: 52,
  quarterly: 4,
  annually: 1,
  semi_annually: 2,
};

function toDec(v: number | string | null | undefined): Decimal | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Decimal(v) : null;
  const s = String(v).replace(/[$,%\s]/g, '').trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function round2(d: Decimal): number {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
}

/**
 * Compute the scheduled borrower payment for one period.
 * Returns null when inputs are insufficient.
 */
export function computeBorrowerScheduledPayment(
  input: BorrowerPaymentInputs,
): number | null {
  const P = toDec(input.principal);
  const ratePct = toDec(input.annualRatePct);
  if (!P || P.lte(0) || !ratePct || ratePct.lte(0)) return null;

  const freqKey = (input.frequency || 'monthly').toLowerCase();
  const periodsPerYear = PERIODS_PER_YEAR[freqKey] ?? 12;
  const periodRate = ratePct.div(100).div(periodsPerYear); // decimal

  const amort = (input.amortization || '').toLowerCase() as AmortizationMethod;
  const termMonthsDec = toDec(input.termMonths);
  // Periods over the full term, scaled by frequency (term is months).
  const n =
    termMonthsDec && termMonthsDec.gt(0)
      ? termMonthsDec.div(12).mul(periodsPerYear)
      : null;

  // Interest-only / add-on-interest / unknown amortization → per-period interest on full principal.
  // Spec: interest_only payment = P × rate / periods. add_on_interest and `other`/empty fall back here
  // so the field is never blank when amortization is unset.
  if (
    amort === 'interest_only' ||
    amort === 'add_on_interest' ||
    amort === '' ||
    amort === 'other' ||
    !n
  ) {
    return round2(P.mul(periodRate));
  }

  if (amort === 'constant_amortization') {
    // Equal-principal: principal portion = P/n, interest portion (first period) = P × r.
    // Initial scheduled payment for period 1.
    const principalPart = P.div(n);
    const interestPart = P.mul(periodRate);
    return round2(principalPart.plus(interestPart));
  }

  // fully_amortized & partially_amortized share the annuity formula:
  //   pmt = (P − B/(1+r)^n) × r(1+r)^n / ((1+r)^n − 1)
  // For fully_amortized, balloon B = 0.
  const r = periodRate;
  if (r.lte(0)) {
    // Zero-rate edge: equal principal across periods.
    return round2(P.div(n));
  }
  const onePlusR = r.plus(1);
  // Decimal.pow accepts Decimal/number.
  const pow = onePlusR.pow(n);
  const denom = pow.minus(1);
  if (denom.lte(0)) return null;

  let balloon: Decimal | null = null;
  if (amort === 'partially_amortized') {
    balloon = toDec(input.balloonAmount);
    if (!balloon || balloon.lt(0)) balloon = new Decimal(0);
  } else {
    balloon = new Decimal(0);
  }

  const principalLessBalloonPV = P.minus(balloon.div(pow));
  if (principalLessBalloonPV.lte(0)) return null;

  const pmt = principalLessBalloonPV.mul(r).mul(pow).div(denom);
  if (!pmt.isFinite() || pmt.lte(0)) return null;
  return round2(pmt);
}

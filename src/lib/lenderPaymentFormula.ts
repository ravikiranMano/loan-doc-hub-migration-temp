/**
 * Canonical Lender Payment formula — single source of truth (Model A: Per-row
 * daily accrual).
 *
 *   payment_i = originalAmount_i × (effectiveLenderRate_i / 100)
 *               × days_i / dayCountBasis
 *
 *   servicerIncome_i = originalAmount_i × ((noteRate − effectiveLenderRate_i) / 100)
 *                      × days_i / dayCountBasis
 *
 * where days_i = daysBetween(fundingDate_i, interestFrom_i), inclusive of zero.
 *
 * - effectiveLenderRate falls back to noteRate when the row has no lenderRate
 *   (legacy "no override" behaviour). servicerIncome is 0 in that case.
 * - dayCountBasis defaults to 360 (Actual/360). Pass 365 for Actual/365.
 * - Dates are parsed strictly as `YYYY-MM-DD`; year must be in [2000, 2100].
 *   Anything else → `bad_dates`, payment/servicerIncome = 0 (caller decides
 *   how to surface it; the audit edge function flags these rows and skips
 *   the backfill so corrupted dates never silently produce garbage numbers).
 * - Negative day counts (interestFrom < fundingDate) → `bad_dates`.
 * - Rounding: banker's rounding (HALF_EVEN) to 2dp per row. With per-row
 *   independent math there is no shared total to reconcile, so the
 *   roundingAdjustment flag is no longer applied to payments here (it
 *   remains in use by the grid for Pro Rata reconciliation).
 *
 * Decimal.js throughout — no native float for financial math.
 */

import Decimal from 'decimal.js';

export interface LenderRowInputs {
  originalAmount: number | string | null | undefined;
  /** Per-row Lender Rate (percent, e.g. 7 for 7%). Optional — falls back to noteRate. */
  lenderRate?: number | string | null;
  /** ISO date YYYY-MM-DD. */
  fundingDate?: string | null;
  /** ISO date YYYY-MM-DD; interest starts accruing for this lender. */
  interestFrom?: string | null;
  /** Reserved for Pro Rata reconciliation; not used for payment math under Model A. */
  roundingAdjustment?: boolean;
}

export interface LoanContext {
  /** Loan-level Note Rate (percent). Used only to compute servicer-income spread. */
  noteRate?: number | string | null;
  /** Day-count basis (360 or 365). Defaults to 360 (Actual/360). */
  dayCountBasis?: number;
}

export type LenderRowStatus =
  | 'ok'
  | 'missing_amount'
  | 'missing_rate'
  | 'missing_dates'
  | 'bad_dates';

export interface LenderRowComputation {
  /** Per-row Lender Payment, rounded to 2dp. 0 when status !== 'ok'. */
  payment: number;
  /** Per-row servicing/broker spread income, rounded to 2dp. */
  servicerIncome: number;
  /** Accrual days = interestFrom − fundingDate (UTC, calendar days). */
  days: number;
  /** Effective lender rate (percent) used in the calculation. */
  effectiveRate: number;
  /** Day-count basis actually used (360 or 365). */
  basis: number;
  status: LenderRowStatus;
  /** Human-readable explanation when status !== 'ok'. */
  reason?: string;
}

export class LenderPaymentInputsMissingError extends Error {
  readonly missing: ReadonlyArray<string>;
  constructor(missing: string[]) {
    super(`Lender payment cannot be computed; missing: ${missing.join(', ')}`);
    this.name = 'LenderPaymentInputsMissingError';
    this.missing = missing;
  }
}

/** Parse "9.50%" / "$1,200,000" / 9.5 / null into a Decimal or null. */
function toDec(v: number | string | null | undefined): Decimal | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Decimal(v) : null;
  const cleaned = String(v).replace(/[%$,\s]/g, '').trim();
  if (!cleaned) return null;
  try {
    const d = new Decimal(cleaned);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Strict YYYY-MM-DD parse with sane year window. Returns null on failure. */
function parseDateOnly(s?: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function daysBetweenUTC(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Compute a single lender row's payment + servicing income.
 * Never throws; status field tells the caller what happened.
 */
export function computeLenderRow(
  row: LenderRowInputs,
  ctx: LoanContext = {},
): LenderRowComputation {
  const basis = ctx.dayCountBasis && ctx.dayCountBasis > 0 ? ctx.dayCountBasis : 360;
  const orig = toDec(row.originalAmount);
  const lr = toDec(row.lenderRate);
  const nr = toDec(ctx.noteRate);

  if (!orig || orig.lte(0)) {
    return {
      payment: 0, servicerIncome: 0, days: 0,
      effectiveRate: 0, basis, status: 'missing_amount',
      reason: 'originalAmount is missing or ≤ 0',
    };
  }

  const effective = lr && lr.gt(0) ? lr : nr && nr.gt(0) ? nr : null;
  if (!effective) {
    return {
      payment: 0, servicerIncome: 0, days: 0,
      effectiveRate: 0, basis, status: 'missing_rate',
      reason: 'lenderRate missing and noteRate fallback unavailable',
    };
  }

  const fd = parseDateOnly(row.fundingDate);
  const ifrom = parseDateOnly(row.interestFrom);
  if (!fd || !ifrom) {
    return {
      payment: 0, servicerIncome: 0, days: 0,
      effectiveRate: effective.toNumber(), basis,
      status: !row.fundingDate || !row.interestFrom ? 'missing_dates' : 'bad_dates',
      reason: !row.fundingDate || !row.interestFrom
        ? 'fundingDate or interestFrom is empty'
        : 'fundingDate or interestFrom failed strict YYYY-MM-DD parse (year must be 2000..2100)',
    };
  }
  const days = daysBetweenUTC(fd, ifrom);
  if (days < 0) {
    return {
      payment: 0, servicerIncome: 0, days,
      effectiveRate: effective.toNumber(), basis,
      status: 'bad_dates',
      reason: `interestFrom (${row.interestFrom}) is before fundingDate (${row.fundingDate})`,
    };
  }

  const basisDec = new Decimal(basis);
  const daysDec = new Decimal(days);
  const paymentExact = orig.mul(effective).div(100).mul(daysDec).div(basisDec);
  const payment = paymentExact
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
    .toNumber();

  // Servicer income = spread × original × days / basis. Zero when noteRate
  // is missing or <= effectiveRate (no positive spread to capture).
  let servicerIncome = 0;
  if (nr && nr.gt(0)) {
    const spread = nr.minus(effective);
    if (spread.gt(0)) {
      servicerIncome = orig
        .mul(spread).div(100).mul(daysDec).div(basisDec)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
        .toNumber();
    }
  }

  return {
    payment, servicerIncome, days,
    effectiveRate: effective.toNumber(), basis, status: 'ok',
  };
}

/** Batch helper — computes all rows; never throws. */
export function computeLenderRows(
  rows: ReadonlyArray<LenderRowInputs>,
  ctx: LoanContext = {},
): LenderRowComputation[] {
  return rows.map((r) => computeLenderRow(r, ctx));
}

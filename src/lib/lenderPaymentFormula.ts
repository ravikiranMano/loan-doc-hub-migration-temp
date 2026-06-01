/**
 * Canonical Lender Payment formula — single source of truth.
 *
 * Per-row Lender Payment formula:
 *
 *   payment_i = (originalAmount_i / loanPrincipal) × regularPI × (effectiveLenderRate_i / noteRate)
 *
 * - regularPI is the borrower's scheduled Regular P&I (derived from Note Rate
 *   by the Loan Terms form). The (lenderRate / noteRate) factor rescales the
 *   per-row pro-rata share from the Note Rate down/up to the row's Lender Rate
 *   — this is the servicing/broker spread carve-out.
 * - effectiveLenderRate is the row's explicit `lenderRate`. If absent, the
 *   row falls back to `noteRate` (legacy "no override" behaviour) — the result
 *   in that case equals the unscaled pro-rata share. We never silently skip
 *   the scaling: missing inputs THROW so callers can decide what to do.
 *
 * Rounding: banker's rounding (HALF_EVEN) to 2dp. The row flagged
 * `roundingAdjustment` absorbs the sub-cent reconciliation so the rounded
 * total equals the exact total.
 *
 * Decimal.js throughout — no native float for financial math.
 */

import Decimal from 'decimal.js';

export interface LenderRowInputs {
  originalAmount: number | string | null | undefined;
  /** Per-row Lender Rate (percent, e.g. 7 for 7%). Optional — falls back to noteRate. */
  lenderRate?: number | string | null;
  /** Whether this row absorbs the sub-cent rounding remainder. */
  roundingAdjustment?: boolean;
}

export interface LoanContext {
  /** Total loan principal (Σ originalAmount denominator). */
  loanPrincipal: number | string | null | undefined;
  /** Borrower scheduled Regular P&I, computed by Loan Terms from Note Rate. */
  regularPI: number | string | null | undefined;
  /** Loan-level Note Rate (percent). Required — kills the silent fallback bug. */
  noteRate: number | string | null | undefined;
}

export class LenderPaymentInputsMissingError extends Error {
  readonly missing: ReadonlyArray<'loanPrincipal' | 'regularPI' | 'noteRate'>;
  constructor(missing: Array<'loanPrincipal' | 'regularPI' | 'noteRate'>) {
    super(`Lender payment cannot be computed; missing required loan-level input(s): ${missing.join(', ')}`);
    this.name = 'LenderPaymentInputsMissingError';
    this.missing = missing;
  }
}

/** Parse "9.50%" / "$1,200,000" / 9.5 / null into a Decimal or null. */
function toDec(v: number | string | null | undefined): Decimal | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? new Decimal(v) : null;
  }
  const cleaned = String(v).replace(/[%$,\s]/g, '').trim();
  if (!cleaned) return null;
  try {
    const d = new Decimal(cleaned);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function validateContext(ctx: LoanContext): {
  loanPrincipal: Decimal;
  regularPI: Decimal;
  noteRate: Decimal;
} {
  const lp = toDec(ctx.loanPrincipal);
  const pi = toDec(ctx.regularPI);
  const nr = toDec(ctx.noteRate);
  const missing: Array<'loanPrincipal' | 'regularPI' | 'noteRate'> = [];
  if (!lp || lp.lte(0)) missing.push('loanPrincipal');
  if (!pi || pi.lte(0)) missing.push('regularPI');
  if (!nr || nr.lte(0)) missing.push('noteRate');
  if (missing.length) throw new LenderPaymentInputsMissingError(missing);
  return { loanPrincipal: lp!, regularPI: pi!, noteRate: nr! };
}

/** Exact (un-rounded) per-row payment. Rate scaling is mandatory. */
export function computeLenderRowPaymentExact(
  row: LenderRowInputs,
  ctx: LoanContext,
): Decimal {
  const { loanPrincipal, regularPI, noteRate } = validateContext(ctx);
  const orig = toDec(row.originalAmount) ?? new Decimal(0);
  if (orig.lte(0)) return new Decimal(0);
  const lenderRate = toDec(row.lenderRate);
  // Missing per-row lenderRate => row inherits Note Rate (scaling factor = 1).
  const effective = lenderRate && lenderRate.gt(0) ? lenderRate : noteRate;
  return orig.div(loanPrincipal).mul(regularPI).mul(effective).div(noteRate);
}

/**
 * Compute the full rounded payment array, with the rounding-adjustment row
 * absorbing the sub-cent remainder so Σ(rounded) === round(Σ(exact)).
 *
 * Returns numbers ready to persist (2dp).
 *
 * Throws `LenderPaymentInputsMissingError` when loan-level inputs are missing.
 */
export function computeLenderPaymentsRounded(
  rows: ReadonlyArray<LenderRowInputs>,
  ctx: LoanContext,
): number[] {
  if (!rows.length) return [];
  // Validate once up front — throws on missing inputs.
  validateContext(ctx);

  const exact = rows.map((r) => computeLenderRowPaymentExact(r, ctx));
  const rounded = exact.map((d) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
  const sumExact = exact
    .reduce((a, b) => a.plus(b), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const sumRounded = rounded.reduce((a, b) => a.plus(b), new Decimal(0));
  const diff = sumExact.minus(sumRounded);
  if (!diff.isZero()) {
    const adjIdx = rows.findIndex((r) => r.roundingAdjustment);
    if (adjIdx >= 0) {
      rounded[adjIdx] = rounded[adjIdx].plus(diff);
    }
  }
  return rounded.map((d) => d.toNumber());
}

/**
 * Safe variant: returns null instead of throwing when inputs are missing.
 * Useful inside React effects where we want to leave existing values alone
 * rather than crash mid-render.
 */
export function computeLenderPaymentsRoundedSafe(
  rows: ReadonlyArray<LenderRowInputs>,
  ctx: LoanContext,
): number[] | null {
  try {
    return computeLenderPaymentsRounded(rows, ctx);
  } catch (err) {
    if (err instanceof LenderPaymentInputsMissingError) return null;
    throw err;
  }
}

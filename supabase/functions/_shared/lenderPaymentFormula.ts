/**
 * Canonical Lender Payment formula — Deno port of src/lib/lenderPaymentFormula.ts.
 *
 *   payment_i = (originalAmount_i / loanPrincipal) × regularPI × (effectiveLenderRate_i / noteRate)
 *
 * effectiveLenderRate falls back to noteRate when the row has no lenderRate
 * (legacy "no override" behaviour). Missing loan-level inputs throw.
 *
 * Decimal.js, banker's rounding, rounding-adjustment row absorbs sub-cent diff.
 */
import Decimal from 'npm:decimal.js@10.4.3';

export interface LenderRowInputs {
  originalAmount: number | string | null | undefined;
  lenderRate?: number | string | null;
  roundingAdjustment?: boolean;
}

export interface LoanContext {
  loanPrincipal: number | string | null | undefined;
  regularPI: number | string | null | undefined;
  noteRate: number | string | null | undefined;
}

export class LenderPaymentInputsMissingError extends Error {
  readonly missing: ReadonlyArray<'loanPrincipal' | 'regularPI' | 'noteRate'>;
  constructor(missing: Array<'loanPrincipal' | 'regularPI' | 'noteRate'>) {
    super(`Lender payment cannot be computed; missing: ${missing.join(', ')}`);
    this.name = 'LenderPaymentInputsMissingError';
    this.missing = missing;
  }
}

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

function validateContext(ctx: LoanContext) {
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

export function computeLenderRowPaymentExact(
  row: LenderRowInputs,
  ctx: LoanContext,
): Decimal {
  const { loanPrincipal, regularPI, noteRate } = validateContext(ctx);
  const orig = toDec(row.originalAmount) ?? new Decimal(0);
  if (orig.lte(0)) return new Decimal(0);
  const lr = toDec(row.lenderRate);
  const effective = lr && lr.gt(0) ? lr : noteRate;
  return orig.div(loanPrincipal).mul(regularPI).mul(effective).div(noteRate);
}

export function computeLenderPaymentsRounded(
  rows: ReadonlyArray<LenderRowInputs>,
  ctx: LoanContext,
): number[] {
  if (!rows.length) return [];
  validateContext(ctx);
  const exact = rows.map((r) => computeLenderRowPaymentExact(r, ctx));
  const rounded = exact.map((d) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
  const sumExact = exact.reduce((a, b) => a.plus(b), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const sumRounded = rounded.reduce((a, b) => a.plus(b), new Decimal(0));
  const diff = sumExact.minus(sumRounded);
  if (!diff.isZero()) {
    const adjIdx = rows.findIndex((r) => r.roundingAdjustment);
    if (adjIdx >= 0) rounded[adjIdx] = rounded[adjIdx].plus(diff);
  }
  return rounded.map((d) => d.toNumber());
}

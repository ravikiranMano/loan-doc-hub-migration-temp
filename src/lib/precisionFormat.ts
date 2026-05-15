/**
 * Platform-wide decimal precision helpers for rate / percentage / dollar fields.
 *
 * Storage rule: percent/rate values are stored at 4 decimal places (string).
 *               dollar values are stored at 2 decimal places (string).
 *
 * Display rule: always show >= 2 decimals; show up to `max` decimals;
 *               trailing zeros beyond the 2nd decimal are suppressed.
 *
 * Examples (max = 4):
 *   10        -> "10.00"
 *   10.5      -> "10.50"
 *   10.875    -> "10.875"
 *   10.8756   -> "10.8756"
 *   27.2727   -> "27.2727"
 *
 * All math goes through decimal.js — never native floats — so callers can
 * safely sum, divide, and compare percentage allocations without binary
 * floating-point drift.
 */

import Decimal from 'decimal.js';

// Configure once for the entire app. 28 sig digits is plenty for money/rates.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** Convert any input into a Decimal, or null if not a finite number. */
export function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'string' ? value.replace(/[, %$]/g, '').trim() : value;
  if (raw === '' || raw === null || raw === undefined) return null;
  try {
    const d = new Decimal(raw);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Format a percent/rate value for display:
 *   - min 2 decimals, max `maxDecimals` decimals
 *   - trailing zeros beyond the 2nd decimal place are stripped
 *   - returns '' for null / NaN / empty
 */
export function formatPercentDisplay(
  value: string | number | null | undefined,
  maxDecimals = 4
): string {
  const d = toDecimal(value);
  if (d === null) return '';
  const safeMax = Math.max(2, Math.floor(maxDecimals));

  // Round to max precision first (HALF_UP).
  let s = d.toFixed(safeMax);

  // If max == 2, just return as-is.
  if (safeMax === 2) return s;

  // Strip trailing zeros only beyond the 2nd decimal place.
  // e.g. "10.5000" -> "10.50",  "10.8750" -> "10.875",  "10.8756" -> "10.8756"
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) return s; // no decimals (shouldn't happen, toFixed adds them)

  const intPart = s.slice(0, dotIdx);
  const decPart = s.slice(dotIdx + 1);

  // Keep first 2 decimals as the floor; trim zeros from the right of the rest.
  const head = decPart.slice(0, 2);
  let tail = decPart.slice(2).replace(/0+$/, '');

  return tail.length === 0 ? `${intPart}.${head}` : `${intPart}.${head}${tail}`;
}

/** Round a percent/rate to 4 decimal places for storage. Returns '' for invalid. */
export function roundPctForStorage(value: string | number | null | undefined): string {
  const d = toDecimal(value);
  return d === null ? '' : d.toFixed(4);
}

/** Round a dollar amount to 2 decimal places for storage. Returns '' for invalid. */
export function roundDollarForStorage(value: string | number | null | undefined): string {
  const d = toDecimal(value);
  return d === null ? '' : d.toFixed(2);
}

/** Sum a list of percent values using Decimal arithmetic. Returns a Decimal. */
export function sumPercents(values: Array<string | number | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => {
    const d = toDecimal(v);
    return d === null ? acc : acc.plus(d);
  }, new Decimal(0));
}

/**
 * Compute amortized monthly payment using the standard formula:
 *   Payment = P × [r(1+r)^n] / [(1+r)^n − 1]
 * where:
 *   P = principal balance
 *   r = monthly rate = annualRatePct / 100 / 12
 *   n = remaining number of monthly payments
 *
 * Falls back to interest-only (P × r) when n <= 0 (no/unknown term).
 * Returns '' for invalid inputs. Uses Decimal arithmetic to 2dp.
 */
export function computeAmortizedPayment(
  principal: string | number | null | undefined,
  annualRatePct: string | number | null | undefined,
  remainingPayments: string | number | null | undefined
): string {
  const P = toDecimal(principal);
  const ratePct = toDecimal(annualRatePct);
  if (P === null || ratePct === null || P.lte(0) || ratePct.lte(0)) return '';
  const r = ratePct.div(100).div(12);
  const nDec = toDecimal(remainingPayments);
  const n = nDec === null ? 0 : Math.floor(nDec.toNumber());
  if (!Number.isFinite(n) || n <= 0) {
    return P.mul(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  }
  // (1+r)^n via decimal.js Decimal.pow
  const onePlusRPowN = r.plus(1).pow(n);
  const denom = onePlusRPowN.minus(1);
  if (denom.isZero()) {
    return P.mul(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  }
  const payment = P.mul(r.mul(onePlusRPowN)).div(denom);
  return payment.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Compute an LTV-style ratio: (numerator / denominator) * 100, returned as a
 * 4dp storage string. Returns null when inputs would produce an invalid or
 * unsafe value (NaN, divide-by-zero, negative numerator/denominator).
 *
 * Centralised so Origination LTV, Current LTV, CLTV, and any future
 * multi-lien ratio share one validation + rounding contract.
 */
export function computeLtv(
  numerator: string | number | null | undefined,
  denominator: string | number | null | undefined
): string | null {
  const n = toDecimal(numerator);
  const d = toDecimal(denominator);
  if (n === null || d === null) return null;
  if (n.lt(0)) return null;
  if (d.lte(0)) return null;
  return n.div(d).mul(100).toFixed(4);
}

/** Allocate a dollar amount by a percent (both as strings/numbers). Rounded to 2dp. */
export function allocateDollarsByPercent(
  dollarAmount: string | number | null | undefined,
  percent: string | number | null | undefined
): string {
  const dollars = toDecimal(dollarAmount);
  const pct = toDecimal(percent);
  if (dollars === null || pct === null) return '';
  return dollars.mul(pct).div(100).toFixed(2);
}

// ============================================================================
// Category-aware display helpers (platform-wide standard)
// ----------------------------------------------------------------------------
// All helpers smart-trim trailing zeros beyond the 2nd decimal and append the
// appropriate unit. Storage precision is always 4dp for percent / 2dp for $;
// these helpers operate on the stored value, never on a re-rounded display
// string.
// ============================================================================

/** Interest-style rates (Note, Default, Interest Guarantee, Deferred). Max 3dp. */
export function formatInterestRate(value: string | number | null | undefined): string {
  const s = formatPercentDisplay(value, 3);
  return s === '' ? '' : `${s}%`;
}

/** Pro-rata / funding / lender allocation %. Max 4dp. */
export function formatProRata(value: string | number | null | undefined): string {
  const s = formatPercentDisplay(value, 4);
  return s === '' ? '' : `${s}%`;
}

/** LTV / CLTV / Protective Equity / generic ratio %. Max 2dp. */
export function formatRatio(value: string | number | null | undefined): string {
  const s = formatPercentDisplay(value, 2);
  return s === '' ? '' : `${s}%`;
}

/** Late Charge %. Max 3dp. */
export function formatLateChargePct(value: string | number | null | undefined): string {
  const s = formatPercentDisplay(value, 3);
  return s === '' ? '' : `${s}%`;
}

/** Dollar amounts. Always exactly 2dp with `$` and thousand separators. */
export function formatDollar(value: string | number | null | undefined): string {
  const d = toDecimal(value);
  if (d === null) return '';
  const fixed = d.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const absInt = sign ? intPart.slice(1) : intPart;
  const withCommas = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${withCommas}.${decPart}`;
}

// ----------------------------------------------------------------------------
// Field-key -> category resolver
// ----------------------------------------------------------------------------

export type PercentCategory = 'interestRate' | 'proRata' | 'ratio' | 'lateChargePct' | 'ltv';

/** Resolve a field key to its percentage category. Defaults to interestRate (3dp). */
export function resolvePercentCategory(fieldKey: string | null | undefined): PercentCategory {
  if (!fieldKey) return 'interestRate';
  const k = fieldKey.toLowerCase();
  if (/(^|_)(ltv|cltv|origination_ltv)(_|$)/.test(k)) {
    return 'ltv';
  }
  if (k.includes('protective_equity') || k.includes('protectiveequity')) {
    return 'ratio';
  }
  if (k.includes('late_charge') && (k.includes('pct') || k.includes('percent') || k.includes('rate'))) {
    return 'lateChargePct';
  }
  if (
    k.includes('pro_rata') ||
    k.includes('prorata') ||
    k.includes('funding_pct') ||
    k.includes('pct_owned') ||
    k.includes('pctowned') ||
    k.includes('allocation_pct') ||
    k.includes('allocationpct')
  ) {
    return 'proRata';
  }
  // Note rate, default rate, interest guarantee, deferred interest, etc.
  return 'interestRate';
}

/** LTV / CLTV display: min 2dp, max 4dp, trailing zeros trimmed beyond the 2nd decimal. */
export function formatLtv(value: string | number | null | undefined): string {
  const s = formatPercentDisplay(value, 4);
  return s === '' ? '' : `${s}%`;
}

/** Format a percent value using the category resolved from a field key. */
export function formatPercentByFieldKey(
  fieldKey: string | null | undefined,
  value: string | number | null | undefined
): string {
  switch (resolvePercentCategory(fieldKey)) {
    case 'ltv': return formatLtv(value);
    case 'ratio': return formatRatio(value);
    case 'proRata': return formatProRata(value);
    case 'lateChargePct': return formatLateChargePct(value);
    case 'interestRate':
    default: return formatInterestRate(value);
  }
}

export { Decimal };

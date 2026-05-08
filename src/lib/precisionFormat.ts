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

export { Decimal };

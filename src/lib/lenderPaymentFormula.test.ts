import { describe, it, expect } from 'vitest';
import {
  computeLenderRowPaymentExact,
  computeLenderPaymentsRounded,
  computeLenderPaymentsRoundedSafe,
  LenderPaymentInputsMissingError,
} from './lenderPaymentFormula';

describe('lenderPaymentFormula', () => {
  it('halves the payment when lender rate is half the note rate (12% / 6%)', () => {
    // $1,200,000 principal, regularPI = 12000 (12% / 12 mo, interest only)
    const out = computeLenderRowPaymentExact(
      { originalAmount: 1_200_000, lenderRate: 6 },
      { loanPrincipal: 1_200_000, regularPI: 12_000, noteRate: 12 },
    );
    expect(out.toNumber()).toBeCloseTo(6_000, 6);
  });

  it('returns the unscaled pro-rata when lenderRate === noteRate', () => {
    const out = computeLenderRowPaymentExact(
      { originalAmount: 500_000, lenderRate: 9.5 },
      { loanPrincipal: 1_000_000, regularPI: 7916.67, noteRate: 9.5 },
    );
    // (500k / 1M) × 7916.67 = 3958.335
    expect(out.toNumber()).toBeCloseTo(3958.335, 3);
  });

  it('falls back to noteRate when row lenderRate is missing (legacy)', () => {
    const out = computeLenderRowPaymentExact(
      { originalAmount: 500_000 },
      { loanPrincipal: 1_000_000, regularPI: 7916.67, noteRate: 9.5 },
    );
    expect(out.toNumber()).toBeCloseTo(3958.335, 3);
  });

  it('absorbs sub-cent rounding into the roundingAdjustment row', () => {
    // Three equal rows of $300k, principal = $900k, regPI = $1000.01
    // Each exact share = 333.336666..., rounds to 333.34/333.34/333.33 (sum 1000.01).
    const rows = [
      { originalAmount: 300_000, lenderRate: 7 },
      { originalAmount: 300_000, lenderRate: 7 },
      { originalAmount: 300_000, lenderRate: 7, roundingAdjustment: true },
    ];
    const out = computeLenderPaymentsRounded(rows, {
      loanPrincipal: 900_000,
      regularPI: 1000.01,
      noteRate: 7,
    });
    const sum = out.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000.01);
  });

  it('throws LenderPaymentInputsMissingError when noteRate is missing', () => {
    expect(() =>
      computeLenderPaymentsRounded(
        [{ originalAmount: 100_000, lenderRate: 7 }],
        { loanPrincipal: 100_000, regularPI: 600, noteRate: '' },
      ),
    ).toThrow(LenderPaymentInputsMissingError);
  });

  it('safe variant returns null on missing inputs', () => {
    const out = computeLenderPaymentsRoundedSafe(
      [{ originalAmount: 100_000, lenderRate: 7 }],
      { loanPrincipal: 100_000, regularPI: 600, noteRate: '' },
    );
    expect(out).toBeNull();
  });

  it('parses formatted strings ($1,200,000 / 9.50%)', () => {
    const out = computeLenderRowPaymentExact(
      { originalAmount: '$835,000', lenderRate: '7.00%' },
      { loanPrincipal: '$900,000', regularPI: '$5,625.00', noteRate: '9.50%' },
    );
    // (835/900) × 5625 × (7/9.5) = 3849.34...
    expect(out.toNumber()).toBeGreaterThan(3800);
    expect(out.toNumber()).toBeLessThan(3900);
  });
});

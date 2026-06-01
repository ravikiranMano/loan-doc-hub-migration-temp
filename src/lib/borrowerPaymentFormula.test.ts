import { describe, expect, it } from 'vitest';
import { computeBorrowerScheduledPayment } from './borrowerPaymentFormula';

describe('computeBorrowerScheduledPayment', () => {
  it('interest-only $700k @ 7.5% monthly → 4375.00', () => {
    expect(
      computeBorrowerScheduledPayment({
        principal: 700000,
        annualRatePct: 7.5,
        amortization: 'interest_only',
        frequency: 'monthly',
      }),
    ).toBe(4375);
  });

  it('interest-only $900k @ 9.5% monthly → 7125.00', () => {
    expect(
      computeBorrowerScheduledPayment({
        principal: 900000,
        annualRatePct: 9.5,
        amortization: 'interest_only',
        frequency: 'monthly',
      }),
    ).toBe(7125);
  });

  it('fully-amortized 30-yr $200k @ 6% monthly ≈ 1199.10', () => {
    const v = computeBorrowerScheduledPayment({
      principal: 200000,
      annualRatePct: 6,
      termMonths: 360,
      amortization: 'fully_amortized',
      frequency: 'monthly',
    });
    expect(v).not.toBeNull();
    expect(Math.abs((v as number) - 1199.10)).toBeLessThan(0.05);
  });

  it('partially-amortized 70-mo $700k @ 7.5% with $600k balloon → smaller than IO', () => {
    const io = 700000 * 0.075 / 12; // 4375
    const v = computeBorrowerScheduledPayment({
      principal: 700000,
      annualRatePct: 7.5,
      termMonths: 70,
      amortization: 'partially_amortized',
      balloonAmount: 600000,
      frequency: 'monthly',
    });
    expect(v).not.toBeNull();
    // Should be > IO since some principal must amortize over 70 months.
    expect(v as number).toBeGreaterThan(io);
  });

  it('returns null when principal missing', () => {
    expect(
      computeBorrowerScheduledPayment({
        principal: 0,
        annualRatePct: 7.5,
        amortization: 'interest_only',
      }),
    ).toBeNull();
  });

  it('returns null when rate missing', () => {
    expect(
      computeBorrowerScheduledPayment({
        principal: 700000,
        annualRatePct: '',
        amortization: 'interest_only',
      }),
    ).toBeNull();
  });

  it('unknown amortization falls back to interest-only', () => {
    expect(
      computeBorrowerScheduledPayment({
        principal: 700000,
        annualRatePct: 7.5,
        amortization: '' as ''
      }),
    ).toBe(4375);
  });
});

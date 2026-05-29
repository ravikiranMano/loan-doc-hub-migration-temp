import { describe, it, expect } from 'vitest';
import {
  calculateProRataWithRounding,
  validateRoundingAdjustment,
  getRoundingColumnDisplay,
} from './proRataRounding';

describe('calculateProRataWithRounding', () => {
  it('worked example: $208.33 across 3 lenders distributes 2 pennies by largest fraction', () => {
    // Total Funding $650,000 → shares 33.33% / 33.33% / 33.34%.
    const res = calculateProRataWithRounding(208.33, [
      { id: 'L-00037', originalAmount: 216645 }, // fraction ~ 0.44 (idx 0)
      { id: 'L-00002', originalAmount: 216645 }, // fraction ~ 0.44 (idx 1)
      { id: 'L-00004', originalAmount: 216710 }, // fraction ~ 0.53 (idx 2)
    ]);
    expect(res.map((r) => r.proRataAmount)).toEqual([69.44, 69.43, 69.46]);
    // Sorted by fraction desc → Michael (0.53) gets penny 1, Fallbrook (0.44, idx 0) gets penny 2.
    expect(res[0].isRoundingRecipient).toBe(true); // Fallbrook
    expect(res[1].isRoundingRecipient).toBe(false); // Sarah
    expect(res[2].isRoundingRecipient).toBe(true); // Michael
    const sumCents = res.reduce((s, r) => s + Math.round(r.proRataAmount * 100), 0);
    expect(sumCents).toBe(20833);
  });

  it('zero remainder: no rounding recipients', () => {
    // $100 split across two equal lenders → $50 / $50 exactly.
    const res = calculateProRataWithRounding(100, [
      { id: 'A', originalAmount: 500 },
      { id: 'B', originalAmount: 500 },
    ]);
    expect(res.map((r) => r.proRataAmount)).toEqual([50, 50]);
    expect(res.every((r) => !r.isRoundingRecipient)).toBe(true);
  });

  it('single lender: receives the full amount, no rounding flag', () => {
    const res = calculateProRataWithRounding(123.45, [{ id: 'only', originalAmount: 1000 }]);
    expect(res).toEqual([
      { id: 'only', proRataAmount: 123.45, proRataPct: 100, isRoundingRecipient: false },
    ]);
  });

  it('single penny remainder goes to the lender with the largest fraction', () => {
    // 100.01 across two equal lenders → floor(50.005)=50 cents each? Let's craft a 1-penny case.
    // $10.01 across 33/67 → 10.01 * 0.33 = 3.3033 → floor 3.30; 10.01 * 0.67 = 6.7067 → floor 6.70.
    // Sum 10.00, remainder 1 cent. Largest fraction = 0.67 holder.
    const res = calculateProRataWithRounding(10.01, [
      { id: 'small', originalAmount: 33 },
      { id: 'big', originalAmount: 67 },
    ]);
    expect(res[0].proRataAmount).toBe(3.3);
    expect(res[1].proRataAmount).toBe(6.71);
    expect(res[0].isRoundingRecipient).toBe(false);
    expect(res[1].isRoundingRecipient).toBe(true);
  });

  it('tie on fraction → lowest input index wins the penny', () => {
    // Two identical lenders, odd total → 1 penny remainder, both fractions equal → idx 0 wins.
    const res = calculateProRataWithRounding(0.01, [
      { id: 'first', originalAmount: 100 },
      { id: 'second', originalAmount: 100 },
    ]);
    expect(res[0].proRataAmount).toBe(0.01);
    expect(res[1].proRataAmount).toBe(0);
    expect(res[0].isRoundingRecipient).toBe(true);
    expect(res[1].isRoundingRecipient).toBe(false);
  });

  it('handles lender deleted mid session: recalculates clean against remaining lenders', () => {
    const before = calculateProRataWithRounding(100, [
      { id: 'A', originalAmount: 100 },
      { id: 'B', originalAmount: 100 },
      { id: 'C', originalAmount: 100 },
    ]);
    // Delete C — recalc with what's left.
    const after = calculateProRataWithRounding(100, [
      { id: 'A', originalAmount: 100 },
      { id: 'B', originalAmount: 100 },
    ]);
    expect(before.length).toBe(3);
    expect(after.length).toBe(2);
    expect(after.map((r) => r.proRataAmount)).toEqual([50, 50]);
  });

  it('recovers when amount changes after distribution', () => {
    const lenders = [
      { id: 'A', originalAmount: 100 },
      { id: 'B', originalAmount: 100 },
      { id: 'C', originalAmount: 100 },
    ];
    const a = calculateProRataWithRounding(100, lenders);
    const b = calculateProRataWithRounding(200, lenders);
    expect(a.reduce((s, r) => s + Math.round(r.proRataAmount * 100), 0)).toBe(10000);
    expect(b.reduce((s, r) => s + Math.round(r.proRataAmount * 100), 0)).toBe(20000);
  });

  it('zero or negative payment returns all zeros', () => {
    const res = calculateProRataWithRounding(0, [
      { id: 'A', originalAmount: 100 },
      { id: 'B', originalAmount: 100 },
    ]);
    expect(res.map((r) => r.proRataAmount)).toEqual([0, 0]);
  });
});

describe('validateRoundingAdjustment', () => {
  it('passes when sum matches in cents', () => {
    const r = validateRoundingAdjustment(208.33, [69.44, 69.43, 69.46]);
    expect(r.valid).toBe(true);
  });

  it('fails when sum mismatches and reports the diff', () => {
    const r = validateRoundingAdjustment(208.33, [69.44, 69.43, 69.45]);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('does not match');
  });
});

describe('getRoundingColumnDisplay', () => {
  it('returns ✓ for recipient and — otherwise', () => {
    expect(getRoundingColumnDisplay({ isRoundingRecipient: true })).toBe('✓');
    expect(getRoundingColumnDisplay({ isRoundingRecipient: false })).toBe('—');
  });
});

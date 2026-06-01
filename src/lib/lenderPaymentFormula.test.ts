import { describe, it, expect } from 'vitest';
import { computeLenderRow, computeLenderRows } from './lenderPaymentFormula';

describe('lenderPaymentFormula (Model A: per-row daily accrual)', () => {
  it('computes $1,575 for BlueStone $450k @ 7% over 18 days/360', () => {
    const out = computeLenderRow(
      {
        originalAmount: 450_000,
        lenderRate: 7,
        fundingDate: '2026-04-30',
        interestFrom: '2026-05-18', // exactly 18 days
      },
      { noteRate: 7.5 },
    );
    expect(out.status).toBe('ok');
    expect(out.days).toBe(18);
    expect(out.payment).toBeCloseTo(1575, 2);
    // Servicer income: $450k × 0.50% × 18/360 = $112.50
    expect(out.servicerIncome).toBeCloseTo(112.5, 2);
  });

  it('per-row dates drive the math (decisive test)', () => {
    const base = { originalAmount: 100_000, lenderRate: 6, fundingDate: '2026-01-01' };
    const a = computeLenderRow({ ...base, interestFrom: '2026-01-31' }, { noteRate: 6 });
    const b = computeLenderRow({ ...base, interestFrom: '2026-02-15' }, { noteRate: 6 });
    expect(a.days).toBe(30);
    expect(b.days).toBe(45);
    expect(b.payment).toBeGreaterThan(a.payment);
  });

  it('changing only the Lender Rate moves the payment; Note Rate alone does not', () => {
    const row = {
      originalAmount: 1_200_000,
      fundingDate: '2026-01-01',
      interestFrom: '2026-01-31',
    };
    const rateOnly6 = computeLenderRow({ ...row, lenderRate: 6 }, { noteRate: 12 });
    const rateOnly12 = computeLenderRow({ ...row, lenderRate: 12 }, { noteRate: 12 });
    expect(rateOnly12.payment).toBeCloseTo(rateOnly6.payment * 2, 2);

    // Same Lender Rate, changing Note Rate alone doesn't move payment
    const noteHigh = computeLenderRow({ ...row, lenderRate: 6 }, { noteRate: 24 });
    expect(noteHigh.payment).toBeCloseTo(rateOnly6.payment, 2);
    // But servicer income reflects the wider spread
    expect(noteHigh.servicerIncome).toBeGreaterThan(rateOnly6.servicerIncome);
  });

  it('falls back to noteRate when row lenderRate is missing', () => {
    const out = computeLenderRow(
      {
        originalAmount: 500_000,
        fundingDate: '2026-01-01',
        interestFrom: '2026-01-31',
      },
      { noteRate: 8 },
    );
    expect(out.status).toBe('ok');
    expect(out.effectiveRate).toBe(8);
    expect(out.servicerIncome).toBe(0); // no spread when effective === note
  });

  it('flags missing dates with status missing_dates and payment 0', () => {
    const out = computeLenderRow(
      { originalAmount: 100_000, lenderRate: 7, fundingDate: '2026-01-01' },
      { noteRate: 7 },
    );
    expect(out.status).toBe('missing_dates');
    expect(out.payment).toBe(0);
  });

  it('flags year 2126 as bad_dates (corruption guard)', () => {
    const out = computeLenderRow(
      {
        originalAmount: 100_000,
        lenderRate: 7,
        fundingDate: '2126-01-01',
        interestFrom: '2126-01-31',
      },
      { noteRate: 7 },
    );
    expect(out.status).toBe('bad_dates');
    expect(out.payment).toBe(0);
  });

  it('flags negative day count (interestFrom < fundingDate)', () => {
    const out = computeLenderRow(
      {
        originalAmount: 100_000,
        lenderRate: 7,
        fundingDate: '2026-02-01',
        interestFrom: '2026-01-01',
      },
      { noteRate: 7 },
    );
    expect(out.status).toBe('bad_dates');
  });

  it('Actual/365 basis when caller overrides dayCountBasis', () => {
    const out = computeLenderRow(
      {
        originalAmount: 365_000,
        lenderRate: 10,
        fundingDate: '2026-01-01',
        interestFrom: '2026-01-31',
      },
      { noteRate: 10, dayCountBasis: 365 },
    );
    // 365000 × 0.10 × 30/365 = 3000
    expect(out.payment).toBeCloseTo(3000, 2);
  });

  it('batch helper preserves order', () => {
    const rows = computeLenderRows(
      [
        { originalAmount: 100_000, lenderRate: 6, fundingDate: '2026-01-01', interestFrom: '2026-01-31' },
        { originalAmount: 200_000, lenderRate: 7, fundingDate: '2026-01-01', interestFrom: '2026-01-31' },
      ],
      { noteRate: 8 },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('ok');
    expect(rows[1].payment).toBeGreaterThan(rows[0].payment);
  });
});

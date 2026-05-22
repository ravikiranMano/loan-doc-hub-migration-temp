import { describe, it, expect } from 'vitest';
import {
  formatPercentDisplay,
  formatInterestRate,
  formatProRata,
  formatRatio,
  formatLateChargePct,
  formatDollar,
  resolvePercentCategory,
  formatPercentByFieldKey,
  roundPctForStorage,
  roundDollarForStorage,
  sumPercents,
  allocateDollarsByPercent,
  allocateDollarsByPercentsWithReconciliation,
  computeAmortizedPayment,
} from './precisionFormat';

describe('formatPercentDisplay (smart-trim)', () => {
  const cases: Array<[number | string, number, string]> = [
    [10, 4, '10.00'],
    [10.5, 4, '10.50'],
    [10.875, 4, '10.875'],
    [10.8756, 4, '10.8756'],
    [27.2727, 4, '27.2727'],
    [10.0, 2, '10.00'],
    [10.5, 2, '10.50'],
    [8.876, 3, '8.876'],
    [8.8756, 3, '8.876'], // rounds up at max precision
  ];
  for (const [v, max, expected] of cases) {
    it(`${v} @ max ${max} -> ${expected}`, () => {
      expect(formatPercentDisplay(v, max)).toBe(expected);
    });
  }
  it('empty/null returns ""', () => {
    expect(formatPercentDisplay(null)).toBe('');
    expect(formatPercentDisplay('')).toBe('');
    expect(formatPercentDisplay('abc')).toBe('');
  });
});

describe('category helpers (all use min 2 / max 4 smart-trim)', () => {
  it('formatInterestRate', () => {
    expect(formatInterestRate('8.5000')).toBe('8.50%');
    expect(formatInterestRate('8.8750')).toBe('8.875%');
    expect(formatInterestRate('8.8756')).toBe('8.876%');
    expect(formatInterestRate('7.3500')).toBe('7.35%');
    expect(formatInterestRate('7.2000')).toBe('7.20%');
  });
  it('formatProRata', () => {
    expect(formatProRata('27.2727')).toBe('27.2727%');
    expect(formatProRata('50.5000')).toBe('50.50%');
    expect(formatProRata('33.3333')).toBe('33.3333%');
  });
  it('formatRatio (LTV/CLTV/Protective Equity) -> max 2dp', () => {
    expect(formatRatio('80.1250')).toBe('80.13%');
    expect(formatRatio('65.5000')).toBe('65.50%');
    expect(formatRatio('50.0000')).toBe('50.00%');
    expect(formatRatio('4.1671')).toBe('4.17%');
    expect(formatRatio('0.0167')).toBe('0.02%');
  });

  it('formatLateChargePct', () => {
    expect(formatLateChargePct('5.1250')).toBe('5.125%');
    expect(formatLateChargePct('5.1000')).toBe('5.10%');
    expect(formatLateChargePct('10.5010')).toBe('10.501%');
  });
  it('formatDollar always 2dp with $ and commas', () => {
    expect(formatDollar(1000)).toBe('$1,000.00');
    expect(formatDollar(45.5)).toBe('$45.50');
    expect(formatDollar('1234567.891')).toBe('$1,234,567.89');
    expect(formatDollar(-2500)).toBe('-$2,500.00');
    expect(formatDollar('')).toBe('');
  });
});

describe('resolvePercentCategory', () => {
  const cases: Array<[string, ReturnType<typeof resolvePercentCategory>]> = [
    ['ln_p_note_rate', 'interestRate'],
    ['ln_default_rate', 'interestRate'],
    ['interest_guarantee_rate', 'interestRate'],
    ['deferred_interest_rate', 'interestRate'],
    ['lender_pro_rata', 'proRata'],
    ['funding_pct', 'proRata'],
    ['pct_owned', 'proRata'],
    ['ltv', 'ltv'],
    ['cltv_value', 'ltv'],
    ['protective_equity_pct', 'ratio'],
    ['late_charge_pct', 'lateChargePct'],
    ['late_charge_percent', 'lateChargePct'],
  ];
  for (const [key, expected] of cases) {
    it(`${key} -> ${expected}`, () => {
      expect(resolvePercentCategory(key)).toBe(expected);
    });
  }
});

describe('formatPercentByFieldKey', () => {
  it('routes through correct category', () => {
    expect(formatPercentByFieldKey('ln_p_note_rate', '8.8756')).toBe('8.876%');
    expect(formatPercentByFieldKey('lender_pro_rata', '27.2727')).toBe('27.2727%');
    expect(formatPercentByFieldKey('ltv', '80.1250')).toBe('80.13%');

    expect(formatPercentByFieldKey('late_charge_pct', '5.125')).toBe('5.125%');
  });
});

describe('storage rounding', () => {
  it('roundPctForStorage -> 4dp', () => {
    expect(roundPctForStorage(8.5)).toBe('8.5000');
    expect(roundPctForStorage('8.87567')).toBe('8.8757');
    expect(roundPctForStorage('')).toBe('');
  });
  it('roundDollarForStorage -> 2dp', () => {
    expect(roundDollarForStorage(1000)).toBe('1000.00');
    expect(roundDollarForStorage('1234.5678')).toBe('1234.57');
  });
});

describe('Decimal math (no float drift)', () => {
  it('sumPercents 100 x 0.1 = 10', () => {
    const arr = Array.from({ length: 100 }, () => '0.1');
    expect(sumPercents(arr).toFixed(4)).toBe('10.0000');
  });
  it('allocateDollarsByPercent 1000 * 27.2727%', () => {
    expect(allocateDollarsByPercent(1000, 27.2727)).toBe('272.73');
  });
  it('computeAmortizedPayment standard 30y mortgage', () => {
    // 200000 @ 6% / 360 months -> ~1199.10
    expect(computeAmortizedPayment(200000, 6, 360)).toBe('1199.10');
  });
  it('computeAmortizedPayment falls back to interest-only when n<=0', () => {
    expect(computeAmortizedPayment(120000, 12, 0)).toBe('1200.00');
  });
});

import {
  formatPercentage,
  formatRate,
  formatCurrency,
  normalizeStoredPrecision,
} from './precisionFormat';

describe('Spec-named aliases', () => {
  it('formatPercentage smart-trims with default max 4', () => {
    expect(formatPercentage('10')).toBe('10.00%');
    expect(formatPercentage('10.5')).toBe('10.50%');
    expect(formatPercentage('10.875')).toBe('10.875%');
    expect(formatPercentage('27.2727')).toBe('27.2727%');
    expect(formatPercentage('')).toBe('');
  });
  it('formatRate -> 3dp max (Note/Default/Sold/Lender/Spread)', () => {
    expect(formatRate('8.5000')).toBe('8.50%');
    expect(formatRate('8.8750')).toBe('8.875%');
    expect(formatRate('8.8756')).toBe('8.876%');
  });
  it('formatCurrency -> $ + 2dp + commas', () => {
    expect(formatCurrency(1234567.891)).toBe('$1,234,567.89');
    expect(formatCurrency(-50)).toBe('-$50.00');
    expect(formatCurrency('')).toBe('');
  });
  it('normalizeStoredPrecision percent/rate/ratio -> 4dp', () => {
    expect(normalizeStoredPrecision('8.5', 'percent')).toBe('8.5000');
    expect(normalizeStoredPrecision('8.87567', 'rate')).toBe('8.8757');
    expect(normalizeStoredPrecision('80.125', 'ratio')).toBe('80.1250');
  });
  it('normalizeStoredPrecision currency/dollar -> 2dp', () => {
    expect(normalizeStoredPrecision('1234.5678', 'currency')).toBe('1234.57');
    expect(normalizeStoredPrecision(1000, 'dollar')).toBe('1000.00');
  });
  it('normalizeStoredPrecision invalid -> ""', () => {
    expect(normalizeStoredPrecision('abc', 'percent')).toBe('');
    expect(normalizeStoredPrecision('', 'currency')).toBe('');
  });
});

// Platform-wide spec QA matrix: storage 4dp + display smart-trim, plus
// penny-safe multi-lender reconciliation for repeating-decimal splits.
describe('Spec QA matrix — storage & display', () => {
  const matrix: Array<[string, string]> = [
    ['10.0000', '10.00'],
    ['10.5000', '10.50'],
    ['10.8750', '10.875'],
    ['10.8756', '10.8756'],
    ['27.2727', '27.2727'],
  ];
  for (const [stored, display] of matrix) {
    it(`stored ${stored} -> display ${display}`, () => {
      expect(roundPctForStorage(stored)).toBe(stored);
      expect(formatPercentDisplay(stored, 4)).toBe(display);
    });
  }
});

describe('Penny-safe reconciliation', () => {
  it('three lenders @ 33.3333% of $100 reconciles exactly', () => {
    const parts = allocateDollarsByPercentsWithReconciliation(100, [
      '33.3333',
      '33.3333',
      '33.3334',
    ]);
    expect(parts).toHaveLength(3);
    const total = parts.reduce((a, p) => a + Number(p), 0);
    expect(total.toFixed(2)).toBe('100.00');
  });
  it('three lenders @ 27.2727% / 27.2727% / 45.4546% of $1000', () => {
    const parts = allocateDollarsByPercentsWithReconciliation(1000, [
      '27.2727',
      '27.2727',
      '45.4546',
    ]);
    const total = parts.reduce((a, p) => a + Number(p), 0);
    expect(total.toFixed(2)).toBe('1000.00');
  });
  it('returns [] on invalid input', () => {
    expect(allocateDollarsByPercentsWithReconciliation('abc', ['50', '50'])).toEqual([]);
    expect(allocateDollarsByPercentsWithReconciliation(100, ['50', 'xx'])).toEqual([]);
  });
});

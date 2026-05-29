/**
 * Pro-Rata Payment Distribution with Penny-Level Rounding Adjustment.
 *
 * Splits a single payment total across multiple lenders by each lender's
 * share of the loan's total funding (Original Amount). All math runs in
 * integer cents to avoid floating-point drift, and any leftover pennies
 * are distributed one at a time to the lenders with the largest fractional
 * remainder (ties broken by lowest input index).
 *
 * Business rules:
 *  - Base = lender.originalAmount / totalFundingAmount (NEVER currentBalance).
 *  - Floor every exact share to 2dp.
 *  - Distribute remainder = totalCents − Σ floored, one penny per lender,
 *    sorted by fraction desc, lowest index wins on tie.
 *  - The penny is absorbed INSIDE the proRataAmount — there is no separate
 *    "rounding adjustment" field. Recipients are flagged via
 *    `isRoundingRecipient` so the UI can render the ✓ glyph automatically.
 *  - sum(proRataAmount) must equal totalPayment exactly (in cents).
 */

export interface ProRataLenderInput {
  /** Stable id (for tie-break ordering; lowest input index wins on tie). */
  id?: string;
  /** Lender's Original Funding Amount in dollars. */
  originalAmount: number;
}

export interface ProRataLenderResult {
  id?: string;
  /** Pro-rata share of the payment in dollars (already includes any penny). */
  proRataAmount: number;
  /** Pro-rata percentage of total funding (0–100, 4dp). */
  proRataPct: number;
  /** True when this lender received one of the distributed pennies. */
  isRoundingRecipient: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Calculate per-lender pro-rata shares of a single payment, distributing
 * pennies of remainder one at a time to lenders with the largest fraction.
 */
export function calculateProRataWithRounding(
  totalPayment: number,
  lenders: ProRataLenderInput[],
): ProRataLenderResult[] {
  const safeLenders = Array.isArray(lenders) ? lenders : [];

  // Zero / empty short-circuit.
  if (!safeLenders.length || !isFinite(totalPayment) || totalPayment <= 0) {
    return safeLenders.map((l) => ({
      id: l.id,
      proRataAmount: 0,
      proRataPct: 0,
      isRoundingRecipient: false,
    }));
  }

  const totalFunding = safeLenders.reduce(
    (s, l) => s + (Number(l.originalAmount) || 0),
    0,
  );

  // Single lender or zero total funding → give the whole payment to the first
  // lender with a positive originalAmount (or the first lender if all zero).
  if (totalFunding <= 0) {
    return safeLenders.map((l, i) => ({
      id: l.id,
      proRataAmount: i === 0 ? round2(totalPayment) : 0,
      proRataPct: i === 0 ? 100 : 0,
      isRoundingRecipient: false,
    }));
  }

  const totalCents = Math.round(totalPayment * 100);

  // Step 1-2: exact share in cents, floor, fraction.
  const rows = safeLenders.map((l, idx) => {
    const original = Number(l.originalAmount) || 0;
    const pct = (original / totalFunding) * 100; // 0..100, raw
    const exactCents = totalCents * (original / totalFunding);
    const flooredCents = Math.floor(exactCents);
    const fraction = exactCents - flooredCents;
    return { idx, id: l.id, pct, flooredCents, fraction };
  });

  // Step 3: remainder pennies.
  const sumFloored = rows.reduce((s, r) => s + r.flooredCents, 0);
  let remainder = totalCents - sumFloored;
  if (remainder < 0) remainder = 0; // defensive — should never happen

  // Step 4: sort by fraction desc, ties → lowest idx.
  const recipientIdxs = new Set<number>();
  if (remainder > 0) {
    const sorted = [...rows].sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.idx - b.idx;
    });
    for (let k = 0; k < remainder && k < sorted.length; k++) {
      recipientIdxs.add(sorted[k].idx);
    }
  }

  // Step 5-6: absorb penny INSIDE flooredCents, convert back to dollars.
  return rows.map((r) => {
    const got = recipientIdxs.has(r.idx) ? 1 : 0;
    const finalCents = r.flooredCents + got;
    return {
      id: r.id,
      proRataAmount: finalCents / 100,
      proRataPct: Math.round(r.pct * 10000) / 10000, // 4dp
      isRoundingRecipient: got === 1,
    };
  });
}

/**
 * Validates that the per-lender pro-rata amounts sum exactly to the payment
 * (in cents). Returns true when valid; returns false with a reason otherwise.
 */
export function validateRoundingAdjustment(
  totalPayment: number,
  lenderAmounts: number[],
): { valid: boolean; error?: string; expectedCents: number; actualCents: number } {
  const expectedCents = Math.round(totalPayment * 100);
  const actualCents = lenderAmounts.reduce(
    (s, n) => s + Math.round((Number(n) || 0) * 100),
    0,
  );
  if (expectedCents === actualCents) {
    return { valid: true, expectedCents, actualCents };
  }
  return {
    valid: false,
    error: `Sum of lender amounts ($${(actualCents / 100).toFixed(2)}) does not match total payment ($${(expectedCents / 100).toFixed(2)}).`,
    expectedCents,
    actualCents,
  };
}

/** Display helper for the Rounding column. */
export function getRoundingColumnDisplay(
  lender: Pick<ProRataLenderResult, 'isRoundingRecipient'>,
): '✓' | '—' {
  return lender.isRoundingRecipient ? '✓' : '—';
}

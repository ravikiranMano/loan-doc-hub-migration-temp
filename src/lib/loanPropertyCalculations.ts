/**
 * Shared loan/property calculation inputs used by PropertyDetailsForm,
 * PropertyModal, and PropertySectionContent.
 */

export function parseNumericField(raw: string | undefined | null): number {
  if (raw == null || raw === '') return NaN;
  return parseFloat(String(raw).replace(/[, $]/g, ''));
}

/** Resolve loan amount from values map using all known key aliases. */
export function resolveLoanAmount(values: Record<string, string>): number {
  const keys = [
    'loan_terms.loan_amount',
    'loan_terms.original_loan_amount',
    'loan_terms.original_amount',
    'ln_p_originalAmount',
    'ln_p_loanAmount',
    'loan.original_amount',
  ];
  for (const key of keys) {
    const n = parseNumericField(values[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

export function resolveCurrentPrincipal(values: Record<string, string>): number {
  const n = parseNumericField(values['loan_terms.principal']);
  return Number.isFinite(n) ? n : 0;
}

/** Sum a numeric lien sub-field across lien1..lienN prefixes. */
export function sumLienField(values: Record<string, string>, fieldSuffix: string): number {
  let total = 0;
  const prefixes = new Set<string>();
  Object.keys(values).forEach((key) => {
    const m = key.match(/^(lien\d+)\./);
    if (m) prefixes.add(m[1]);
  });
  prefixes.forEach((prefix) => {
    const n = parseNumericField(values[`${prefix}.${fieldSuffix}`]);
    if (Number.isFinite(n)) total += n;
  });
  return total;
}

/** CLTV numerator: prefer new_remaining_balance, fall back to current_balance per lien.
 *  A new_remaining_balance of 0 means the lien is being paid off — treat as 0, not a
 *  missing value, so paid-off liens don't inflate the CLTV numerator. */
export function sumExistingLiensTotal(values: Record<string, string>): number {
  let total = 0;
  const prefixes = new Set<string>();
  Object.keys(values).forEach((key) => {
    const m = key.match(/^(lien\d+)\./);
    if (m) prefixes.add(m[1]);
  });
  prefixes.forEach((prefix) => {
    const newBal = parseNumericField(values[`${prefix}.new_remaining_balance`]);
    const curBal = parseNumericField(values[`${prefix}.current_balance`]);
    // Use new_remaining_balance whenever it is a valid finite number (including 0 = payoff).
    // Only fall back to current_balance when new_remaining_balance is absent/NaN.
    const n = Number.isFinite(newBal) ? newBal : curBal;
    if (Number.isFinite(n)) total += n;
  });
  return total;
}

export function sumLiensCurrentBalanceTotal(values: Record<string, string>): number {
  return sumLienField(values, 'current_balance');
}

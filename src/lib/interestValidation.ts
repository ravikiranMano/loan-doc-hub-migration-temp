/**
 * Interest Field Validation Utilities
 *
 * Enforces positive numeric values in US number format for all interest-related fields.
 * - Accepts: positive integers and decimals (e.g., 5, 10.25, 1,000.50)
 * - Rejects: negative values, alphabets, invalid special characters
 */

/**
 * Sanitize an interest/rate input value in real-time.
 * Strips everything except digits, commas (thousands separator), and a single decimal point.
 * Prevents negative values entirely.
 */
export function sanitizeInterestInput(raw: string): string {
  // Remove anything that isn't a digit, comma, or period
  let cleaned = raw.replace(/[^0-9.,]/g, '');

  // Ensure only one decimal point
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('');
  }

  return cleaned;
}

/**
 * Parse a US-formatted number string to a raw numeric string for storage.
 * Strips commas, validates the result is a valid positive number.
 * Returns the cleaned numeric string, or empty string if invalid.
 */
export function parseInterestValue(value: string): string {
  if (!value || value.trim() === '') return '';

  // Strip commas (thousands separators)
  const stripped = value.replace(/,/g, '');

  // Check if it's a valid positive number
  const num = parseFloat(stripped);
  if (isNaN(num) || num < 0) return '';

  return stripped;
}

/**
 * Validate that a value is a valid positive number.
 * Returns true if valid, false otherwise.
 */
export function isValidInterestValue(value: string): boolean {
  if (!value || value.trim() === '') return true; // Empty is valid (not required check)

  const stripped = value.replace(/,/g, '');
  const num = parseFloat(stripped);
  return !isNaN(num) && num >= 0 && /^\d*\.?\d*$/.test(stripped);
}

/**
 * Format a numeric value for display in US format with commas.
 */
export function formatInterestDisplay(value: string, decimals = 2): string {
  if (!value || value.trim() === '') return '';

  const stripped = value.replace(/,/g, '');
  const num = parseFloat(stripped);
  if (isNaN(num)) return value;

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Normalize a value on blur — strip commas, fix to decimal places, ensure positive.
 */
export function normalizeInterestOnBlur(value: string, decimals = 2): string {
  if (!value || value.trim() === '') return '';

  const stripped = value.replace(/,/g, '');
  const num = parseFloat(stripped);
  if (isNaN(num) || num < 0) return '';

  // Platform-wide percent/rate display standard:
  //   - min 2 decimals
  //   - max `decimals` decimals (caller-controlled: 3 for interest, 4 for pro-rata, etc.)
  //   - suppress trailing zeros beyond the 2nd decimal place
  // Numeric value is preserved at full precision when persisted (numeric column),
  // so trimming the displayed string does not lose storage precision.
  const safeMax = Math.max(2, Math.min(4, decimals));
  let s = num.toFixed(safeMax);
  if (safeMax > 2) {
    const dot = s.indexOf('.');
    if (dot !== -1) {
      const head = s.slice(0, dot + 3);                // keep first 2 decimals
      const tail = s.slice(dot + 3).replace(/0+$/, ''); // trim zeros beyond 2nd
      s = tail ? head + tail : head;
    }
  }
  return s;
}

/** Validation error message */
export const INTEREST_VALIDATION_MESSAGE = 'Please enter a valid positive number in US format';

/** Negative value error message */
export const INTEREST_NEGATIVE_MESSAGE = 'Please enter 0 or a value greater than 0.';

/**
 * Check if a numeric string represents a negative value.
 * Returns true if the value is negative.
 */
export function isNegativeValue(value: string): boolean {
  if (!value || value.trim() === '') return false;
  const stripped = value.replace(/,/g, '');
  const num = parseFloat(stripped);
  return !isNaN(num) && num < 0;
}

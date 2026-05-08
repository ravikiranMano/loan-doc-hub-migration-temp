/**
 * Shared numeric input filter utilities for currency, percentage, and numeric fields.
 * Blocks non-numeric characters while allowing navigation and editing keys.
 */

import { formatPercentDisplay } from './precisionFormat';

const ALLOWED_KEYS = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];

/**
 * onKeyDown handler for currency/decimal fields.
 * Allows digits, one decimal point, and navigation keys.
 */
export const numericKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (ALLOWED_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/[\d.,]/.test(e.key)) {
    e.preventDefault();
    return;
  }
  // Prevent second decimal point
  if (e.key === '.' && e.currentTarget.value.includes('.')) {
    e.preventDefault();
  }
};

/**
 * onPaste handler for currency/decimal fields.
 * Strips non-numeric characters (except decimal) from pasted content.
 */
export const numericPaste = (
  e: React.ClipboardEvent<HTMLInputElement>,
  setter: (val: string) => void
) => {
  e.preventDefault();
  const cleaned = e.clipboardData.getData('text').replace(/[^\d.]/g, '');
  // Ensure only one decimal point
  const parts = cleaned.split('.');
  const result = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
  setter(result);
};

/**
 * onKeyDown handler for integer-only fields (e.g., credit score, months).
 * Allows digits only plus navigation keys.
 */
export const integerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (ALLOWED_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/\d/.test(e.key)) {
    e.preventDefault();
  }
};

/**
 * onPaste handler for integer-only fields.
 * Strips all non-digit characters.
 */
export const integerPaste = (
  e: React.ClipboardEvent<HTMLInputElement>,
  setter: (val: string) => void
) => {
  e.preventDefault();
  setter(e.clipboardData.getData('text').replace(/\D/g, ''));
};

/**
 * Format a raw numeric string as US currency display (comma-separated, 2 decimal places).
 * e.g. "3423" → "3,423.00", "50.5" → "50.50", "" → ""
 */
export const formatCurrencyDisplay = (value: string): string => {
  if (!value) return '';
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Strip commas from a formatted currency string for editing/storage.
 * e.g. "3,423.00" → "3423.00"
 */
export const unformatCurrencyDisplay = (value: string): string => {
  return value.replace(/,/g, '');
};

/**
 * Format a raw numeric string as percentage display (2 decimal places).
 * e.g. "25.5" → "25.50", "" → ""
 */
export const formatPercentageDisplay = (value: string): string => {
  if (!value) return '';
  // Re-use the platform-wide smart-trim formatter (min 2dp, max 4dp).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { formatPercentDisplay } = require('./precisionFormat');
  return formatPercentDisplay(value, 4);
};

/**
 * Strip % symbol from a formatted percentage string for editing/storage.
 */
export const unformatPercentageDisplay = (value: string): string => {
  return value.replace(/%/g, '').trim();
};

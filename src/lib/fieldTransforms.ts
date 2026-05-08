/**
 * Field Transform Utilities
 * 
 * Provides formatting transformations for document generation.
 * Stores canonical (raw) values in the database; formatted values only for display/export.
 */

import { format, parseISO, isValid } from 'date-fns';
import { formatPercentDisplay } from './precisionFormat';

export type TransformType = 
  | 'currency'
  | 'currency_words'
  | 'date_mmddyyyy'
  | 'date_long'
  | 'date_short'
  | 'uppercase'
  | 'titlecase'
  | 'lowercase'
  | 'percentage'
  | 'phone'
  | 'ssn_masked';

/**
 * Format a currency value for display
 * @param value - Raw numeric value (e.g., 150000.00)
 * @returns Formatted string (e.g., "$150,000.00")
 */
export function formatCurrency(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format currency in words (for legal documents)
 * @param value - Raw numeric value
 * @returns String like "One Hundred Fifty Thousand and 00/100 Dollars"
 */
export function formatCurrencyInWords(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  
  const dollars = Math.floor(num);
  const cents = Math.round((num - dollars) * 100);
  
  const words = numberToWords(dollars);
  return `${words} and ${cents.toString().padStart(2, '0')}/100 Dollars`;
}

/**
 * Convert number to words
 */
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const thousands = ['', 'Thousand', 'Million', 'Billion'];
  
  if (num === 0) return 'Zero';
  if (num < 0) return 'Negative ' + numberToWords(-num);
  
  let words = '';
  let i = 0;
  
  while (num > 0) {
    if (num % 1000 !== 0) {
      let chunk = '';
      const n = num % 1000;
      
      if (n >= 100) {
        chunk += ones[Math.floor(n / 100)] + ' Hundred ';
      }
      
      const remainder = n % 100;
      if (remainder >= 10 && remainder < 20) {
        chunk += teens[remainder - 10] + ' ';
      } else {
        if (remainder >= 20) {
          chunk += tens[Math.floor(remainder / 10)] + ' ';
        }
        if (remainder % 10 > 0) {
          chunk += ones[remainder % 10] + ' ';
        }
      }
      
      words = chunk + thousands[i] + ' ' + words;
    }
    num = Math.floor(num / 1000);
    i++;
  }
  
  return words.trim();
}

/**
 * Format a date in MM/DD/YYYY format
 * @param value - ISO date string (e.g., "2024-01-15")
 * @returns Formatted string (e.g., "01/15/2024")
 */
export function formatDateMMDDYYYY(value: string | null): string {
  if (!value) return '';
  try {
    const date = parseISO(value);
    if (!isValid(date)) return '';
    return format(date, 'MM/dd/yyyy');
  } catch {
    return '';
  }
}

/**
 * Format a date in long format
 * @param value - ISO date string
 * @returns Formatted string (e.g., "January 15, 2024")
 */
export function formatDateLong(value: string | null): string {
  if (!value) return '';
  try {
    const date = parseISO(value);
    if (!isValid(date)) return '';
    return format(date, 'MMMM d, yyyy');
  } catch {
    return '';
  }
}

/**
 * Format a date in short format
 * @param value - ISO date string
 * @returns Formatted string (e.g., "Jan 15, 2024")
 */
export function formatDateShort(value: string | null): string {
  if (!value) return '';
  try {
    const date = parseISO(value);
    if (!isValid(date)) return '';
    return format(date, 'MMM d, yyyy');
  } catch {
    return '';
  }
}

/**
 * Convert text to uppercase
 */
export function formatUppercase(value: string | null): string {
  if (!value) return '';
  return value.toUpperCase();
}

/**
 * Convert text to title case
 */
export function formatTitlecase(value: string | null): string {
  if (!value) return '';
  return value.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

/**
 * Convert text to lowercase
 */
export function formatLowercase(value: string | null): string {
  if (!value) return '';
  return value.toLowerCase();
}

/**
 * Format a percentage for display
 * @param value - Raw numeric value (e.g., 8.25)
 * @returns Formatted string (e.g., "8.250%")
 */
export function formatPercentage(value: string | number | null, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  return `${num.toFixed(decimals)}%`;
}

/**
 * Format phone number
 * @param value - Raw phone digits
 * @returns Formatted string (e.g., "(555) 123-4567")
 */
export function formatPhone(value: string | null): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value;
}

/**
 * Format SSN with masking (show only last 4)
 * @param value - Raw SSN digits
 * @returns Masked string (e.g., "XXX-XX-1234")
 */
export function formatSSNMasked(value: string | null): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 9) {
    return `XXX-XX-${digits.slice(5)}`;
  }
  return value;
}

/**
 * Apply a transform to a value
 * @param value - The raw value
 * @param transform - The transform type to apply
 * @returns The formatted value
 */
export function applyTransform(value: string | null, transform: TransformType): string {
  if (!value) return '';
  
  switch (transform) {
    case 'currency':
      return formatCurrency(value);
    case 'currency_words':
      return formatCurrencyInWords(value);
    case 'date_mmddyyyy':
      return formatDateMMDDYYYY(value);
    case 'date_long':
      return formatDateLong(value);
    case 'date_short':
      return formatDateShort(value);
    case 'uppercase':
      return formatUppercase(value);
    case 'titlecase':
      return formatTitlecase(value);
    case 'lowercase':
      return formatLowercase(value);
    case 'percentage':
      return formatPercentage(value);
    case 'phone':
      return formatPhone(value);
    case 'ssn_masked':
      return formatSSNMasked(value);
    default:
      return value;
  }
}

/**
 * Apply multiple transforms in sequence
 * @param value - The raw value
 * @param transforms - Array of transform types
 * @returns The formatted value
 */
export function applyTransforms(value: string | null, transforms: TransformType[]): string {
  if (!value || transforms.length === 0) return value || '';
  
  return transforms.reduce((result, transform) => applyTransform(result, transform), value);
}

/**
 * Parse a raw input value to canonical form for storage
 * This strips formatting and returns clean values
 */
export function parseToCanonical(value: string, dataType: string): string {
  if (!value) return '';
  
  switch (dataType) {
    case 'currency':
      // Remove everything except digits, decimal, and minus
      return value.replace(/[^0-9.\-]/g, '');
    case 'number':
    case 'percentage':
      // Remove everything except digits, decimal, and minus
      return value.replace(/[^0-9.-]/g, '');
    case 'phone':
      // Keep only digits
      return value.replace(/\D/g, '');
    default:
      return value.trim();
  }
}

/**
 * Format a display value for UI (non-destructive preview)
 */
export function formatForDisplay(value: string, dataType: string): string {
  if (!value) return '';
  
  switch (dataType) {
    case 'currency':
      const num = parseFloat(value);
      if (isNaN(num)) return value;
      // Show with commas but no $ prefix (prefix is handled separately in UI)
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num);
    case 'percentage':
      const pct = parseFloat(value);
      if (isNaN(pct)) return value;
      return pct.toFixed(2);
    default:
      return value;
  }
}

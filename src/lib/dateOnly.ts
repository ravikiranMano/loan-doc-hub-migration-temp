/**
 * Date-only utilities — keep dates in local timezone to avoid UTC shift.
 *
 * NEVER use `new Date('yyyy-MM-dd')` (parsed as UTC midnight → can shift back
 * one day in negative-offset timezones) or `date.toISOString().split('T')[0]`
 * (UTC date → can shift forward/back depending on local time of day).
 */
import { format, parse, isValid } from 'date-fns';

/**
 * Parse an input value into a local-midnight Date.
 * Accepts:
 *  - Date objects
 *  - 'yyyy-MM-dd' (canonical storage format)
 *  - 'MM/dd/yyyy' (canonical display format)
 *  - ISO timestamps ('yyyy-MM-ddTHH:mm:ss...') — the date portion is used
 */
export const parseDateOnly = (val?: string | Date | null): Date | undefined => {
  if (val == null || val === '') return undefined;
  if (val instanceof Date) return isValid(val) ? val : undefined;
  const s = String(val).trim();
  if (!s) return undefined;

  // Strip time portion from ISO timestamps so we parse as local-midnight.
  const dateOnlyStr = s.includes('T') ? s.split('T')[0] : s;

  const patterns = ['yyyy-MM-dd', 'MM/dd/yyyy', 'M/d/yyyy', 'yyyy/MM/dd'];
  for (const p of patterns) {
    try {
      const d = parse(dateOnlyStr, p, new Date());
      if (isValid(d)) return d;
    } catch {
      // try next
    }
  }
  return undefined;
};

/**
 * Strict MM/dd/yyyy parser for masked typed input.
 * Returns undefined for partials/invalid strings; never throws.
 */
export const parseDisplayDate = (input?: string | null): Date | undefined => {
  if (!input) return undefined;
  const s = input.trim();
  // Require complete MM/DD/YYYY shape before attempting a parse so partial
  // keystrokes don't false-positive ("1/2/2024" still accepted via M/d/yyyy).
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return undefined;
  try {
    const d = parse(s, s.length === 10 ? 'MM/dd/yyyy' : 'M/d/yyyy', new Date());
    return isValid(d) ? d : undefined;
  } catch {
    return undefined;
  }
};

/** Format a local Date without converting through UTC. */
export const formatDateOnly = (date?: Date | null, pattern = 'yyyy-MM-dd'): string => {
  if (!date || !isValid(date)) return '';
  return format(date, pattern);
};

/** Today as a local 'yyyy-MM-dd' string. */
export const todayDateOnly = (): string => format(new Date(), 'yyyy-MM-dd');

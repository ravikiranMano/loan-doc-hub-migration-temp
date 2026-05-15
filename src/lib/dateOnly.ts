/**
 * Date-only utilities — keep dates in local timezone to avoid UTC shift.
 *
 * NEVER use `new Date('yyyy-MM-dd')` (parsed as UTC midnight → can shift back
 * one day in negative-offset timezones) or `date.toISOString().split('T')[0]`
 * (UTC date → can shift forward/back depending on local time of day).
 */
import { format, parse, isValid } from 'date-fns';

/** Parse a 'yyyy-MM-dd' string into a local-midnight Date. */
export const parseDateOnly = (val?: string | null): Date | undefined => {
  if (!val) return undefined;
  try {
    const d = parse(val, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : undefined;
  } catch {
    return undefined;
  }
};

/** Format a Date as a local 'yyyy-MM-dd' string (no UTC shift). */
export const formatDateOnly = (date?: Date | null): string => {
  if (!date || !isValid(date)) return '';
  return format(date, 'yyyy-MM-dd');
};

/** Today as a local 'yyyy-MM-dd' string. */
export const todayDateOnly = (): string => format(new Date(), 'yyyy-MM-dd');

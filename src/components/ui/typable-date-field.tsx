import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, isValid, parse } from 'date-fns';

import { Input } from '@/components/ui/input';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDateOnly, parseDateOnly, parseDisplayDate } from '@/lib/dateOnly';

/**
 * Shared typable date input that mirrors the Maturity Date pattern globally:
 * - Manual MM/DD/YYYY entry with mid-edit cursor preservation
 * - Calendar icon opens EnhancedCalendar popover
 * - Calendar selection and manual entry stay synchronized
 *
 * Value contract: canonical 'yyyy-MM-dd' string in / out (empty string = unset).
 * Existing validation in the caller continues to run against the canonical value.
 */
export interface TypableDateFieldProps {
  value: string;
  onChange: (canonical: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  placeholder?: string;
  id?: string;
  hasError?: boolean;
  ariaLabel?: string;
  /** Optional: called when user blurs the text input. */
  onBlur?: () => void;
  /** Optional formatter override for display (default MM/dd/yyyy). */
  displayPattern?: string;
}

function maskDateInput(raw: string, prev = ''): string {
  let s = raw.replace(/[^\d/]/g, '');
  const growing = s.length > prev.length;
  if (growing) {
    if (s.length === 2 && !s.includes('/')) s = s + '/';
    if (s.length === 5 && s.indexOf('/', 3) === -1) s = s + '/';
  }
  if (s.length > 10) s = s.slice(0, 10);
  return s;
}

export const TypableDateField = React.forwardRef<HTMLInputElement, TypableDateFieldProps>(
  (
    {
      value,
      onChange,
      disabled,
      className,
      inputClassName,
      buttonClassName,
      placeholder = 'MM/DD/YYYY',
      id,
      hasError,
      ariaLabel,
      onBlur,
      displayPattern = 'MM/dd/yyyy',
    },
    forwardedRef,
  ) => {
    const parsed = React.useMemo(() => parseDateOnly(value), [value]);
    const displayValue = parsed && isValid(parsed) ? format(parsed, displayPattern) : '';

    const [typed, setTyped] = React.useState<string>(displayValue);
    const [open, setOpen] = React.useState(false);

    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    // Re-sync local typed text from upstream when not actively typing.
    React.useEffect(() => {
      if (document.activeElement !== innerRef.current) {
        setTyped(displayValue);
      }
    }, [displayValue]);

    const commit = (text: string) => {
      const t = (text || '').trim();
      if (!t) {
        onChange('');
        return;
      }
      const p = parseDisplayDate(t);
      if (p) onChange(formatDateOnly(p));
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target as HTMLInputElement;
      const rawValue = input.value;
      const rawCaret = input.selectionStart ?? rawValue.length;

      let digitsBeforeCaret = 0;
      for (let i = 0; i < rawCaret && i < rawValue.length; i++) {
        if (/\d/.test(rawValue[i])) digitsBeforeCaret++;
      }

      const masked = maskDateInput(rawValue, typed);

      let newCaret = 0;
      let seenDigits = 0;
      while (newCaret < masked.length && seenDigits < digitsBeforeCaret) {
        if (/\d/.test(masked[newCaret])) seenDigits++;
        newCaret++;
      }
      const growing = rawValue.length > typed.length;
      if (growing && masked[newCaret] === '/') newCaret++;

      setTyped(masked);
      requestAnimationFrame(() => {
        if (document.activeElement === input) {
          try { input.setSelectionRange(newCaret, newCaret); } catch { /* noop */ }
        }
      });

      if (masked === '') {
        onChange('');
        return;
      }
      if (masked.length === 10) commit(masked);
    };

    const handleBlur = () => {
      commit(typed);
      onBlur?.();
    };

    const calendarSelected = parsed && isValid(parsed) ? parsed : undefined;

    return (
      <div className={cn('relative w-full', className)}>
        <Input
          ref={innerRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={typed}
          disabled={disabled}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-label={ariaLabel}
          className={cn(
            'pr-9',
            hasError && 'border-destructive focus-visible:ring-destructive',
            inputClassName,
          )}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Open calendar"
              className={cn(
                'absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed',
                buttonClassName,
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={calendarSelected}
              month={calendarSelected}
              onSelect={(d: Date | undefined) => {
                if (d) {
                  const iso = formatDateOnly(d);
                  onChange(iso);
                  setTyped(format(d, displayPattern));
                }
                setOpen(false);
              }}
              onClear={() => {
                onChange('');
                setTyped('');
                setOpen(false);
              }}
              onToday={() => {
                const t = new Date();
                onChange(formatDateOnly(t));
                setTyped(format(t, displayPattern));
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);
TypableDateField.displayName = 'TypableDateField';

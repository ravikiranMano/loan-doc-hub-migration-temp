import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, isValid } from 'date-fns';

import { Input } from '@/components/ui/input';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDateOnly, parseDateOnly, parseDisplayDate } from '@/lib/dateOnly';

/**
 * Shared typable date input used app-wide.
 *
 * Caret-preservation strategy (root-cause fix):
 *  - On every change we extract the *digits only* the user produced and remember
 *    how many digits sit to the LEFT of the caret (digit-index). This is
 *    separator-agnostic, so inserting a "/" mid-edit can never confuse it.
 *  - We mask the digits deterministically into MM/DD/YYYY.
 *  - In useLayoutEffect (runs synchronously after React commits the controlled
 *    value, BEFORE paint), we walk the masked string and place the caret right
 *    after the Nth digit. requestAnimationFrame is too late and races React's
 *    reset of selectionStart on controlled inputs — which is the underlying
 *    cause of the "cursor jumps to end" bug.
 *
 * Value contract: canonical 'yyyy-MM-dd' string in/out (empty = unset).
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
  onBlur?: () => void;
  displayPattern?: string;
}

/** Mask up-to-8 digits into MM/DD/YYYY (partial accepted). */
function maskFromDigits(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Count digits in s[0..pos). */
function countDigits(s: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos && i < s.length; i++) if (/\d/.test(s[i])) n++;
  return n;
}

/** Find string index in masked that sits right after the Nth digit. */
function caretFromDigitIndex(masked: string, digitIndex: number): number {
  if (digitIndex <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      seen++;
      if (seen === digitIndex) {
        // Skip trailing separator so the next keystroke lands on the next digit slot.
        let j = i + 1;
        while (j < masked.length && masked[j] === '/') j++;
        return j;
      }
    }
  }
  return masked.length;
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
    const upstreamDisplay = parsed && isValid(parsed) ? format(parsed, displayPattern) : '';

    const [typed, setTyped] = React.useState<string>(upstreamDisplay);
    const [invalid, setInvalid] = React.useState(false);
    const [open, setOpen] = React.useState(false);

    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    // Pending caret restore (digit-index) — applied in useLayoutEffect.
    const pendingCaretRef = React.useRef<number | null>(null);

    // Track the canonical value we ourselves last pushed up. Anything else is
    // external (calendar pick, Clear, Today, parent reset) and must overwrite
    // the visible text — regardless of focus. Using focus as the gate left the
    // displayed text stale after a calendar pick when the input kept focus.
    const lastSelfCanonicalRef = React.useRef<string>(value);

    React.useEffect(() => {
      if (value !== lastSelfCanonicalRef.current) {
        setTyped(upstreamDisplay);
        setInvalid(false);
        lastSelfCanonicalRef.current = value;
      }
    }, [value, upstreamDisplay]);

    // Synchronous caret restore — runs after commit, before paint. This is the
    // key to preventing the "jump to end" behavior on controlled inputs.
    React.useLayoutEffect(() => {
      const el = innerRef.current;
      const target = pendingCaretRef.current;
      if (el && target != null && document.activeElement === el) {
        const pos = caretFromDigitIndex(typed, target);
        try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
      }
      pendingCaretRef.current = null;
    }, [typed]);

    const commit = (text: string) => {
      const t = (text || '').trim();
      if (!t) {
        setInvalid(false);
        onChange('');
        return;
      }
      const p = parseDisplayDate(t);
      if (p) {
        setInvalid(false);
        onChange(formatDateOnly(p));
      } else {
        setInvalid(true);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target as HTMLInputElement;
      const rawValue = input.value;
      const rawCaret = input.selectionStart ?? rawValue.length;

      // Digit index user expects caret to sit after, after re-masking.
      const digitsBeforeCaret = countDigits(rawValue, rawCaret);

      // Pure digits stream the user produced (separator chars ignored).
      const rawDigits = rawValue.replace(/\D/g, '').slice(0, 8);
      const masked = maskFromDigits(rawDigits);

      pendingCaretRef.current = Math.min(digitsBeforeCaret, rawDigits.length);
      setTyped(masked);

      if (masked === '') {
        setInvalid(false);
        onChange('');
        return;
      }
      // Only commit upstream once the user has a full MM/DD/YYYY (8 digits).
      if (rawDigits.length === 8) {
        commit(masked);
      } else {
        // Partial — clear invalid flag while still typing.
        setInvalid(false);
      }
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
          aria-invalid={hasError || invalid || undefined}
          className={cn(
            'pr-9',
            (hasError || invalid) && 'border-destructive focus-visible:ring-destructive',
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
                  setInvalid(false);
                }
                setOpen(false);
              }}
              onClear={() => {
                onChange('');
                setTyped('');
                setInvalid(false);
                setOpen(false);
              }}
              onToday={() => {
                const t = new Date();
                onChange(formatDateOnly(t));
                setTyped(format(t, displayPattern));
                setInvalid(false);
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        {invalid && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            Invalid date — use MM/DD/YYYY
          </p>
        )}
      </div>
    );
  },
);
TypableDateField.displayName = 'TypableDateField';

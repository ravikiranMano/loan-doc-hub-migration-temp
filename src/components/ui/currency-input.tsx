import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  formatCurrencyDisplay,
  unformatCurrencyDisplay,
  numericKeyDown,
  numericPaste,
} from '@/lib/numericInputFilter';
import { roundDollarForStorage } from '@/lib/precisionFormat';

interface CurrencyInputProps {
  value: string;
  onValueChange: (raw: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  showDollarPrefix?: boolean;
  allowNegative?: boolean;
  align?: 'left' | 'right';
  id?: string;
  'aria-label'?: string;
}

/**
 * Standard US currency input.
 *
 * Storage:  raw 2dp numeric string (e.g. "200000.00", "-50.25") — never commaed.
 * Display:  comma-grouped 2dp string when blurred (e.g. "200,000.00"),
 *           raw editable digits when focused.
 *
 * Behavior:
 *  - On focus: shows raw value (no commas / $) so the caret behaves naturally.
 *  - On blur: rounds to 2dp HALF_UP and emits the raw numeric string upward
 *    so storage stays clean. Display re-formats from that raw value.
 *  - Sanitizes keystrokes and paste, blocks a second decimal point.
 */
export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onValueChange,
  disabled = false,
  placeholder = '0.00',
  className,
  showDollarPrefix = true,
  allowNegative = false,
  align = 'left',
  id,
  'aria-label': ariaLabel,
}) => {
  const [focused, setFocused] = useState(false);

  const sanitize = (raw: string): string => {
    const allowed = allowNegative ? /[^0-9.-]/g : /[^0-9.]/g;
    let cleaned = String(raw).replace(allowed, '');
    if (allowNegative) {
      // Keep only leading '-' once
      const neg = cleaned.startsWith('-');
      cleaned = (neg ? '-' : '') + cleaned.replace(/-/g, '');
    }
    // Collapse multiple decimal points
    const parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    return cleaned;
  };

  // What's actually shown in the input
  const displayValue = focused
    ? unformatCurrencyDisplay(value || '')
    : formatCurrencyDisplay(unformatCurrencyDisplay(value || ''));

  return (
    <div className={cn('relative', showDollarPrefix ? '' : '')}>
      {showDollarPrefix && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          $
        </span>
      )}
      <Input
        id={id}
        aria-label={ariaLabel}
        value={displayValue}
        onChange={(e) => onValueChange(sanitize(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const raw = unformatCurrencyDisplay(value || '');
          if (!raw) return;
          const normalized = roundDollarForStorage(raw);
          if (normalized !== '' && normalized !== raw) onValueChange(normalized);
        }}
        onKeyDown={numericKeyDown}
        onPaste={(e) => numericPaste(e, (val) => onValueChange(sanitize(val)))}
        disabled={disabled}
        inputMode="decimal"
        placeholder={placeholder}
        className={cn(
          'h-7 text-xs',
          showDollarPrefix && 'pl-6',
          align === 'right' && 'text-right',
          className,
        )}
      />
    </div>
  );
};

export default CurrencyInput;

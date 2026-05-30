import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AlertCircle, Lock, Calculator, Asterisk, CheckCircle2, CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, parseDisplayDate, todayDateOnly } from '@/lib/dateOnly';
import { parseToCanonical, formatForDisplay } from '@/lib/fieldTransforms';
import { roundPctForStorage } from '@/lib/precisionFormat';
import { isNegativeValue, INTEREST_NEGATIVE_MESSAGE } from '@/lib/interestValidation';
import { useDirtyFields } from '@/contexts/DirtyFieldsContext';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';

interface DealFieldInputProps {
  field: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResult?: CalculationResult;
  hidePlaceholder?: boolean;
}

export const DealFieldInput: React.FC<DealFieldInputProps> = ({
  field,
  value,
  onChange,
  error = false,
  showValidation = false,
  disabled = false,
  calculationResult,
  hidePlaceholder = false,
}) => {
  const isDisabled = disabled || field.is_calculated;
  const showError = error && showValidation;
  const isComputed = calculationResult?.computed === true;
  const hasCalculationError = calculationResult?.error !== undefined;
  const { dirtyFieldKeys } = useDirtyFields();
  const isFieldDirty = dirtyFieldKeys.has(field.field_key);
  
  const [isFocused, setIsFocused] = useState(false);
  const [currencyValidationError, setCurrencyValidationError] = useState<string | null>(null);
  const [negativeValueError, setNegativeValueError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const isNumericType = ['number', 'currency', 'percentage', 'decimal', 'integer'].includes(field.data_type);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    const canonicalValue = parseToCanonical(rawValue, field.data_type);

    // Validate currency fields
    if (field.data_type === 'currency' && canonicalValue) {
      // Check for multiple decimal points
      if ((canonicalValue.match(/\./g) || []).length > 1) {
        setCurrencyValidationError('Invalid number format');
        return;
      }
      const num = parseFloat(canonicalValue);
      if (isNaN(num)) {
        setCurrencyValidationError('Please enter a valid dollar amount');
        return;
      }
    }
    setCurrencyValidationError(null);

    // Validate negative values for numeric fields
    if (isNumericType && isNegativeValue(canonicalValue)) {
      setNegativeValueError(INTEREST_NEGATIVE_MESSAGE);
      onChange(canonicalValue);
      return;
    }
    setNegativeValueError(null);

    onChange(canonicalValue);
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!value) {
      setNegativeValueError(null);
      return;
    }

    // Validate negative on blur
    if (isNumericType && isNegativeValue(value)) {
      setNegativeValueError(INTEREST_NEGATIVE_MESSAGE);
      return;
    }
    setNegativeValueError(null);

    let formattedValue = value;

    switch (field.data_type) {
      case 'currency':
        const currencyNum = parseFloat(value);
        if (!isNaN(currencyNum)) {
          formattedValue = currencyNum.toFixed(2);
        }
        break;
      case 'percentage': {
        // Store percent/rate at 4 decimals (platform-wide standard).
        const stored = roundPctForStorage(value);
        if (stored !== '') formattedValue = stored;
        break;
      }
      case 'number':
        const num = parseFloat(value);
        if (!isNaN(num)) {
          formattedValue = num.toString();
        }
        break;
    }

    if (formattedValue !== value) {
      onChange(formattedValue);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onChange(formatDateOnly(date));
    } else {
      onChange('');
    }
    setDatePickerOpen(false);
  };

  const getDisplayValue = (): string => {
    if (!value) return '';
    if (isFocused) return value;
    return formatForDisplay(value, field.data_type);
  };

  const getInputPrefix = () => {
    switch (field.data_type) {
      case 'currency':
        return '$';
      default:
        return null;
    }
  };

  const getInputSuffix = () => {
    switch (field.data_type) {
      case 'percentage':
        return '%';
      default:
        return null;
    }
  };

  // Render date picker — masked MM/DD/YYYY text input + calendar icon button.
  const renderDatePicker = () => {
    const selectedDate = parseDateOnly(value);
    const isValidDate = !!selectedDate;
    const displayValue = isValidDate ? formatDateOnly(selectedDate, 'MM/dd/yyyy') : '';

    return (
      <DateMaskedInput
        id={field.field_key}
        value={value || ''}
        displayValue={displayValue}
        selectedDate={isValidDate ? selectedDate : undefined}
        disabled={isDisabled}
        showError={showError}
        datePickerOpen={datePickerOpen}
        setDatePickerOpen={setDatePickerOpen}
        onChangeCanonical={(v) => onChange(v)}
        onCalendarSelect={handleDateSelect}
        onClear={() => { onChange(''); setDatePickerOpen(false); }}
        onToday={() => { onChange(todayDateOnly()); setDatePickerOpen(false); }}
      />
    );
  };

  // Render textarea for address fields
  const renderTextarea = () => (
    <Textarea
      id={field.field_key}
      value={value || ''}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      disabled={isDisabled}
      className={cn(
        'resize-none transition-colors text-xs min-h-[48px]',
        showError && 'border-destructive focus:ring-destructive bg-destructive/5',
        isDisabled && 'bg-muted cursor-not-allowed'
      )}
      rows={2}
      placeholder={hidePlaceholder ? undefined : (field.description || undefined)}
    />
  );

  // Render standard input
  const renderInput = () => {
    const prefix = getInputPrefix();
    const suffix = getInputSuffix();

    return (
      <div className="relative">
        {prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          id={field.field_key}
          type="text"
          inputMode={['number', 'currency', 'percentage', 'decimal', 'integer'].includes(field.data_type) ? 'decimal' : 'text'}
          value={getDisplayValue()}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          disabled={isDisabled}
          className={cn(
            'transition-colors h-7 text-xs',
            prefix && 'pl-5',
            suffix && 'pr-6',
            (showError || negativeValueError) && 'border-destructive focus:ring-destructive bg-destructive/5',
            isDisabled && 'bg-muted cursor-not-allowed'
          )}
          placeholder={hidePlaceholder ? undefined : (field.description || undefined)}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    );
  };

  // Render phone input
  const renderPhoneInput = () => (
    <Input
      id={field.field_key}
      type="tel"
      inputMode="tel"
      value={value || ''}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      disabled={isDisabled}
      className={cn(
        'transition-colors h-7 text-xs',
        showError && 'border-destructive focus:ring-destructive bg-destructive/5',
        isDisabled && 'bg-muted cursor-not-allowed'
      )}
      placeholder={hidePlaceholder ? undefined : (field.description || 'Phone number')}
    />
  );

  // Render section header (non-input)
  const renderSectionHeader = () => (
    <div className="col-span-full border-b border-border pb-1.5 mt-3 first:mt-0">
      <span className="font-semibold text-xs text-foreground">{field.label}</span>
    </div>
  );

  // Render label (static text, non-input)
  const renderLabel = () => (
    <p className="text-xs text-muted-foreground italic">{field.label}</p>
  );

  // Render template button
  const renderTemplateButton = () => (
    <Button
      variant="outline"
      size="sm"
      disabled={isDisabled}
      className="justify-start text-left h-7 py-1 text-xs"
      onClick={() => {
        console.log('Template clicked:', field.field_key);
      }}
    >
      {field.label}
    </Button>
  );

  // Render action button
  const renderActionButton = () => (
    <Button
      variant="default"
      size="sm"
      disabled={isDisabled}
      className="h-7 text-xs"
      onClick={() => {
        console.log('Action clicked:', field.field_key);
      }}
    >
      {field.label}
    </Button>
  );

  // Render file input
  const renderFileInput = () => (
    <Input
      id={field.field_key}
      type="file"
      disabled={isDisabled}
      className={cn(
        'transition-colors cursor-pointer h-7 text-xs',
        showError && 'border-destructive focus:ring-destructive bg-destructive/5',
        isDisabled && 'bg-muted cursor-not-allowed'
      )}
    />
  );

  // Render checkbox for boolean fields
  const renderCheckbox = () => (
    <div className="flex items-center h-7">
      <Checkbox
        id={field.field_key}
        checked={value === 'true'}
        onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
        disabled={isDisabled}
        className={cn(
          showError && 'border-destructive',
          isDisabled && 'cursor-not-allowed opacity-50'
        )}
      />
    </div>
  );

  // Choose the right input based on data type
  const renderFieldInput = () => {
    if (field.data_type === 'section') return renderSectionHeader();
    if (field.data_type === 'label') return renderLabel();
    if (field.data_type === 'template') return renderTemplateButton();
    if (field.data_type === 'action') return renderActionButton();
    if (field.data_type === 'file') return renderFileInput();
    if (field.data_type === 'phone') return renderPhoneInput();
    if (field.data_type === 'date') return renderDatePicker();
    if (field.data_type === 'boolean') return renderCheckbox();
    if (field.data_type === 'text' && field.field_key.toLowerCase().includes('addres')) return renderTextarea();
    return renderInput();
  };

  // For non-input types (section, label), render without the label wrapper
  const isNonInputType = ['section', 'label'].includes(field.data_type);
  
  if (isNonInputType) {
    return (
      <div id={`field-${field.field_key}`}>
        {renderFieldInput()}
      </div>
    );
  }

  return (
    <div className={cn("space-y-0.5 rounded-sm px-1 -mx-1 transition-colors", isFieldDirty && "bg-warning/10 ring-1 ring-warning/30")} id={`field-${field.field_key}`}>
      {/* Inline label + input row */}
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-1 w-[140px] shrink-0 pt-1.5">
          <Label
            htmlFor={field.field_key}
            className={cn(
              'text-xs font-medium leading-tight flex items-center gap-0.5',
              showError && 'text-destructive'
            )}
          >
            {field.label}
            {(field.is_required || field.is_mandatory) && (
              <span className="text-destructive" title="Required field">
                <Asterisk className="h-2.5 w-2.5" />
              </span>
            )}
          </Label>
          {field.is_calculated && (
            <span 
              title={isComputed ? "Calculated - value computed" : "Calculated field (waiting for dependencies)"} 
              className={cn(
                "flex items-center gap-0.5",
                isComputed ? "text-green-600" : "text-muted-foreground"
              )}
            >
              <Calculator className="h-3 w-3" />
              {isComputed && <CheckCircle2 className="h-2.5 w-2.5" />}
            </span>
          )}
          {isDisabled && !field.is_calculated && (
            <span title="Read-only" className="text-muted-foreground">
              <Lock className="h-3 w-3" />
            </span>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          {renderFieldInput()}
        </div>
      </div>
      
      {showError && (
        <p className="text-[10px] text-destructive flex items-center gap-0.5 animate-fade-in pl-[148px]">
          <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
          This field is required
        </p>
      )}
      
      {currencyValidationError && (
        <p className="text-[10px] text-destructive flex items-center gap-0.5 animate-fade-in pl-[148px]">
          <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
          {currencyValidationError}
        </p>
      )}

      {negativeValueError && (
        <p className="text-[10px] text-destructive flex items-center gap-0.5 animate-fade-in pl-[148px]">
          <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
          {negativeValueError}
        </p>
      )}

      {hasCalculationError && (
        <p className="text-[10px] text-amber-600 flex items-center gap-0.5 pl-[148px]">
          <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
          {calculationResult?.error}
        </p>
      )}
      
      {field.is_calculated && !isComputed && !hasCalculationError && (
        <p className="text-[10px] text-muted-foreground pl-[148px]">
          Waiting for: {field.calculation_dependencies.join(', ')}
        </p>
      )}
      
      {field.transform_rules.length > 0 && !showError && !field.is_calculated && (
        <p className="text-[10px] text-muted-foreground pl-[148px]">
          Format: {field.transform_rules.join(', ')}
        </p>
      )}
    </div>
  );
};

export default DealFieldInput;

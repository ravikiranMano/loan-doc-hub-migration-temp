import React, { useMemo, useCallback } from 'react';
import { BorrowerPrimaryForm } from './BorrowerPrimaryForm';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';

interface BorrowerCoBorrowerFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

/**
 * Co-borrower form (Contacts > Borrower > Co-borrower).
 *
 * Reuses the BorrowerPrimaryForm layout (same screenshot as Primary)
 * but transparently re-prefixes every `borrower.*` field key to
 * `coborrower.*` so values are persisted in an isolated namespace via
 * the existing save/update APIs (no schema or API changes).
 */
export const BorrowerCoBorrowerForm: React.FC<BorrowerCoBorrowerFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation,
  disabled,
  calculationResults,
}) => {
  // Map any `coborrower.*` value back to `borrower.*` so the inner form sees it.
  const proxyValues = useMemo(() => {
    const out: Record<string, string> = {};
    Object.entries(values).forEach(([key, val]) => {
      if (key.startsWith('coborrower.')) {
        out['borrower.' + key.slice('coborrower.'.length)] = val;
      }
    });
    return out;
  }, [values]);

  const handleProxyChange = useCallback(
    (fieldKey: string, value: string) => {
      const translated = fieldKey.startsWith('borrower.')
        ? 'coborrower.' + fieldKey.slice('borrower.'.length)
        : fieldKey;
      onValueChange(translated, value);
    },
    [onValueChange]
  );

  return (
    <BorrowerPrimaryForm
      fields={fields}
      values={proxyValues}
      onValueChange={handleProxyChange}
      showValidation={showValidation}
      disabled={disabled}
      calculationResults={calculationResults}
      borrowerIdLookup
    />
  );
};

export default BorrowerCoBorrowerForm;

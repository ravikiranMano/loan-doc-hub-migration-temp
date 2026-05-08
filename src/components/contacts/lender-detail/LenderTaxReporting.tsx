import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


interface LenderTaxReportingProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
}

// Per spec field keys (used for backend / document mapping):
//   origination_app.tax_reporting.designated_recipient
//   origination_app.tax_reporting.issue_1099
//   origination_app.tax_reporting.tin_number
//   origination_app.tax_reporting.tin_type
//   origination_app.tax_reporting.tin_verified
//   origination_app.tax_reporting.alternate_reporting
//   origination_app.tax_reporting.notes
// Within the Lender layout (which strips/adds the `lender.` prefix on save),
// we persist them under `lender.tax_reporting.*` so they round-trip into
// contacts.contact_data.tax_reporting.* — addressable in document generation.
const K = {
  designated: 'lender.tax_reporting.designated_recipient',
  issue1099: 'lender.tax_reporting.issue_1099',
  tinNumber: 'lender.tax_reporting.tin_number',
  tinType: 'lender.tax_reporting.tin_type',
  tinVerified: 'lender.tax_reporting.tin_verified',
  altReporting: 'lender.tax_reporting.alternate_reporting',
  notes: 'lender.tax_reporting.notes',
  manualFlag: 'lender.tax_reporting.is_issue_1099_manually_modified',
};

// Lender / Borrower / Co-borrower type → Issue 1099 default
// Yes / No / 'conditional' (LLC) / '' (Investment Fund — leave blank)
const TYPE_TO_1099: Record<string, 'Yes' | 'No' | 'conditional' | ''> = {
  'Individual': 'Yes',
  'Joint': 'Yes',
  'Family Trust': 'Yes',
  'LLC': 'conditional',
  'C Corp / S Corp': 'No',
  'IRA / ERISA': 'No',
  'Investment Fund': '',
  '401k': 'No',
  'Foreign Holder W-8': 'No',
  'Non-profit': 'No',
};

const computeIssue1099 = (entityType: string, taxedAsCorp: boolean): string => {
  const rule = TYPE_TO_1099[entityType];
  if (rule === undefined) return '';
  if (rule === 'conditional') return taxedAsCorp ? 'No' : 'Yes';
  return rule; // 'Yes' | 'No' | ''
};

const LenderTaxReporting: React.FC<LenderTaxReportingProps> = ({ values, onValueChange, disabled = false }) => {
  const designated = values[K.designated] === 'true';
  const issue1099Raw = values[K.issue1099] || '';
  const tinNumber = values[K.tinNumber] || '';
  const tinType = values[K.tinType] || '';
  const tinVerified = values[K.tinVerified] === 'true';
  const altReporting = values[K.altReporting] || '';
  const notes = values[K.notes] || '';
  const manuallyModified = values[K.manualFlag] === 'true';

  // Resolve entity type with priority: borrower -> coborrower -> lender
  const borrowerType = values['lender.origination_app.borrower.type'] || values['borrower.type'] || '';
  const coborrowerType = values['lender.origination_app.coborrower.type'] || values['coborrower.type'] || '';
  const lenderType = values['lender.type'] || '';

  const taxedAsCorpBorrower = (values['lender.origination_app.borrower.taxed_as_corp'] || values['borrower.taxed_as_corp']) === 'true';
  const taxedAsCorpLender = values['lender.taxed_as_corp'] === 'true';

  const resolvedType = borrowerType || coborrowerType || lenderType;
  const resolvedTaxedAsCorp = borrowerType
    ? taxedAsCorpBorrower
    : coborrowerType
      ? taxedAsCorpBorrower
      : taxedAsCorpLender;

  // Auto-populate Issue 1099 unless user has manually overridden
  const lastAutoRef = useRef<string | null>(null);
  useEffect(() => {
    if (manuallyModified) return;
    const auto = computeIssue1099(resolvedType, resolvedTaxedAsCorp);
    if (auto !== issue1099Raw && auto !== lastAutoRef.current) {
      lastAutoRef.current = auto;
      onValueChange(K.issue1099, auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedType, resolvedTaxedAsCorp, manuallyModified]);

  const setIssue1099Manual = (val: string) => {
    onValueChange(K.issue1099, val);
    onValueChange(K.manualFlag, 'true');
  };

  // ===== TIN Validation (aligned with 1099 form: src/lib/tinValidation.ts) =====
  // TIN Type codes here: '1' = EIN, '2' = SSN, '0'/'' = Unknown
  // Map to the shared utility's 'SSN' | 'EIN' contract.
  const mappedTinKind: 'SSN' | 'EIN' = tinType === '2' ? 'SSN' : 'EIN';

  const [tinFocused, setTinFocused] = useState(false);
  const [tinTouched, setTinTouched] = useState(false);

  const tinError = useMemo(() => {
    if (!tinTouched) return '';
    const digits = (tinNumber || '').replace(/\D/g, '');
    if (digits.length === 0) return '';
    if (digits.length !== 9) return 'TIN must be exactly 9 digits';
    if (!validateTIN(digits, mappedTinKind)) return 'Invalid TIN format based on selected TIN Type';
    return '';
  }, [tinTouched, tinNumber, mappedTinKind]);

  const tinDisplay = useMemo(() => {
    if (!tinNumber) return '';
    if (tinFocused) return formatTIN(tinNumber, mappedTinKind);
    return maskTIN(tinNumber, mappedTinKind);
  }, [tinNumber, mappedTinKind, tinFocused]);

  const handleTinChange = (raw: string) => {
    // Strip non-digits, cap at 9 — store digits only (no hyphens)
    const digits = stripTINInput(raw);
    onValueChange(K.tinNumber, digits);
  };


  return (
    <div className="space-y-6 max-w-2xl">
      <h4 className="text-lg font-semibold text-foreground">Tax Reporting</h4>

      <div className="space-y-4">
        {/* Designated Recipient */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="lender-tax-designated"
            checked={designated}
            onCheckedChange={(v) => onValueChange(K.designated, String(!!v))}
            disabled={disabled}
          />
          <Label htmlFor="lender-tax-designated">Designated Recipient</Label>
        </div>

        {/* Issue 1099 (auto-populated, editable) */}
        <div>
          <Label>Issue 1099</Label>
          <Select
            value={issue1099Raw || '__none__'}
            onValueChange={(v) => setIssue1099Manual(v === '__none__' ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Auto-populated from entity type. Editable — manual changes are preserved.
          </p>
        </div>

        {/* TIN Number + TIN Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>TIN Number</Label>
            <Input
              value={tinDisplay}
              onFocus={() => setTinFocused(true)}
              onBlur={() => { setTinFocused(false); setTinTouched(true); }}
              onChange={(e) => handleTinChange(e.target.value)}
              disabled={disabled}
              maxLength={mappedTinKind === 'SSN' ? 11 : 10}
              inputMode="numeric"
              placeholder={mappedTinKind === 'SSN' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
              aria-invalid={!!tinError}
            />
            {tinError && (
              <p className="text-[11px] text-destructive mt-1">{tinError}</p>
            )}
          </div>
          <div>
            <Label>TIN Type</Label>
            <Select
              value={tinType || '__none__'}
              onValueChange={(v) => onValueChange(K.tinType, v === '__none__' ? '' : v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                <SelectItem value="0">0 – Unknown</SelectItem>
                <SelectItem value="1">1 – EIN</SelectItem>
                <SelectItem value="2">2 – SSN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* TIN Verified */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="lender-tax-tin-verified"
            checked={tinVerified}
            onCheckedChange={(v) => onValueChange(K.tinVerified, String(!!v))}
            disabled={disabled}
          />
          <Label htmlFor="lender-tax-tin-verified">TIN Verified</Label>
        </div>

        {/* Alternate Reporting */}
        <div>
          <Label>Alternate Reporting</Label>
          <Input
            value={altReporting}
            onChange={(e) => onValueChange(K.altReporting, e.target.value)}
            disabled={disabled}
            maxLength={200}
          />
        </div>

        {/* Notes */}
        <div>
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => onValueChange(K.notes, e.target.value)}
            disabled={disabled}
            rows={4}
            maxLength={2000}
          />
        </div>
      </div>
    </div>
  );
};

export default LenderTaxReporting;

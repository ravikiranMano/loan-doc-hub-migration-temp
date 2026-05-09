import React, { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TaxPartyType = 'lender' | 'borrower' | 'coborrower' | 'broker';

interface TaxReportingCardProps {
  /**
   * Which party context this card is rendered in. Drives the Issue 1099
   * auto-population logic and the source of the entity-type field.
   */
  partyType: TaxPartyType;
  /**
   * Prefix used by the parent layout's `values` map (e.g. 'lender.',
   * 'borrower.', 'coborrower.', 'broker.'). All TaxReportingCard fields are
   * persisted under `{prefix}tax_info.<field>` and round-trip via the
   * existing contact save/update API.
   */
  prefix: string;
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
}

// Field keys (relative to {prefix}tax_info.*)
const F = {
  designated: 'tax_info.designated_recipient',
  issue1099: 'tax_info.issue_1099',
  tinNumber: 'tax_info.tin_number',
  tinType: 'tax_info.tin_type',
  w9OnFile: 'tax_info.w9_on_file',
  tinVerified: 'tax_info.tin_verified',
  altReporting: 'tax_info.alternate_reporting',
  notes: 'tax_info.notes',
  manualFlag: 'tax_info.is_issue_1099_manually_modified',
};

// Lender / Borrower / Co-borrower type → Issue 1099 default
const TYPE_TO_1099: Record<string, 'Yes' | 'No' | 'conditional'> = {
  Individual: 'Yes',
  Joint: 'Yes',
  'Family Trust': 'conditional',
  LLC: 'conditional',
  'Investment Fund': 'conditional',
  'C Corp / S Corp': 'No',
  'IRA / ERISA': 'No',
  '401K': 'No',
  '401k': 'No',
  'Foreign Holder W-8': 'No',
  'Non-profit': 'No',
};

const computeIssue1099Default = (
  partyType: TaxPartyType,
  entityType: string,
  taxedAsCorp: boolean,
): string => {
  if (partyType === 'broker') return 'Yes'; // Always 1099-NEC
  if (!entityType) return '';
  const rule = TYPE_TO_1099[entityType];
  if (rule === undefined) return '';
  if (rule === 'conditional') return taxedAsCorp ? 'No' : 'Yes';
  return rule;
};

const TaxReportingCard: React.FC<TaxReportingCardProps> = ({
  partyType,
  prefix,
  values,
  onValueChange,
  disabled = false,
}) => {
  const k = (f: string) => `${prefix}${f}`;
  const get = (f: string) => values[k(f)] || '';
  const set = (f: string, v: string) => onValueChange(k(f), v);

  // --- Resolve entity type for auto-population ---
  // Look at the canonical type field on the parent record. We deliberately
  // read from the parent prefix only to avoid cross-party leakage.
  const entityTypeKey =
    partyType === 'lender'
      ? `${prefix}type`
      : partyType === 'broker'
        ? `${prefix}type`
        : partyType === 'coborrower'
          ? `${prefix}type`
          : `${prefix}type`;

  const entityType = values[entityTypeKey] || '';
  const taxedAsCorp = (values[`${prefix}taxed_as_corp`] || '') === 'true';
  const manuallyModified = get(F.manualFlag) === 'true';
  const issue1099 = get(F.issue1099);

  // Auto-populate Issue 1099 unless the user has manually overridden.
  const lastAutoRef = useRef<string | null>(null);
  useEffect(() => {
    if (manuallyModified) return;
    const auto = computeIssue1099Default(partyType, entityType, taxedAsCorp);
    if (auto !== issue1099 && auto !== lastAutoRef.current) {
      lastAutoRef.current = auto;
      set(F.issue1099, auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType, entityType, taxedAsCorp, manuallyModified]);

  const setIssue1099Manual = (v: string) => {
    set(F.issue1099, v);
    set(F.manualFlag, 'true');
  };

  const idPrefix = `tax-card-${partyType}`;

  const typeLabel =
    partyType === 'lender'
      ? 'Lender type'
      : partyType === 'broker'
        ? 'Broker type'
        : partyType === 'coborrower'
          ? 'Co-borrower type'
          : 'Borrower type';

  const ENTITY_TYPE_OPTIONS = [
    'Individual',
    'Joint',
    'Family Trust',
    'LLC',
    'Investment Fund',
    'C Corp / S Corp',
    'IRA / ERISA',
    '401K',
    'Foreign Holder W-8',
    'Non-profit',
  ];

  return (
    <Card className="p-6 max-w-2xl">
      <h4 className="text-lg font-semibold text-foreground mb-4">Tax reporting</h4>

      <div className="space-y-4">
        {/* Entity type */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label className="text-sm">{typeLabel}</Label>
          <Select
            value={entityType || '__none__'}
            onValueChange={(v) => onValueChange(entityTypeKey, v === '__none__' ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 max-w-[260px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__none__">— None —</SelectItem>
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Designated recipient */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label htmlFor={`${idPrefix}-designated`} className="text-sm">
            Designated recipient
          </Label>
          <div>
            <Checkbox
              id={`${idPrefix}-designated`}
              checked={get(F.designated) === 'true'}
              onCheckedChange={(v) => set(F.designated, String(!!v))}
              disabled={disabled}
            />
          </div>
        </div>

        {/* Issue 1099 */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label className="text-sm">Issue 1099</Label>
          <Select
            value={issue1099 || '__none__'}
            onValueChange={(v) => setIssue1099Manual(v === '__none__' ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 max-w-[220px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__none__">— None —</SelectItem>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* TIN Number */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label htmlFor={`${idPrefix}-tin-number`} className="text-sm">
            TIN Number
          </Label>
          <Input
            id={`${idPrefix}-tin-number`}
            value={get(F.tinNumber)}
            onChange={(e) => set(F.tinNumber, e.target.value)}
            disabled={disabled}
            maxLength={20}
            className="h-9 max-w-[260px]"
          />
        </div>

        {/* TIN Type */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label className="text-sm">TIN Type</Label>
          <Select
            value={get(F.tinType) || '__none__'}
            onValueChange={(v) => set(F.tinType, v === '__none__' ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 max-w-[220px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__none__">— None —</SelectItem>
              <SelectItem value="0">0 – Unknown</SelectItem>
              <SelectItem value="1">1 – EIN</SelectItem>
              <SelectItem value="2">2 – SSN</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* W-9 on File */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label htmlFor={`${idPrefix}-w9`} className="text-sm">
            W-9 on File
          </Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-w9`}
              checked={get(F.w9OnFile) === 'true'}
              onCheckedChange={(v) => set(F.w9OnFile, String(!!v))}
              disabled={disabled}
            />
            <Label htmlFor={`${idPrefix}-w9`} className="text-sm text-muted-foreground">
              X&nbsp;&nbsp;W-9 on File
            </Label>
          </div>
        </div>

        {/* TIN Verified */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label htmlFor={`${idPrefix}-tin-verified`} className="text-sm">
            TIN Verified
          </Label>
          <Input
            id={`${idPrefix}-tin-verified`}
            value={get(F.tinVerified)}
            onChange={(e) => set(F.tinVerified, e.target.value)}
            disabled={disabled}
            maxLength={50}
            className="h-9 max-w-[260px]"
          />
        </div>

        {/* Alternate Reporting */}
        <div className="grid grid-cols-[180px_1fr] items-center gap-3">
          <Label htmlFor={`${idPrefix}-alt`} className="text-sm">
            Alternate Reporting
          </Label>
          <Input
            id={`${idPrefix}-alt`}
            value={get(F.altReporting)}
            onChange={(e) => set(F.altReporting, e.target.value)}
            disabled={disabled}
            maxLength={200}
            className="h-9"
          />
        </div>

        {/* Notes (full-width textarea) */}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-notes`} className="text-sm">
            Notes
          </Label>
          <Textarea
            id={`${idPrefix}-notes`}
            value={get(F.notes)}
            onChange={(e) => set(F.notes, e.target.value)}
            disabled={disabled}
            rows={4}
            maxLength={2000}
          />
        </div>
      </div>
    </Card>
  );
};

export default TaxReportingCard;

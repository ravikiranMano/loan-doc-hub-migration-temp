import { PrismaService } from '../../prisma/prisma.service';
import { applyRe851dBridges } from './re851d-properties.builder';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedDealField {
  rawValue: string;
  dataType: string;
}

type JsonbCell = {
  value_text?: string | null;
  value_number?: unknown;
  value_date?: unknown;
  value_json?: unknown;
  indexed_key?: string;
};

/**
 * Loads merge-ready field values from deal_section_values (same source as generate-document edge).
 * deal_field_values rows are merged when present (usually empty on CSR-saved deals).
 */
export class DealFieldValuesLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadByFieldKey(dealId: string, deal?: { borrower_name?: string | null }): Promise<Map<string, ResolvedDealField>> {
    const fieldValues = new Map<string, ResolvedDealField>();

    const sectionValues = await this.prisma.deal_section_values.findMany({
      where: { deal_id: dealId },
      select: { section: true, field_values: true },
    });

    const dictIdSet = new Set<string>();
    for (const sv of sectionValues) {
      const fv = (sv.field_values ?? {}) as Record<string, JsonbCell>;
      for (const key of Object.keys(fv)) {
        const dictId = key.includes('::') ? key.split('::')[1] : key;
        if (dictId && UUID_RE.test(dictId)) dictIdSet.add(dictId);
      }
    }

    const dictEntries =
      dictIdSet.size > 0
        ? await this.prisma.field_dictionary.findMany({
            where: { id: { in: [...dictIdSet] } },
            select: { id: true, field_key: true, data_type: true },
          })
        : [];

    const dictById = new Map(dictEntries.map((d) => [d.id, d]));

    const setValue = (key: string, raw: string | number | null, dataType: string) => {
      if (raw === null || raw === undefined) return;
      const rawStr = String(raw).trim();
      if (!rawStr) return;
      fieldValues.set(key, { rawValue: rawStr, dataType: dataType || 'text' });
    };

    for (const sv of sectionValues) {
      const fv = (sv.field_values ?? {}) as Record<string, JsonbCell>;
      for (const [key, cell] of Object.entries(fv)) {
        const dictId = key.includes('::') ? key.split('::')[1] : key;
        if (!dictId || !UUID_RE.test(dictId)) continue;

        const dict = dictById.get(dictId);
        if (!dict) continue;

        const dataType = dict.data_type || 'text';
        const raw = this.extractRawValueFromJsonb(cell, dataType);
        const indexedKey = cell?.indexed_key;
        const resolvedKey = indexedKey || dict.field_key;

        setValue(resolvedKey, raw, dataType);

        if (indexedKey && indexedKey !== dict.field_key) {
          const canonicalHasIndex = /^[a-zA-Z_]+\d+\./.test(dict.field_key);
          if (!canonicalHasIndex && !fieldValues.has(dict.field_key)) {
            setValue(dict.field_key, raw, dataType);
          }
        }
      }
    }

    // Ensure canonical field_key is set even when indexed_key took priority in loop order
    for (const sv of sectionValues) {
      const fv = (sv.field_values ?? {}) as Record<string, JsonbCell>;
      for (const [key, cell] of Object.entries(fv)) {
        const dictId = key.includes('::') ? key.split('::')[1] : key;
        if (!dictId || !UUID_RE.test(dictId)) continue;
        const dict = dictById.get(dictId);
        if (!dict || fieldValues.has(dict.field_key)) continue;
        const dataType = dict.data_type || 'text';
        const raw = this.extractRawValueFromJsonb(cell, dataType);
        setValue(dict.field_key, raw, dataType);
      }
    }

    // Normalized table (when populated)
    const normalized = await this.prisma.deal_field_values.findMany({
      where: { deal_id: dealId, field_dictionary_id: { not: null } },
    });
    if (normalized.length > 0) {
      const normDictIds = [...new Set(normalized.map((r) => r.field_dictionary_id!))];
      const normDicts = await this.prisma.field_dictionary.findMany({
        where: { id: { in: normDictIds } },
        select: { id: true, field_key: true, data_type: true },
      });
      const normById = new Map(normDicts.map((d) => [d.id, d]));
      for (const row of normalized) {
        const dict = normById.get(row.field_dictionary_id!);
        if (!dict) continue;
        const raw = this.extractFromNormalizedRow(row);
        if (raw != null) setValue(dict.field_key, raw, dict.data_type || 'text');
      }
    }

    await this.applyLenderBridges(dealId, fieldValues);
    this.applyBasicBridges(fieldValues, deal);
    this.applyRe885Bridges(fieldValues);
    applyRe851dBridges(fieldValues);

    return fieldValues;
  }

  /**
   * RE885 / origination_fees publishers mirrored from generate-document edge (subset for v2).
   */
  private applyRe885Bridges(fieldValues: Map<string, ResolvedDealField>): void {
    const get = (k: string) => fieldValues.get(k)?.rawValue;
    const setBool = (key: string, on: boolean) => {
      fieldValues.set(key, { rawValue: on ? 'true' : 'false', dataType: 'boolean' });
    };
    const toBool = (v: unknown): boolean => {
      if (v === true) return true;
      if (v === false || v == null) return false;
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'checked' || s === 'on';
    };
    const setIfEmpty = (key: string, raw: string, dataType = 'text') => {
      if (!raw || fieldValues.has(key)) return;
      const existing = get(key);
      if (existing != null && String(existing).trim() !== '') return;
      fieldValues.set(key, { rawValue: raw, dataType });
    };

    const aliasPairs: Array<{ out: string; sources: string[]; dataType?: string }> = [
      { out: 'of_re_subtotalDeductions', sources: ['of_re_subtotalDeductions', 'origination_fees.re885_subtotal_deductions'] },
      {
        out: 'origination_fees.re885_cash_at_closing_amount',
        sources: [
          'origination_fees.re885_cash_at_closing_amount',
          'of_re_cashAtClosingAmount',
          're885_cash_at_closing_amount',
        ],
      },
      { out: 'of_int_days', sources: ['of_int_days', 'origination_fees.901_interest_for_days_days'], dataType: 'number' },
      { out: 'of_int_pd', sources: ['of_int_pd', 'origination_fees.901_interest_for_days_per_day'], dataType: 'currency' },
      { out: 'of_haz_mon', sources: ['of_haz_mon', 'origination_fees.1001_hazard_insurance_months'], dataType: 'number' },
      { out: 'of_haz_amt', sources: ['of_haz_amt', 'origination_fees.1001_hazard_insurance_per_month'], dataType: 'currency' },
      { out: 'of_mi_mon', sources: ['of_mi_mon', 'origination_fees.1002_mortgage_insurance_months'], dataType: 'number' },
      { out: 'of_mi_amt', sources: ['of_mi_amt', 'origination_fees.1002_mortgage_insurance_per_month'], dataType: 'currency' },
      { out: 'of_tax_mon', sources: ['of_tax_mon', 'origination_fees.1004_co_property_taxes_months'], dataType: 'number' },
      { out: 'of_tax_amt', sources: ['of_tax_amt', 'origination_fees.1004_co_property_taxes_per_month'], dataType: 'currency' },
    ];

    for (const { out, sources, dataType } of aliasPairs) {
      if (get(out)) continue;
      for (const s of sources) {
        const v = get(s);
        if (v) {
          setIfEmpty(out, v, dataType ?? 'text');
          break;
        }
      }
    }

    const payable =
      get('of_fe_estimatedCashPayableToYou') ??
      get('origination_fees.re885_cash_payable_to_you');
    const mustPay =
      get('of_fe_estimatedCashYouMustPay') ??
      get('origination_fees.re885_cash_you_must_pay');
    if (payable != null) setBool('of_fe_estimatedCashPayableToYou', toBool(payable));
    if (mustPay != null) setBool('of_fe_estimatedCashYouMustPay', toBool(mustPay));

    const unit = (
      get('of_re_loanTermUnit') ??
      get('origination_fees.re885_loan_term_unit') ??
      ''
    )
      .trim()
      .toLowerCase();
    setBool('of_re_proposedLoanTerm.years', unit === 'years' || unit === 'year' || unit === 'y');
    setBool('of_re_proposedLoanTerm.months', unit === 'months' || unit === 'month' || unit === 'm');

    const fixedRaw =
      get('origination_fees.re885_rate_type_fixed') ?? get('of_re_rateTypeFixed');
    const adjRaw =
      get('origination_fees.re885_rate_type_adjustable') ?? get('of_re_rateTypeAdjustable');
    setBool('of_re_interestRate.fixed', toBool(fixedRaw));
    setBool('of_re_interestRate.adjustable', toBool(adjRaw));

    const ppRaw =
      get('loan_terms.penalties.prepayment.enabled') ??
      get('loan_terms.prepayment_penalty_enabled');
    setBool('ln_pn_prepaymePenalt', toBool(ppRaw));

    const igRaw = get('loan_terms.penalties.interest_guarantee.enabled');
    setBool('loan_terms.penalties.interest_guarantee.enabled', toBool(igRaw));

    const vFully =
      get('of_re_vFullyIndexedRate') ??
      get('origination_fees.re885_v_fully_indexed_rate');
    if (vFully) {
      setIfEmpty('of_re_vfullyIndexedRate', vFully);
      setIfEmpty('of_re_vFullyIndexedRate', vFully);
    }
  }

  /**
   * Primary lender: deal_participants → contacts (CSR Lender Info).
   * Loads contact values into merge keys. Does NOT clear vesting for Individual — v2
   * templates use {{#}} / {{^}} sections so docxtemplater decides what prints at runtime.
   * (v1 generate-document still blanks ld_p_vesting for Individual for legacy flat tags.)
   */
  private async applyLenderBridges(
    dealId: string,
    fieldValues: Map<string, ResolvedDealField>,
  ): Promise<void> {
    const lenderParticipants = await this.prisma.deal_participants.findMany({
      where: { deal_id: dealId, role: 'lender' },
      orderBy: [{ sequence_order: 'asc' }, { created_at: 'asc' }],
      select: { contact_id: true, sequence_order: true },
    });

    const ordered = [...lenderParticipants].sort((a, b) => {
      const aSeq =
        typeof a.sequence_order === 'number' ? a.sequence_order : Number.MAX_SAFE_INTEGER;
      const bSeq =
        typeof b.sequence_order === 'number' ? b.sequence_order : Number.MAX_SAFE_INTEGER;
      return aSeq - bSeq;
    });

    const primaryContactId = ordered.find((p) => p.contact_id)?.contact_id;
    if (!primaryContactId) return;

    const contactRows = await this.prisma.contacts.findMany({
      where: { id: { in: ordered.map((p) => p.contact_id).filter(Boolean) as string[] } },
      select: { id: true, first_name: true, last_name: true, contact_data: true },
    });
    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const contact = contactById.get(primaryContactId);
    if (!contact) return;

    /** Same rule as generate-document setIfEmpty: fill only when missing or empty. */
    const setIfEmpty = (key: string, raw: string) => {
      if (!raw) return;
      const existing = fieldValues.get(key)?.rawValue;
      if (existing != null && String(existing).trim() !== '') return;
      fieldValues.set(key, { rawValue: raw, dataType: 'text' });
    };

    const cd = (contact.contact_data ?? {}) as Record<string, unknown>;
    const first = String(cd.first_name ?? contact.first_name ?? '').trim();
    const middle = String(cd.middle_initial ?? cd.middle_name ?? '').trim();
    const last = String(cd.last_name ?? contact.last_name ?? '').trim();
    const fullName =
      [first, middle, last].filter(Boolean).join(' ') || String(cd.full_name ?? '').trim();

    setIfEmpty('ld_p_firstName', first);
    setIfEmpty('ld_p_middleName', middle);
    setIfEmpty('ld_p_lastName', last);
    setIfEmpty('ld_p_lenderName', fullName);
    setIfEmpty('lender.name', fullName);

    setIfEmpty('ld_p_lenderType', String(cd.type ?? '').trim());

    // Contact vesting → merge keys (generate-document inject ~860–869); visibility is template-driven in v2
    const primaryVesting = cd.vesting != null ? String(cd.vesting).trim() : '';
    const fallbackVesting = ordered
      .map((p) => {
        if (!p.contact_id) return '';
        const c = contactById.get(p.contact_id);
        const v = (c?.contact_data as Record<string, unknown> | null)?.vesting;
        return v != null ? String(v).trim() : '';
      })
      .find((v) => v !== '');
    const lVesting = primaryVesting || fallbackVesting || '';
    if (lVesting) {
      setIfEmpty('ld_p_vesting', lVesting);
      setIfEmpty('ld_p_vestin', lVesting);
      setIfEmpty('lender.vesting', lVesting);
      setIfEmpty('lender1.vesting', lVesting);
    }

    // Template aliases for IQ-style tags (names only — spacing for {{first}}{{middle}}{{last}} layout)
    const firstRaw = (fieldValues.get('ld_p_firstName')?.rawValue ?? '').toString();
    const middleRaw = (fieldValues.get('ld_p_middleName')?.rawValue ?? '').toString();
    const lastRaw = (fieldValues.get('ld_p_lastName')?.rawValue ?? '').toString();
    const withTrailingSpace = (v: string) => {
      const t = v.trim();
      return t ? `${t} ` : '';
    };

    fieldValues.set('ld_p_firstIfEntityUse', {
      rawValue: withTrailingSpace(firstRaw),
      dataType: 'text',
    });
    fieldValues.set('ld_p_middle', { rawValue: withTrailingSpace(middleRaw), dataType: 'text' });
    fieldValues.set('ld_p_last', { rawValue: lastRaw.trim(), dataType: 'text' });

    const finalVesting = (fieldValues.get('ld_p_vesting')?.rawValue ?? '').toString();
    fieldValues.set('ld_p_vestin', { rawValue: finalVesting, dataType: 'text' });
  }

  /** Mirrors generate-document br_p_fullName auto-compute (simplified). */
  private applyBasicBridges(
    fieldValues: Map<string, ResolvedDealField>,
    deal?: { borrower_name?: string | null },
  ): void {
    const get = (k: string) => fieldValues.get(k)?.rawValue;

    if (!get('br_p_fullName')) {
      const fromIndexed =
        get('borrower1.full_name') || get('borrower.full_name');
      if (fromIndexed) {
        fieldValues.set('br_p_fullName', { rawValue: fromIndexed, dataType: 'text' });
      } else {
        const parts = [
          get('borrower1.first_name') || get('borrower.first_name') || get('br_p_firstName'),
          get('borrower1.middle_initial') || get('borrower.middle_initial') || get('br_p_middleInitia'),
          get('borrower1.last_name') || get('borrower.last_name') || get('br_p_lastName'),
        ].filter(Boolean);
        if (parts.length > 0) {
          fieldValues.set('br_p_fullName', {
            rawValue: parts.join(' '),
            dataType: 'text',
          });
        } else {
          const loanDetails = get('loan_terms.details_borrower_name');
          if (loanDetails) {
            fieldValues.set('br_p_fullName', { rawValue: loanDetails, dataType: 'text' });
          } else if (deal?.borrower_name?.trim()) {
            fieldValues.set('br_p_fullName', {
              rawValue: deal.borrower_name.trim(),
              dataType: 'text',
            });
          }
        }
      }
    }
  }

  private extractRawValueFromJsonb(
    data: JsonbCell,
    dataType: string,
  ): string | number | null {
    switch (dataType) {
      case 'currency':
      case 'number':
      case 'percentage':
      case 'decimal':
      case 'integer':
        return data.value_number != null
          ? String(data.value_number)
          : data.value_text ?? null;
      case 'date':
      case 'datetime':
        return data.value_date != null
          ? String(data.value_date)
          : data.value_text ?? null;
      default:
        return data.value_text ?? null;
    }
  }

  private extractFromNormalizedRow(row: {
    value_text?: string | null;
    value_number?: unknown;
    value_date?: unknown;
    value_json?: unknown;
  }): string | null {
    if (row.value_text != null) return row.value_text;
    if (row.value_number != null) return String(row.value_number);
    if (row.value_date != null) return (row.value_date as Date).toISOString().split('T')[0];
    if (row.value_json != null) return JSON.stringify(row.value_json);
    return null;
  }
}

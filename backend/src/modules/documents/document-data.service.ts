import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DealFieldValuesLoader } from './deal-field-values.loader';
import { buildRe851dPropertiesArray } from './re851d-properties.builder';
import { TemplateConditionInfo, TemplateInspectResult } from './template-inspect.util';

export interface TemplateFieldData {
  data: Record<string, unknown>;
  metadata: {
    dealId: string;
    dealNumber: string;
    templateId: string;
    templateName: string;
    filePath: string;
    fieldMapCount: number;
    resolvedCount: number;
    /** Where v2 loaded deal values (edge uses deal_section_values). */
    valueSource?: string;
    /** Merge tags found in the DOCX (e.g. br_p_fullName). */
    templateTagKeys?: string[];
    /** Non-empty values among templateTagKeys only. */
    templateResolvedCount?: number;
    /** Section/condition expressions from InspectModule (e.g. ld_p_lenderType == 'Individual'). */
    templateConditions?: TemplateConditionInfo[];
    /** Nested getAllTags() tree from docxtemplater. */
    templateTagTree?: Record<string, unknown>;
  };
}

@Injectable()
export class DocumentDataService {
  private readonly dealFieldLoader: DealFieldValuesLoader;

  constructor(private readonly prisma: PrismaService) {
    this.dealFieldLoader = new DealFieldValuesLoader(prisma);
  }

  async buildTemplateData(dealId: string, templateId: string): Promise<TemplateFieldData> {
    // ── 1. Load deal + template ──────────────────────────────────────────────
    const [deal, template] = await Promise.all([
      this.prisma.deals.findUnique({ where: { id: dealId } }),
      this.prisma.templates.findUnique({ where: { id: templateId } }),
    ]);
    if (!deal) throw new NotFoundException(`Deal ${dealId} not found`);
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);
    if (!template.file_path) throw new NotFoundException(`Template ${templateId} has no DOCX file uploaded`);

    // ── 2. Load field values (deal_section_values — same as generate-document edge) ──
    const fieldValuesByKey = await this.dealFieldLoader.loadByFieldKey(dealId, {
      borrower_name: deal.borrower_name,
    });

    // ── 3. Load transform rules from template_field_maps ─────────────────────
    // For _vDT copies (no field maps yet), fall back to the original template.
    let fieldMaps = await this.prisma.template_field_maps.findMany({
      where: { template_id: templateId },
    });

    if (fieldMaps.length === 0 && template.name.endsWith('_vDT')) {
      const originalName = template.name.slice(0, -4);
      const original = await this.prisma.templates.findFirst({
        where: { name: originalName, is_active: true },
      });
      if (original) {
        fieldMaps = await this.prisma.template_field_maps.findMany({
          where: { template_id: original.id },
        });
      }
    }

    const transformByFieldKey = new Map<string, string>();
    if (fieldMaps.length > 0) {
      const mapDictIds = [
        ...new Set(fieldMaps.map((fm) => fm.field_dictionary_id).filter(Boolean)),
      ] as string[];
      const mapDicts =
        mapDictIds.length > 0
          ? await this.prisma.field_dictionary.findMany({
              where: { id: { in: mapDictIds } },
              select: { id: true, field_key: true },
            })
          : [];
      const keyById = new Map(mapDicts.map((d) => [d.id, d.field_key]));
      for (const fm of fieldMaps) {
        if (!fm.field_dictionary_id || !fm.transform_rule) continue;
        const fk = keyById.get(fm.field_dictionary_id);
        if (fk) transformByFieldKey.set(fk, fm.transform_rule);
      }
    }

    // ── 4. Build resolved data object ────────────────────────────────────────
    const data: Record<string, unknown> = {};
    let resolvedCount = 0;

    for (const [fieldKey, { rawValue, dataType }] of fieldValuesByKey) {
      const transform = transformByFieldKey.get(fieldKey);
      const resolved = this.applyTransform(rawValue, transform, dataType);
      data[fieldKey] = resolved;
      if (resolved) resolvedCount++;
    }

    // ── 5. Computed fields ───────────────────────────────────────────────────
    data['currentDate'] = this.formatDate(new Date().toISOString(), 'long');

    // ── 6. RE851D LTV loop array ─────────────────────────────────────────────
    const properties = buildRe851dPropertiesArray(fieldValuesByKey);
    if (properties.length > 0) {
      data['properties'] = properties;
    }

    // ── 7. Build dot-notation nested objects ─────────────────────────────────
    // {{broker.first_name}} requires data.broker = { first_name: "..." }
    this.buildNestedObjects(data);

    return {
      data,
      metadata: {
        dealId,
        dealNumber: deal.deal_number,
        templateId,
        templateName: template.name,
        filePath: template.file_path,
        fieldMapCount: fieldMaps.length,
        resolvedCount,
        valueSource: 'deal_section_values',
        templateTagKeys: undefined,
        templateResolvedCount: undefined,
      },
    };
  }

  /**
   * Restricts inspect output to template merge fields + condition driver fields.
   */
  applyTemplateInspect(fieldData: TemplateFieldData, inspect: TemplateInspectResult): TemplateFieldData {
    const keysToInclude = new Set(inspect.mergeFieldKeys);
    for (const cond of inspect.conditions) {
      if (cond.driverField) keysToInclude.add(cond.driverField);
    }

    const scoped: Record<string, unknown> = {};
    let templateResolvedCount = 0;

    for (const key of [...keysToInclude].sort()) {
      const trimmedKey = key.trim();
      const val =
        fieldData.data[trimmedKey] ??
        fieldData.data[key];
      const resolved = val != null && String(val).trim() !== '' ? String(val) : '';
      scoped[trimmedKey] = resolved;
      if (resolved) templateResolvedCount++;
    }

    const templateConditions = inspect.conditions.map((cond) => {
      const driverValue =
        cond.driverField != null ? String(fieldData.data[cond.driverField] ?? '').trim() : '';
      return {
        ...cond,
        driverValue,
        driverResolved: driverValue !== '',
        matchesCompare:
          cond.operator != null &&
          cond.compareValue != null &&
          cond.driverField != null &&
          this.conditionMatches(cond.operator, driverValue, cond.compareValue),
      };
    });

    // Preserve loop arrays (e.g. {{#properties}}) — merge keys are nested field names only.
    for (const cond of inspect.conditions) {
      if (cond.operator != null || !cond.driverField) continue;
      const loopVal = fieldData.data[cond.driverField];
      if (Array.isArray(loopVal)) scoped[cond.driverField] = loopVal;
    }

    return {
      data: scoped,
      metadata: {
        ...fieldData.metadata,
        templateTagKeys: inspect.mergeFieldKeys,
        templateConditions,
        templateTagTree: inspect.tagTree,
        templateResolvedCount,
        resolvedCount: templateResolvedCount,
      },
    };
  }

  private conditionMatches(operator: string, actual: string, expected: string): boolean {
    switch (operator) {
      case '==':
      case '===':
        return actual === expected;
      case '!=':
      case '!==':
        return actual !== expected;
      default:
        return false;
    }
  }

  // ─── Transform engine ────────────────────────────────────────────────────────

  applyTransform(value: string, transform?: string, dataType?: string): string {
    if (!value || value.trim() === '') return '';

    switch (transform) {
      case 'currency':        return this.formatCurrency(value);
      case 'currency_words':  return this.toWords(parseFloat(value));
      case 'date_mmddyyyy':   return this.formatDate(value, 'mmddyyyy');
      case 'date_long':       return this.formatDate(value, 'long');
      case 'date_short':      return this.formatDate(value, 'short');
      case 'uppercase':       return value.toUpperCase();
      case 'titlecase':       return this.toTitleCase(value);
      case 'lowercase':       return value.toLowerCase();
      case 'percentage':      return this.formatPercentage(value);
      case 'phone':           return this.formatPhone(value);
      case 'ssn_masked':      return this.maskSSN(value);
      case 'words':           return this.toWords(parseFloat(value));
      case 'checkbox':        return this.toBool(value) ? '☑' : '☐';
      case 'checkbox_yes_no': return this.toBool(value) ? 'Yes' : 'No';
      case 'checkbox_x':      return this.toBool(value) ? 'X' : '';
      default:
        if (dataType === 'date')       return this.formatDate(value, 'mmddyyyy');
        if (dataType === 'boolean')    return this.toBool(value) ? '☑' : '☐';
        if (dataType === 'currency')   return this.formatCurrency(value);
        if (dataType === 'percentage') return this.formatPercentage(value);
        if (dataType === 'phone')      return this.formatPhone(value);
        return value;
    }
  }

  // ─── Dot-notation nested objects ─────────────────────────────────────────────

  private buildNestedObjects(data: Record<string, unknown>): void {
    for (const key of Object.keys(data)) {
      if (!key.includes('.')) continue;
      const parts = key.split('.');
      let cursor = data as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cursor[parts[i]] === undefined || typeof cursor[parts[i]] !== 'object') {
          cursor[parts[i]] = {};
        }
        cursor = cursor[parts[i]] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]] = data[key];
    }
  }

  // ─── Format helpers ──────────────────────────────────────────────────────────

  private formatCurrency(value: string): string {
    const n = parseFloat(value);
    if (isNaN(n)) return value;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  private formatDate(value: string, style: 'mmddyyyy' | 'long' | 'short'): string {
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return value;
      if (style === 'mmddyyyy') {
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${mm}/${dd}/${d.getUTCFullYear()}`;
      }
      if (style === 'long') {
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      }
      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
    } catch {
      return value;
    }
  }

  private formatPercentage(value: string): string {
    const n = parseFloat(value);
    if (isNaN(n)) return value;
    return `${parseFloat(n.toFixed(3))}%`;
  }

  private formatPhone(value: string): string {
    const d = value.replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return value;
  }

  private maskSSN(value: string): string {
    const d = value.replace(/\D/g, '');
    if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return value;
  }

  private toBool(value: string): boolean {
    const v = String(value).toLowerCase().trim();
    return v === 'true' || v === 'yes' || v === '1' || v === 'x' || v === 'on';
  }

  private toTitleCase(value: string): string {
    return value.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  private toWords(n: number): string {
    if (isNaN(n)) return '';
    const u = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const whole = Math.floor(Math.abs(n));
    const cents = Math.round((Math.abs(n) % 1) * 100);
    return `${this.intToWords(whole, u, t) || 'Zero'} and ${String(cents).padStart(2, '0')}/100 Dollars`;
  }

  private intToWords(n: number, u: string[], t: string[]): string {
    if (n === 0) return '';
    if (n < 20) return u[n];
    if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? ` ${u[n % 10]}` : '');
    if (n < 1_000) return `${u[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${this.intToWords(n % 100, u, t)}` : ''}`;
    if (n < 1_000_000) return `${this.intToWords(Math.floor(n / 1_000), u, t)} Thousand${n % 1_000 ? ` ${this.intToWords(n % 1_000, u, t)}` : ''}`;
    if (n < 1_000_000_000) return `${this.intToWords(Math.floor(n / 1_000_000), u, t)} Million${n % 1_000_000 ? ` ${this.intToWords(n % 1_000_000, u, t)}` : ''}`;
    return n.toString();
  }
}

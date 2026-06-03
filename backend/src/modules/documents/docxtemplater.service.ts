import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { DocumentDataService, TemplateFieldData } from './document-data.service';
import {
  buildTemplateInspectResult,
  TemplateInspectResult,
} from './template-inspect.util';

/** docxtemplater ships inspect-module as CJS: `module.exports = () => new InspectModule()` */
type InspectModuleInstance = {
  getAllTags(): Record<string, unknown>;
  getAllStructuredTags?(): Array<{ type?: string; value?: string; module?: string }>;
};

type InspectModuleFactory = () => InspectModuleInstance;

/** docxtemplater/expressions.js — enables {{#expr}}, {{^expr}}, {{field}} (see docxtemplater angular-parse docs). */
type AngularExpressionParser = (tag: string) => {
  get: (scope: Record<string, unknown>, context?: unknown) => unknown;
};

export interface GeneratedDocxResult {
  buffer: Buffer;
  filename: string;
  templateName: string;
  fieldData: TemplateFieldData;
}

/** v2 templates must use clean {{field_key}} tags — no custom XML preprocessing (unlike v1 edge). */
const V2_TEMPLATE_HINT =
  'Fix the DOCX template for v2: type each placeholder as one unbroken {{field_key}} in Word ' +
  '(do not paste from PDF/email). Split runs and Word MERGEFIELD markup are not supported in v2.';

@Injectable()
export class DocxtemplaterService {
  private readonly logger = new Logger(DocxtemplaterService.name);

  constructor(
    private readonly dataService: DocumentDataService,
    private readonly config: ConfigService,
  ) {}

  async generate(dealId: string, templateId: string): Promise<GeneratedDocxResult> {
    const fieldData = await this.dataService.buildTemplateData(dealId, templateId);
    const templateBuffer = await this.downloadTemplate(fieldData.metadata.filePath);
    const enriched = await this.enrichFieldDataFromTemplateBuffer(fieldData, templateBuffer);
    const buffer = this.renderDocx(templateBuffer, enriched.data, enriched.metadata.templateName);

    const safeBase = enriched.metadata.templateName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      buffer,
      filename: `${safeBase}_${enriched.metadata.dealNumber}_v2.docx`,
      templateName: enriched.metadata.templateName,
      fieldData: enriched,
    };
  }

  async enrichFieldDataFromTemplateBuffer(
    fieldData: TemplateFieldData,
    templateBuffer: Buffer,
  ): Promise<TemplateFieldData> {
    const inspect = this.inspectTemplate(templateBuffer, fieldData.metadata.templateName);
    return this.dataService.applyTemplateInspect(fieldData, inspect);
  }

  async enrichFieldDataFromFilePath(fieldData: TemplateFieldData): Promise<TemplateFieldData> {
    const templateBuffer = await this.downloadTemplate(fieldData.metadata.filePath);
    return this.enrichFieldDataFromTemplateBuffer(fieldData, templateBuffer);
  }

  async inspectFromFilePath(filePath: string, templateName: string): Promise<TemplateInspectResult> {
    const buffer = await this.downloadTemplate(filePath);
    return this.inspectTemplate(buffer, templateName);
  }

  async getDocumentText(filePath: string): Promise<string> {
    const buffer = await this.downloadTemplate(filePath);
    const zip = new PizZip(buffer);
    const xml = zip.files['word/document.xml']?.asText() ?? '';
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private async downloadTemplate(filePath: string): Promise<Buffer> {
    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.getOrThrow<string>('supabase.serviceRoleKey');
    const storage = createClient(supabaseUrl, serviceRoleKey).storage;

    const { data, error } = await storage.from('templates').download(filePath);

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to download template file "${filePath}": ${error?.message ?? 'no data'}`,
      );
    }

    return Buffer.from(await data.arrayBuffer());
  }

  /** Tag/condition schema via docxtemplater InspectModule (no hand-written XML parsing). */
  private inspectTemplate(templateBuffer: Buffer, templateName: string): TemplateInspectResult {
    const inspectModule = this.createInspectModuleInstance();
    try {
      this.createDocxtemplater(new PizZip(templateBuffer), inspectModule);
      const result = buildTemplateInspectResult(inspectModule.getAllTags());
      this.logTemplateInspect(templateName, inspectModule, 'ok', result);
      return result;
    } catch (err: unknown) {
      this.logTemplateInspectFailure(templateName, err);
      throw this.wrapTemplateError(templateName, err);
    }
  }

  private renderDocx(
    templateBuffer: Buffer,
    data: Record<string, unknown>,
    templateName: string,
  ): Buffer {
    try {
      const doc = this.createDocxtemplater(new PizZip(templateBuffer));
      doc.render(data);
      return doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      }) as Buffer;
    } catch (err: unknown) {
      throw this.wrapTemplateError(templateName, err);
    }
  }

  private createInspectModuleInstance(): InspectModuleInstance {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('docxtemplater/js/inspect-module.js') as
      | InspectModuleFactory
      | { default?: InspectModuleFactory };
    const factory =
      typeof mod === 'function' ? mod : typeof mod?.default === 'function' ? mod.default : null;
    if (!factory) {
      throw new InternalServerErrorException(
        'docxtemplater inspect-module failed to load (server misconfiguration, not a template issue)',
      );
    }
    return factory();
  }

  private getAngularExpressionParser(): AngularExpressionParser {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expressionParser = require('docxtemplater/expressions.js') as {
      configure: (opts: { filters?: Record<string, unknown> }) => AngularExpressionParser;
    };
    return expressionParser.configure({ filters: {} });
  }

  private createDocxtemplater(zip: PizZip, inspectModule?: InspectModuleInstance): Docxtemplater {
    const modules = inspectModule ? [inspectModule] : [];
    return new Docxtemplater(zip, {
      modules,
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: () => '',
      parser: this.getAngularExpressionParser(),
    });
  }

  /**
   * Logs when template parse fails (inspect never attaches).
   * Output is in the **backend** terminal running `npm run start:dev`, not the browser console.
   */
  private logTemplateInspectFailure(templateName: string, err: unknown): void {
    const details = this.extractDocxtemplaterErrors(err);
    console.log('\n========== [v2 template inspect] PARSE FAILED ==========');
    console.log('template:', templateName);
    console.log('errors:', details.join('\n  '));
    console.log('hint: fix closers — each {{#…}} and {{^…}} needs its own {{/}} or {{/expr}}');
    console.log('=======================================================\n');
    this.logger.warn(
      `[v2 template inspect] "${templateName}" parse failed — ${details.join('; ')} (see backend terminal)`,
    );
  }

  /**
   * Logs docxtemplater InspectModule output when Inspect field data or generate-v2 runs.
   * Watch the **backend** Nest terminal (`npm run start:dev`) for `[v2 template inspect]`.
   */
  private logTemplateInspect(
    templateName: string,
    inspectModule: InspectModuleInstance,
    status: 'ok',
    result: TemplateInspectResult,
  ): void {
    const tagTree = result.tagTree;
    const flatKeys = result.mergeFieldKeys;

    let structured: Array<{ type?: string; value?: string; module?: string }> = [];
    if (typeof inspectModule.getAllStructuredTags === 'function') {
      try {
        structured = inspectModule.getAllStructuredTags().map((part) => ({
          type: part.type,
          value: part.value,
          module: part.module,
        }));
      } catch (err: unknown) {
        structured = [{ value: `getAllStructuredTags failed: ${err instanceof Error ? err.message : String(err)}` }];
      }
    }

    console.log(`\n========== [v2 template inspect] ${status.toUpperCase()} ==========`);
    console.log('template:', templateName);
    console.log('getAllTags (tree):', JSON.stringify(tagTree, null, 2));
    console.log('flat merge keys (used for field-data-v2):', flatKeys);
    console.log('conditions:', JSON.stringify(result.conditions, null, 2));
    console.log('getAllStructuredTags (parts):', JSON.stringify(structured, null, 2));
    console.log('==========================================\n');

    this.logger.log(
      `[v2 template inspect] "${templateName}" — ${flatKeys.length} merge keys, ${result.conditions.length} conditions (see console above)`,
    );
  }

  private wrapTemplateError(templateName: string, err: unknown): InternalServerErrorException {
    if (err instanceof InternalServerErrorException) return err;

    const subErrors = this.extractDocxtemplaterErrors(err);
    const detail = subErrors.length
      ? subErrors.join('; ')
      : err instanceof Error
        ? err.message
        : String(err);

    if (this.isServerSideDocxtemplaterError(detail)) {
      this.logger.error(`docxtemplater setup failed for "${templateName}": ${detail}`, err);
      return new InternalServerErrorException(
        `Document generation (v2) failed due to a server configuration error: ${detail}`,
      );
    }

    this.logger.error(`docxtemplater failed for "${templateName}": ${detail}`, err);
    return new InternalServerErrorException(
      `Template "${templateName}" is not valid for v2 generation. ${detail}. ${V2_TEMPLATE_HINT}`,
    );
  }

  private isServerSideDocxtemplaterError(detail: string): boolean {
    return /not a constructor|factory is not a function|inspect-module failed to load/i.test(
      detail,
    );
  }

  private extractDocxtemplaterErrors(err: unknown): string[] {
    if (!err || typeof err !== 'object') return [String(err)];
    const e = err as Record<string, unknown>;
    const props = e['properties'] as Record<string, unknown> | undefined;
    const errors = props?.['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((sub: unknown) => {
        if (!sub || typeof sub !== 'object') return String(sub);
        const s = sub as Record<string, unknown>;
        const subProps = s['properties'] as Record<string, unknown> | undefined;
        const id = subProps?.['id'] ?? 'unknown';
        const explanation = subProps?.['explanation'] ?? s['message'] ?? String(sub);
        const tag = subProps?.['tag'] ?? subProps?.['xtag'] ?? '';
        return tag ? `[${id}] tag={${tag}} ${explanation}` : `[${id}] ${explanation}`;
      });
    }
    return [(e['message'] as string) ?? String(err)];
  }
}

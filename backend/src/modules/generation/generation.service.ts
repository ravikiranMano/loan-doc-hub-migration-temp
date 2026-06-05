import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { $Enums, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DealFieldValuesLoader } from '../documents/deal-field-values.loader';
import { processDocx } from './utils/docx-processor.util';
import { setMergeTagMappingsCache, setFieldKeyMappingsCache } from './utils/field-resolver.util';
import type { FieldValueData, LabelMapping } from './utils/types';

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly fieldLoader: DealFieldValuesLoader;

  private cacheExpiresAt = 0;
  private cachedMergeTagMap: Record<string, string> = {};
  private cachedLabelMap: Record<string, LabelMapping> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.fieldLoader = new DealFieldValuesLoader(prisma);
  }

  private async refreshCacheIfNeeded(): Promise<void> {
    if (Date.now() < this.cacheExpiresAt) return;

    const [aliases, migrations, dictEntries] = await Promise.all([
      this.prisma.merge_tag_aliases.findMany({
        where: { is_active: true },
        select: { tag_name: true, field_key: true, tag_type: true, replace_next: true },
      }),
      this.prisma.field_key_migrations.findMany({ select: { old_key: true, new_key: true } }),
      this.prisma.field_dictionary.findMany({
        where: { canonical_key: { not: null } },
        select: { field_key: true, canonical_key: true },
      }),
    ]);

    const mergeTagMap: Record<string, string> = {};
    const labelMap: Record<string, LabelMapping> = {};

    for (const alias of aliases) {
      if (alias.tag_type === 'merge_tag' || alias.tag_type === 'f_code') {
        mergeTagMap[alias.tag_name] = alias.field_key;
      } else if (alias.tag_type === 'label') {
        labelMap[alias.tag_name] = {
          fieldKey: alias.field_key,
          replaceNext: alias.replace_next ?? undefined,
        };
      }
    }

    const migrationsMap = new Map<string, string>();
    for (const m of migrations) migrationsMap.set(m.old_key.toLowerCase(), m.new_key);

    const canonicalKeyMap = new Map<string, string>();
    for (const d of dictEntries) {
      if (d.canonical_key) canonicalKeyMap.set(d.canonical_key.toLowerCase(), d.field_key);
    }

    setMergeTagMappingsCache(mergeTagMap, labelMap);
    setFieldKeyMappingsCache(migrationsMap, canonicalKeyMap);

    this.cachedMergeTagMap = mergeTagMap;
    this.cachedLabelMap = labelMap;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  async generate(
    dealId: string,
    templateId: string,
    requestedBy: string,
    outputType = 'docx_only',
  ): Promise<{ success: boolean; documentId?: string; docxUrl?: string; templateName: string }> {
    if (!requestedBy) throw new BadRequestException('Authentication required');

    await this.refreshCacheIfNeeded();

    const [template, deal] = await Promise.all([
      this.prisma.templates.findUnique({ where: { id: templateId } }),
      this.prisma.deals.findUnique({ where: { id: dealId } }),
    ]);

    if (!template) throw new NotFoundException(`Template '${templateId}' not found`);
    if (!deal) throw new NotFoundException(`Deal '${dealId}' not found`);
    if (!template.file_path) throw new BadRequestException('No DOCX file uploaded for this template');

    const job = await this.prisma.generation_jobs.create({
      data: {
        deal_id: dealId,
        requested_by: requestedBy,
        request_type: 'single_doc',
        template_id: templateId,
        output_type: outputType as $Enums.output_type,
        status: 'running',
        started_at: new Date(),
      } as unknown as Prisma.generation_jobsUncheckedCreateInput,
    });

    try {
      const { fieldValues: rawFieldValues } = await this.fieldLoader.loadByFieldKey(dealId, {
        borrower_name: deal.borrower_name,
      });

      const fieldValues = new Map<string, FieldValueData>();
      for (const [key, { rawValue, dataType }] of rawFieldValues) {
        fieldValues.set(key, { rawValue, dataType });
      }

      const fieldMaps = await this.prisma.template_field_maps.findMany({
        where: { template_id: templateId },
        include: { field_dictionary: { select: { field_key: true } } },
      });
      const fieldTransforms = new Map<string, string>();
      for (const fm of fieldMaps) {
        if (fm.transform_rule && fm.field_dictionary?.field_key) {
          fieldTransforms.set(fm.field_dictionary.field_key, fm.transform_rule);
        }
      }

      const allDict = await this.prisma.field_dictionary.findMany({ select: { field_key: true } });
      const validFieldKeys = new Set(allDict.map((d) => d.field_key));

      const { buffer: templateBuffer } = await this.storage.download('templates', template.file_path);

      const outputBuffer = await processDocx(
        new Uint8Array(templateBuffer),
        fieldValues,
        fieldTransforms,
        this.cachedMergeTagMap,
        this.cachedLabelMap,
        validFieldKeys,
        { templateName: template.name },
      );

      const safeBase = template.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeBase}_${deal.deal_number}_v1.docx`;
      const storagePath = `${dealId}/${filename}`;

      await this.storage.upload(
        'generated-docs',
        storagePath,
        Buffer.from(outputBuffer),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        true,
      );

      const docxUrl = await this.storage.getSignedUrl('generated-docs', storagePath, 3600);

      const doc = await this.prisma.generated_documents.create({
        data: {
          deal_id: dealId,
          template_id: templateId,
          output_docx_path: storagePath,
          output_type: outputType as $Enums.output_type,
          generation_status: 'success',
          template_name: template.name,
          created_by: requestedBy,
          generation_batch_id: job.id,
        } as unknown as Prisma.generated_documentsUncheckedCreateInput,
      });

      await this.prisma.generation_jobs.update({
        where: { id: job.id },
        data: { status: 'success', completed_at: new Date() } as unknown as Prisma.generation_jobsUncheckedUpdateInput,
      });

      await this.prisma.activity_log.create({
        data: {
          deal_id: dealId,
          actor_user_id: requestedBy,
          action_type: 'document_generated',
          action_details: {
            templateId,
            templateName: template.name,
            documentId: doc.id,
            engine: 'v1',
          } as Prisma.InputJsonValue,
        } as unknown as Prisma.activity_logUncheckedCreateInput,
      });

      return { success: true, documentId: doc.id, docxUrl, templateName: template.name };
    } catch (err) {
      await this.prisma.generation_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completed_at: new Date(),
          error_message: (err as Error).message,
        } as unknown as Prisma.generation_jobsUncheckedUpdateInput,
      });
      throw new BadRequestException((err as Error).message ?? 'Document generation failed');
    }
  }
}

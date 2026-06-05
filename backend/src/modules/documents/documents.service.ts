import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsRepository } from './documents.repository';
import { DocumentDataService } from './document-data.service';
import { DocxtemplaterService } from './docxtemplater.service';
import { StorageService } from '../storage/storage.service';
import { GenerationService } from '../generation/generation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toTemplateFieldMapCompat } from './template-field-map.mapper';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  CreatePacketDto,
  UpdatePacketDto,
  CreatePacketTemplateDto,
  CreateTemplateFieldMapDto,
  UpdateTemplateFieldMapDto,
  CreateMergeTagDto,
  UpdateMergeTagDto,
  GenerateDocumentDto,
} from './dto/documents.dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly documentDataService: DocumentDataService,
    private readonly docxtemplaterService: DocxtemplaterService,
    private readonly storageService: StorageService,
    private readonly generationService: GenerationService,
  ) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  listTemplates(activeOnly?: boolean, ids?: string[]) {
    if (ids?.length) return this.repo.findTemplatesByIds(ids);
    return this.repo.findAllTemplates(activeOnly);
  }

  async getTemplate(id: string) {
    const template = await this.repo.findTemplateById(id);
    if (!template) throw new NotFoundException(`Template '${id}' not found`);
    return template;
  }

  createTemplate(dto: CreateTemplateDto) {
    return this.repo.createTemplate(dto);
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    await this.getTemplate(id);
    return this.repo.updateTemplate(id, dto);
  }

  async deleteTemplate(id: string) {
    await this.getTemplate(id);
    return this.repo.deleteTemplate(id);
  }

  countActiveTemplates() {
    return this.repo.countActiveTemplates();
  }

  // ─── Packets ─────────────────────────────────────────────────────────────────

  listPackets(activeOnly?: boolean) {
    return this.repo.findAllPackets(activeOnly);
  }

  async getPacket(id: string) {
    const packet = await this.repo.findPacketById(id);
    if (!packet) throw new NotFoundException(`Packet '${id}' not found`);
    return packet;
  }

  createPacket(dto: CreatePacketDto) {
    return this.repo.createPacket(dto);
  }

  async updatePacket(id: string, dto: UpdatePacketDto) {
    await this.getPacket(id);
    return this.repo.updatePacket(id, dto);
  }

  async deletePacket(id: string) {
    await this.getPacket(id);
    return this.repo.deletePacket(id);
  }

  // ─── Packet Templates ────────────────────────────────────────────────────────

  listPacketTemplates(packetId: string) {
    return this.repo.findPacketTemplates(packetId);
  }

  addPacketTemplate(packetId: string, dto: CreatePacketTemplateDto) {
    return this.repo.createPacketTemplate(packetId, dto);
  }

  removePacketTemplate(packetId: string, templateId: string) {
    return this.repo.deletePacketTemplate(packetId, templateId);
  }

  // ─── Template Field Maps ─────────────────────────────────────────────────────

  async listFieldMaps(templateId: string) {
    const rows = await this.repo.findFieldMaps(templateId);
    return rows.map(toTemplateFieldMapCompat);
  }

  async createFieldMap(templateId: string, dto: CreateTemplateFieldMapDto) {
    const row = await this.repo.createFieldMap(templateId, dto);
    const withDict = await this.repo.findFieldMapById(row.id);
    return withDict ? toTemplateFieldMapCompat(withDict) : toTemplateFieldMapCompat(row);
  }

  async updateFieldMap(id: string, dto: UpdateTemplateFieldMapDto) {
    await this.repo.updateFieldMap(id, dto);
    const row = await this.repo.findFieldMapById(id);
    if (!row) throw new NotFoundException(`Field map '${id}' not found`);
    return toTemplateFieldMapCompat(row);
  }

  deleteFieldMap(id: string) {
    return this.repo.deleteFieldMap(id);
  }

  deleteAllFieldMaps(templateId: string) {
    return this.repo.deleteFieldMapsByTemplateId(templateId);
  }

  // ─── Merge Tags ──────────────────────────────────────────────────────────────

  listMergeTags(tagNames?: string[], templateId?: string) {
    return this.repo.findMergeTags(tagNames, templateId);
  }

  listFieldMapsByTemplateIds(templateIds: string[]) {
    return this.repo.findFieldMapsByTemplateIds(templateIds);
  }

  listPacketTemplatesByPacketIds(packetIds: string[]) {
    return this.repo.findPacketTemplatesByPacketIds(packetIds);
  }

  deletePacketTemplateByRowId(id: string) {
    return this.repo.deletePacketTemplateByRowId(id);
  }

  deletePacketTemplatesByTemplate(templateId: string) {
    return this.repo.deletePacketTemplatesByTemplateId(templateId);
  }

  deleteGeneratedDocumentsByTemplate(templateId: string) {
    return this.repo.deleteGeneratedDocumentsByTemplateId(templateId);
  }

  deleteGenerationJobsByTemplate(templateId: string) {
    return this.repo.deleteGenerationJobsByTemplateId(templateId);
  }

  createMergeTag(dto: CreateMergeTagDto) {
    return this.repo.createMergeTag(dto);
  }

  async updateMergeTag(id: string, dto: UpdateMergeTagDto) {
    return this.repo.updateMergeTag(id, dto);
  }

  deleteMergeTag(id: string) {
    return this.repo.deleteMergeTag(id);
  }

  // ─── Documents & Generation ──────────────────────────────────────────────────
  //
  // Four independent document generation approaches:
  //
  //  generate        NestJS · docxtemplater engine · persists job + document records.
  //                  The primary NestJS generation path using DocxtemplaterService.
  //
  //  generate-api    NestJS · raw XML merge-tag engine (GenerationService).
  //                  Port of the Supabase edge function running entirely in NestJS.
  //                  Uses fflate ZIP manipulation + regex-based merge-tag replacement.
  //                  Persists job + document records.
  //
  //  generate-edge   Supabase · proxies to the generate-document edge function.
  //                  The original Deno implementation; use for comparison or fallback.
  //
  //  generate-v2     NestJS · docxtemplater engine · streams DOCX directly.
  //                  Same engine as "generate" but returns the file as a download
  //                  with no DB writes. Separate track experimenting with docxtemplater
  //                  as a drop-in replacement for the raw XML approach.

  async listGeneratedDocuments(dealId: string) {
    const docs = await this.repo.findGeneratedDocuments(dealId);
    const userIds = [...new Set(docs.map((d) => d.created_by).filter(Boolean))];
    if (!userIds.length) return docs;

    const users = await this.prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, full_name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return docs.map((doc) => {
      const creator = byId.get(doc.created_by);
      return {
        ...doc,
        creator_name: creator?.full_name || creator?.email || null,
        creator_email: creator?.email ?? null,
      };
    });
  }

  listGeneratedDocumentsByDealIds(dealIds: string[]) {
    return this.repo.findGeneratedDocumentsByDealIds(dealIds);
  }

  listGenerationJobs(dealId: string) {
    return this.repo.findGenerationJobs(dealId);
  }

  /**
   * Generate Document — NestJS · docxtemplater engine.
   * Renders the template via DocxtemplaterService, uploads to storage,
   * and persists generation_job + generated_document records.
   */
  async generateDocument(dealId: string, dto: GenerateDocumentDto, requestedBy?: string) {
    if (!requestedBy) {
      throw new BadRequestException('Authentication required');
    }

    const outputType = dto.outputType ?? 'docx_only';

    const job = await this.repo.createGenerationJob({
      deal_id: dealId,
      requested_by: requestedBy,
      request_type: 'single_doc',
      template_id: dto.templateId ?? null,
      packet_id: dto.packetId ?? null,
      output_type: outputType,
      status: 'running',
      started_at: new Date(),
    });

    try {
      const { buffer, filename, templateName } = await this.docxtemplaterService.generate(
        dealId,
        dto.templateId!,
      );

      const storagePath = `${dealId}/${filename}`;
      await this.storageService.upload('generated-docs', storagePath, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', true);

      const docxUrl = await this.storageService.getSignedUrl('generated-docs', storagePath, 3600);

      const doc = await this.repo.createGeneratedDocument({
        deal_id: dealId,
        template_id: dto.templateId ?? null,
        packet_id: dto.packetId ?? null,
        output_docx_path: storagePath,
        output_type: outputType,
        generation_status: 'success',
        template_name: templateName,
        created_by: requestedBy,
        generation_batch_id: job.id,
      });

      await this.repo.updateGenerationJob(job.id, {
        status: 'success',
        completed_at: new Date(),
      });

      await this.repo.createActivityLog({
        deal_id: dealId,
        actor_user_id: requestedBy,
        action_type: 'document_generated',
        action_details: { templateId: dto.templateId, templateName, documentId: doc.id },
      });

      return {
        successCount: 1,
        failCount: 0,
        results: [{ templateName, success: true }],
        docxUrl,
      };
    } catch (err) {
      await this.repo.updateGenerationJob(job.id, {
        status: 'failed',
        completed_at: new Date(),
        error_message: (err as Error).message,
      });
      throw new BadRequestException((err as Error).message ?? 'Document generation failed');
    }
  }

  /**
   * Generate Document (API) — NestJS · raw XML merge-tag engine.
   * Delegates to GenerationService which runs the ported Supabase edge function
   * pipeline (fflate ZIP + regex merge-tag replacement) entirely within NestJS.
   * Persists generation_job + generated_document records.
   */
  generateDocumentApi(dealId: string, dto: GenerateDocumentDto, requestedBy?: string) {
    if (!requestedBy) throw new BadRequestException('Authentication required');
    if (!dto.templateId) throw new BadRequestException('templateId is required');
    return this.generationService.generate(dealId, dto.templateId, requestedBy, dto.outputType);
  }

  /**
   * Generate Document (Edge) — Supabase edge function proxy.
   * Forwards the request verbatim to the generate-document Deno edge function.
   * Use for direct comparison against the NestJS ports or as a fallback.
   */
  async generateDocumentEdge(dealId: string, dto: GenerateDocumentDto, requestedBy?: string) {
    if (!requestedBy) throw new BadRequestException('Authentication required');

    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.getOrThrow<string>('supabase.serviceRoleKey');

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        'X-User-Id': requestedBy,
      },
      body: JSON.stringify({
        dealId,
        templateId: dto.templateId,
        packetId: dto.packetId,
        outputType: dto.outputType ?? 'docx_only',
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      throw new BadRequestException(
        (payload['error'] as string) ?? `Edge generation failed (${res.status})`,
      );
    }

    return payload;
  }

  // ─── v2: docxtemplater engine (experimental track) ───────────────────────────
  //
  // Separate track attempting to achieve the same output as generate-api using
  // docxtemplater as the template engine instead of raw XML manipulation.
  // Templates must use clean {{field_key}} syntax — no Word MERGEFIELD markup.

  /**
   * Returns the fully-resolved JSON data object that would be passed to docxtemplater.
   * Useful for inspecting field values, conditions, and transforms before generating.
   */
  async getFieldDataV2(dealId: string, templateId: string) {
    const fieldData = await this.documentDataService.buildTemplateData(dealId, templateId);
    return this.docxtemplaterService.enrichFieldDataFromFilePath(fieldData);
  }

  /**
   * Generate Document (v2) — NestJS · docxtemplater engine · download stream.
   * Same engine as "generate" but returns the DOCX file directly with no DB writes.
   */
  generateDocumentV2(dealId: string, templateId: string) {
    return this.docxtemplaterService.generate(dealId, templateId);
  }

  // ─── Template validation (Phase 4 migration) ────────────────────────────────

  async validateTemplate(templateId: string) {
    const template = await this.repo.findTemplateById(templateId);
    if (!template) throw new NotFoundException(`Template '${templateId}' not found`);
    if (!template.file_path) throw new BadRequestException('No DOCX file uploaded for this template');

    const inspect = await this.docxtemplaterService.inspectFromFilePath(
      template.file_path,
      template.name,
    );

    const allDict = await this.repo.findAllFieldDictionary();
    const dictKeys = new Set(allDict.map((d) => d.field_key));

    type FoundTag = {
      tag: string;
      tagName: string;
      tagType: 'merge_tag' | 'label' | 'f_code' | 'curly_brace';
      fieldKey: string | null;
      mapped: boolean;
      suggestions?: string[];
    };

    const mappedTags: FoundTag[] = [];
    const unmappedTags: FoundTag[] = [];
    for (const key of inspect.mergeFieldKeys) {
      if (dictKeys.has(key)) {
        mappedTags.push({ tag: `{{${key}}}`, tagName: key, tagType: 'curly_brace', fieldKey: key, mapped: true });
      } else {
        unmappedTags.push({ tag: `{{${key}}}`, tagName: key, tagType: 'curly_brace', fieldKey: null, mapped: false, suggestions: [] });
      }
    }

    // Label-type aliases: search document plain text for known label strings
    const [aliases, docText] = await Promise.all([
      this.prisma.merge_tag_aliases.findMany({
        where: { is_active: true },
        select: { tag_name: true, field_key: true, tag_type: true },
      }),
      this.docxtemplaterService.getDocumentText(template.file_path),
    ]);

    let labelCount = 0;
    for (const alias of aliases) {
      if (alias.tag_type !== 'label') continue;
      const escaped = alias.tag_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(escaped, 'i').test(docText)) {
        mappedTags.push({ tag: alias.tag_name, tagName: alias.tag_name, tagType: 'label', fieldKey: alias.field_key, mapped: true });
        labelCount++;
      }
    }

    const warnings: string[] = [];
    if (unmappedTags.length > 0) {
      warnings.push(`${unmappedTags.length} tag(s) not found in field dictionary: ${unmappedTags.slice(0, 5).map((t) => t.tagName).join(', ')}${unmappedTags.length > 5 ? '…' : ''}`);
    }

    const totalFound = inspect.mergeFieldKeys.length + labelCount;
    return {
      valid: unmappedTags.length === 0,
      totalTagsFound: totalFound,
      mappedTags,
      unmappedTags,
      warnings,
      errors: [],
      conditions: inspect.conditions,
      summary: {
        mergeTagCount: 0,
        labelCount,
        fCodeCount: 0,
        curlyBraceCount: inspect.mergeFieldKeys.length,
        mappedCount: mappedTags.length,
        unmappedCount: unmappedTags.length,
      },
    };
  }

  /**
   * Builds the same merge field map as generate-document (previewOnly) without
   * creating a job or merging DOCX.
   */
  async previewDocumentPayload(dealId: string, templateId: string, requestedBy?: string) {
    if (!requestedBy) {
      throw new BadRequestException('Authentication required');
    }

    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.getOrThrow<string>('supabase.serviceRoleKey');

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        'X-User-Id': requestedBy,
      },
      body: JSON.stringify({
        dealId,
        templateId,
        previewOnly: true,
        outputType: 'docx_only',
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      dealId?: string;
      dealNumber?: string;
      templateId?: string;
      templateName?: string;
      fieldCount?: number;
      totalKeysInMap?: number;
      data?: Record<string, string>;
    };

    if (!res.ok) {
      throw new BadRequestException(
        payload.error ?? `Document payload preview failed (${res.status})`,
      );
    }

    return payload;
  }
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertServiceRoleJwt,
  isUsableSupabaseJwtSecret,
  mintSupabaseAccessToken,
} from '../../common/helpers/supabase-jwt';
import { DocumentsRepository } from './documents.repository';
import { DocumentDataService } from './document-data.service';
import { DocxtemplaterService } from './docxtemplater.service';
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
    private readonly config: ConfigService,
    private readonly documentDataService: DocumentDataService,
    private readonly docxtemplaterService: DocxtemplaterService,
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

  listFieldMaps(templateId: string) {
    return this.repo.findFieldMaps(templateId);
  }

  createFieldMap(templateId: string, dto: CreateTemplateFieldMapDto) {
    return this.repo.createFieldMap(templateId, dto);
  }

  async updateFieldMap(id: string, dto: UpdateTemplateFieldMapDto) {
    return this.repo.updateFieldMap(id, dto);
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

  listGeneratedDocuments(dealId: string) {
    return this.repo.findGeneratedDocuments(dealId);
  }

  listGeneratedDocumentsByDealIds(dealIds: string[]) {
    return this.repo.findGeneratedDocumentsByDealIds(dealIds);
  }

  listGenerationJobs(dealId: string) {
    return this.repo.findGenerationJobs(dealId);
  }

  /**
   * Proxies to Supabase edge `generate-document` (DOCX merge logic stays in Deno).
   * Nest JWT auth → service-role call with X-User-Id for created_by / activity.
   */
  async generateDocument(dealId: string, dto: GenerateDocumentDto, requestedBy?: string) {
    if (!requestedBy) {
      throw new BadRequestException('Authentication required');
    }

    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const publishableKey = this.config.getOrThrow<string>('supabase.publishableKey');
    const serviceRoleKey = this.config.getOrThrow<string>('supabase.serviceRoleKey');
    const supabaseJwtSecret = this.config.get<string>('supabase.jwtSecret');
    const nestJwtSecret = this.config.get<string>('jwt.secret');
    const useMintedUserJwt = isUsableSupabaseJwtSecret(supabaseJwtSecret, nestJwtSecret);

    const edgeBody = {
      dealId,
      templateId: dto.templateId,
      packetId: dto.packetId,
      outputType: dto.outputType ?? 'docx_only',
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: publishableKey,
    };

    if (useMintedUserJwt) {
      headers.Authorization = `Bearer ${mintSupabaseAccessToken(
        requestedBy,
        supabaseJwtSecret!,
        supabaseUrl,
      )}`;
    } else {
      if (supabaseJwtSecret && supabaseJwtSecret === nestJwtSecret) {
        this.logger.warn(
          'SUPABASE_JWT_SECRET matches JWT_SECRET — ignored. Use the Supabase Dashboard JWT secret, or deploy generate-document for service-role proxy.',
        );
      }
      try {
        assertServiceRoleJwt(serviceRoleKey);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
      headers.Authorization = `Bearer ${serviceRoleKey}`;
      headers['X-User-Id'] = requestedBy;
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify(edgeBody),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };

    if (!res.ok) {
      throw new BadRequestException(
        payload.error ?? payload.message ?? `Document generation failed (${res.status})`,
      );
    }

    return payload;
  }

  // ─── v2: docxtemplater engine ─────────────────────────────────────────────────

  /**
   * Returns the fully-resolved JSON data object that would be passed to docxtemplater.
   * Useful for inspecting field values, conditions, and transforms before generating.
   */
  async getFieldDataV2(dealId: string, templateId: string) {
    const fieldData = await this.documentDataService.buildTemplateData(dealId, templateId);
    return this.docxtemplaterService.enrichFieldDataFromFilePath(fieldData);
  }

  /**
   * Generates a DOCX using docxtemplater + PizZip entirely within NestJS.
   * Does NOT save to the database — returns a Buffer for direct download.
   */
  generateDocumentV2(dealId: string, templateId: string) {
    return this.docxtemplaterService.generate(dealId, templateId);
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

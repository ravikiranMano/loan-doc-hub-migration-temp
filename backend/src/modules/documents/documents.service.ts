import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentsRepository } from './documents.repository';
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
  constructor(private readonly repo: DocumentsRepository) {}

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

  generateDocument(dealId: string, dto: GenerateDocumentDto, requestedBy?: string) {
    // TODO: Implement actual document generation logic (was a Supabase Edge Function).
    // For now, create the generation job record and return it. The worker will pick it up.
    const data: Record<string, unknown> = {
      deal_id: dealId,
      requested_by: requestedBy,
      request_type: dto.request_type,
      packet_id: dto.packet_id,
      template_id: dto.template_id,
      output_type: dto.output_type || 'pdf',
      status: 'pending',
    };
    return this.repo.createGenerationJob(data);
  }
}

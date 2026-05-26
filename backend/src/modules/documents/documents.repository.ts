import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
} from './dto/documents.dto';

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  findAllTemplates(activeOnly?: boolean) {
    return this.prisma.templates.findMany({
      where: activeOnly ? { is_active: true } : undefined,
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
  }

  findTemplateById(id: string) {
    return this.prisma.templates.findUnique({ where: { id } });
  }

  findTemplatesByIds(ids: string[]) {
    return this.prisma.templates.findMany({ where: { id: { in: ids } } });
  }

  createTemplate(dto: CreateTemplateDto) {
    return this.prisma.templates.create({ data: dto as any });
  }

  updateTemplate(id: string, dto: UpdateTemplateDto) {
    return this.prisma.templates.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as any,
    });
  }

  deleteTemplate(id: string) {
    return this.prisma.templates.delete({ where: { id } });
  }

  countActiveTemplates() {
    return this.prisma.templates.count({ where: { is_active: true } });
  }

  // ─── Packets ─────────────────────────────────────────────────────────────────

  findAllPackets(activeOnly?: boolean) {
    return this.prisma.packets.findMany({
      where: activeOnly ? { is_active: true } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  findPacketById(id: string) {
    return this.prisma.packets.findUnique({ where: { id } });
  }

  createPacket(dto: CreatePacketDto) {
    return this.prisma.packets.create({ data: dto as any });
  }

  updatePacket(id: string, dto: UpdatePacketDto) {
    return this.prisma.packets.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as any,
    });
  }

  deletePacket(id: string) {
    return this.prisma.packets.delete({ where: { id } });
  }

  // ─── Packet Templates ────────────────────────────────────────────────────────

  findPacketTemplates(packetId: string) {
    return this.prisma.packet_templates.findMany({
      where: { packet_id: packetId },
      include: { templates: true },
      orderBy: { display_order: 'asc' },
    });
  }

  createPacketTemplate(packetId: string, dto: CreatePacketTemplateDto) {
    return this.prisma.packet_templates.create({
      data: {
        packet_id: packetId,
        template_id: dto.template_id,
        display_order: dto.display_order,
        is_required: dto.is_required,
      },
    });
  }

  deletePacketTemplate(packetId: string, templateId: string) {
    return this.prisma.packet_templates.deleteMany({
      where: { packet_id: packetId, template_id: templateId },
    });
  }

  deletePacketTemplateByRowId(id: string) {
    return this.prisma.packet_templates.delete({ where: { id } });
  }

  deletePacketTemplatesByTemplateId(templateId: string) {
    return this.prisma.packet_templates.deleteMany({ where: { template_id: templateId } });
  }

  findPacketTemplatesByPacketIds(packetIds: string[]) {
    return this.prisma.packet_templates.findMany({
      where: { packet_id: { in: packetIds } },
    });
  }

  // ─── Template Field Maps ─────────────────────────────────────────────────────

  findFieldMaps(templateId: string) {
    return this.prisma.template_field_maps.findMany({
      where: { template_id: templateId },
      include: { field_dictionary: true },
      orderBy: { display_order: 'asc' },
    });
  }

  findFieldMapsByTemplateIds(ids: string[]) {
    return this.prisma.template_field_maps.findMany({
      where: { template_id: { in: ids } },
    });
  }

  findFieldMapById(id: string) {
    return this.prisma.template_field_maps.findUnique({
      where: { id },
      include: { field_dictionary: true },
    });
  }

  createFieldMap(templateId: string, dto: CreateTemplateFieldMapDto) {
    return this.prisma.template_field_maps.create({
      data: {
        template_id: templateId,
        field_dictionary_id: dto.field_dictionary_id,
        required_flag: dto.required_flag,
        transform_rule: dto.transform_rule,
        display_order: dto.display_order,
      } as any,
      include: { field_dictionary: true },
    });
  }

  updateFieldMap(id: string, dto: UpdateTemplateFieldMapDto) {
    const { template_id, field_dictionary_id, required_flag, transform_rule, display_order } =
      dto;
    return this.prisma.template_field_maps.update({
      where: { id },
      data: {
        ...(template_id !== undefined && { template_id }),
        ...(field_dictionary_id !== undefined && { field_dictionary_id }),
        ...(required_flag !== undefined && { required_flag }),
        ...(transform_rule !== undefined && { transform_rule }),
        ...(display_order !== undefined && { display_order }),
      },
      include: { field_dictionary: true },
    });
  }

  deleteFieldMap(id: string) {
    return this.prisma.template_field_maps.delete({ where: { id } });
  }

  deleteFieldMapsByTemplateId(templateId: string) {
    return this.prisma.template_field_maps.deleteMany({ where: { template_id: templateId } });
  }

  // ─── Merge Tags ──────────────────────────────────────────────────────────────

  findMergeTags(tagNames?: string[], templateId?: string) {
    const where: Record<string, unknown> = {};
    if (tagNames?.length) where['tag_name'] = { in: tagNames };
    if (templateId) where['template_id'] = templateId;
    return this.prisma.merge_tag_aliases.findMany({
      where: Object.keys(where).length ? where : undefined,
    });
  }

  createMergeTag(dto: CreateMergeTagDto) {
    return this.prisma.merge_tag_aliases.create({ data: dto as any });
  }

  updateMergeTag(id: string, dto: UpdateMergeTagDto) {
    return this.prisma.merge_tag_aliases.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as any,
    });
  }

  deleteMergeTag(id: string) {
    return this.prisma.merge_tag_aliases.delete({ where: { id } });
  }

  // ─── Generated Documents & Jobs ─────────────────────────────────────────────

  findGeneratedDocuments(dealId: string) {
    return this.prisma.generated_documents.findMany({
      where: { deal_id: dealId },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Mirrors Supabase listGeneratedDocumentsByDealIds (.in deal_id, generation_status success). */
  findGeneratedDocumentsByDealIds(dealIds: string[]) {
    if (!dealIds.length) return [];
    return this.prisma.generated_documents.findMany({
      where: {
        deal_id: { in: dealIds },
        generation_status: 'success',
      },
      orderBy: { created_at: 'desc' },
    });
  }

  findGenerationJobs(dealId: string) {
    return this.prisma.generation_jobs.findMany({
      where: { deal_id: dealId },
      orderBy: { created_at: 'desc' },
    });
  }

  createGenerationJob(data: Record<string, unknown>) {
    return this.prisma.generation_jobs.create({ data: data as any });
  }

  updateGenerationJob(id: string, data: Record<string, unknown>) {
    return this.prisma.generation_jobs.update({ where: { id }, data: data as any });
  }

  createGeneratedDocument(data: Record<string, unknown>) {
    return this.prisma.generated_documents.create({ data: data as any });
  }

  createActivityLog(data: Record<string, unknown>) {
    return this.prisma.activity_log.create({ data: data as any });
  }

  deleteGeneratedDocumentsByTemplateId(templateId: string) {
    return this.prisma.generated_documents.deleteMany({
      where: { template_id: templateId },
    });
  }

  deleteGenerationJobsByTemplateId(templateId: string) {
    return this.prisma.generation_jobs.deleteMany({
      where: { template_id: templateId },
    });
  }

  // ─── Field Dictionary ────────────────────────────────────────────────────────

  findAllFieldDictionary() {
    return this.prisma.field_dictionary.findMany({
      select: { field_key: true, label: true, data_type: true, section: true, canonical_key: true },
    });
  }
}

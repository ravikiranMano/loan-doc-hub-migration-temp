import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { DocumentsService } from './documents.service';
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
  GenerateDocumentV2Dto,
} from './dto/documents.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  @Get('templates')
  listTemplates(@Query('active') active?: string, @Query('ids') ids?: string) {
    const parsed = ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    return this.service.listTemplates(active === 'true', parsed);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.service.createTemplate(dto);
  }

  @Get('templates/count')
  countActiveTemplates() {
    return this.service.countActiveTemplates();
  }

  @Get('templates/field-maps/batch')
  listFieldMapsBatch(@Query('templateIds') templateIds: string) {
    const ids = templateIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.listFieldMapsByTemplateIds(ids);
  }

  // ─── Template Field Maps (register before templates/:id) ─────────────────────

  @Get('templates/:id/field-maps')
  listFieldMaps(@Param('id') id: string) {
    return this.service.listFieldMaps(id);
  }

  @Post('templates/:id/field-maps')
  createFieldMap(@Param('id') id: string, @Body() dto: CreateTemplateFieldMapDto) {
    return this.service.createFieldMap(id, dto);
  }

  @Patch('templates/:id/field-maps/:mapId')
  updateFieldMap(@Param('mapId') mapId: string, @Body() dto: UpdateTemplateFieldMapDto) {
    return this.service.updateFieldMap(mapId, dto);
  }

  @Delete('templates/:id/field-maps/:mapId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFieldMap(@Param('mapId') mapId: string) {
    return this.service.deleteFieldMap(mapId);
  }

  @Delete('templates/:id/field-maps')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAllFieldMaps(@Param('id') id: string) {
    return this.service.deleteAllFieldMaps(id);
  }

  @Get('packets/templates/batch')
  listPacketTemplatesBatch(@Query('packetIds') packetIds: string) {
    const ids = packetIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.listPacketTemplatesByPacketIds(ids);
  }

  @Delete('packet-templates/:rowId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePacketTemplateRow(@Param('rowId') rowId: string) {
    return this.service.deletePacketTemplateByRowId(rowId);
  }

  @Get('templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.service.getTemplate(id);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.service.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param('id') id: string) {
    return this.service.deleteTemplate(id);
  }

  @Delete('templates/:id/packet-templates')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePacketTemplatesForTemplate(@Param('id') id: string) {
    return this.service.deletePacketTemplatesByTemplate(id);
  }

  @Delete('templates/:id/generated-documents')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGeneratedForTemplate(@Param('id') id: string) {
    return this.service.deleteGeneratedDocumentsByTemplate(id);
  }

  @Delete('templates/:id/generation-jobs')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGenerationJobsForTemplate(@Param('id') id: string) {
    return this.service.deleteGenerationJobsByTemplate(id);
  }

  // ─── Packets ─────────────────────────────────────────────────────────────────

  @Get('packets')
  listPackets(@Query('active') active?: string) {
    return this.service.listPackets(active === 'true');
  }

  @Post('packets')
  createPacket(@Body() dto: CreatePacketDto) {
    return this.service.createPacket(dto);
  }

  @Get('packets/:id')
  getPacket(@Param('id') id: string) {
    return this.service.getPacket(id);
  }

  @Patch('packets/:id')
  updatePacket(@Param('id') id: string, @Body() dto: UpdatePacketDto) {
    return this.service.updatePacket(id, dto);
  }

  @Delete('packets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePacket(@Param('id') id: string) {
    return this.service.deletePacket(id);
  }

  // ─── Packet Templates ────────────────────────────────────────────────────────

  @Get('packets/:id/templates')
  listPacketTemplates(@Param('id') id: string) {
    return this.service.listPacketTemplates(id);
  }

  @Post('packets/:id/templates')
  addPacketTemplate(@Param('id') id: string, @Body() dto: CreatePacketTemplateDto) {
    return this.service.addPacketTemplate(id, dto);
  }

  @Delete('packets/:id/templates/:templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePacketTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
  ) {
    return this.service.removePacketTemplate(id, templateId);
  }

  // ─── Merge Tags ──────────────────────────────────────────────────────────────

  @Get('merge-tags')
  listMergeTags(
    @Query('names') names?: string,
    @Query('templateId') templateId?: string,
  ) {
    const tagNames = names ? names.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    return this.service.listMergeTags(tagNames, templateId);
  }

  @Post('merge-tags')
  createMergeTag(@Body() dto: CreateMergeTagDto) {
    return this.service.createMergeTag(dto);
  }

  @Patch('merge-tags/:id')
  updateMergeTag(@Param('id') id: string, @Body() dto: UpdateMergeTagDto) {
    return this.service.updateMergeTag(id, dto);
  }

  @Delete('merge-tags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMergeTag(@Param('id') id: string) {
    return this.service.deleteMergeTag(id);
  }

  // ─── Generated Documents ─────────────────────────────────────────────────────

  // GET /api/documents/generated?dealIds=id1,id2
  @Get('documents/generated')
  listGeneratedByDealIds(@Query('dealIds') dealIds: string) {
    const ids = dealIds
      ? dealIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.service.listGeneratedDocumentsByDealIds(ids);
  }

  @Get('deals/:dealId/documents')
  listGeneratedDocuments(@Param('dealId') dealId: string) {
    return this.service.listGeneratedDocuments(dealId);
  }

  @Post('deals/:dealId/documents/generate')
  generateDocument(
    @Param('dealId') dealId: string,
    @Body() dto: GenerateDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.generateDocument(dealId, dto, user?.sub);
  }

  @Get('deals/:dealId/documents/preview-payload')
  previewDocumentPayload(
    @Param('dealId') dealId: string,
    @Query('templateId') templateId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!templateId?.trim()) {
      throw new BadRequestException('templateId query parameter is required');
    }
    return this.service.previewDocumentPayload(dealId, templateId.trim(), user?.sub);
  }

  @Get('deals/:dealId/documents/jobs')
  listGenerationJobs(@Param('dealId') dealId: string) {
    return this.service.listGenerationJobs(dealId);
  }

  // ─── v2: docxtemplater engine (test / parallel path) ─────────────────────────

  @Get('deals/:dealId/documents/field-data-v2')
  getFieldDataV2(
    @Param('dealId') dealId: string,
    @Query('templateId') templateId: string,
  ) {
    if (!templateId?.trim()) throw new BadRequestException('templateId query parameter is required');
    return this.service.getFieldDataV2(dealId, templateId.trim());
  }

  @Post('deals/:dealId/documents/generate-v2')
  @HttpCode(HttpStatus.OK)
  async generateDocumentV2(
    @Param('dealId') dealId: string,
    @Body() dto: GenerateDocumentV2Dto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!user?.sub) throw new BadRequestException('Authentication required');
    const { buffer, filename } = await this.service.generateDocumentV2(dealId, dto.templateId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(Readable.from(buffer));
  }
}

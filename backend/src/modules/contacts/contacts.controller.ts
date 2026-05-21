import {
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
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto, CreateAttachmentDto, UpdateAttachmentDto } from './dto/contact.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  // GET /api/contacts?type=&types=&search=&ids=&limit=
  @Get('generate-id')
  async generateContactId(@Query('type') type: string) {
    const contactId = await this.service.generateContactId(type);
    return { contactId };
  }

  @Get()
  list(
    @Query('type') type?: string,
    @Query('types') types?: string,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (ids) {
      const idList = ids.split(',').map((s) => s.trim()).filter(Boolean);
      return this.service.getContactsByIds(idList);
    }
    return this.service.listContacts({
      type,
      types: types ? types.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  // GET /api/contacts/search?type=&types=&q=&limit=
  @Get('search')
  search(
    @Query('type') type?: string,
    @Query('types') types?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listContacts({
      type,
      types: types ? types.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      search: q,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  // GET /api/contacts/conversation-log-types
  @Get('conversation-log-types')
  getConversationLogTypes() {
    return this.service.getConversationLogTypes();
  }

  @Post()
  create(@Body() dto: CreateContactDto, @CurrentUser() user: JwtPayload) {
    return this.service.createContact(dto, user?.sub);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getContact(id);
  }

  @Patch(':id/merge')
  mergeContact(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const contactData = (body.contact_data ?? body) as Record<string, unknown>;
    return this.service.updateContactWithMerge(id, contactData);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    if (dto.contact_data && Object.keys(dto).length === 1) {
      return this.service.patchContactData(id, dto.contact_data as Record<string, unknown>);
    }
    return this.service.updateContact(id, dto);
  }

  @Delete('bulk')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBulk(@Query('ids') ids: string) {
    const parsed = ids.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.deleteContacts(parsed);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.deleteContact(id);
  }

  // ─── Attachments ─────────────────────────────────────────────────────────────

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Query('active') active?: string) {
    return this.service.listAttachments(id, active === 'true');
  }

  @Post(':id/attachments')
  createAttachment(
    @Param('id') id: string,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createAttachment(id, user?.sub, dto);
  }

  @Patch(':id/attachments/:aid')
  updateAttachment(@Param('aid') aid: string, @Body() dto: UpdateAttachmentDto) {
    return this.service.updateAttachment(aid, dto);
  }

  @Delete(':id/attachments/:aid')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAttachment(@Param('aid') aid: string) {
    return this.service.deleteAttachment(aid);
  }
}

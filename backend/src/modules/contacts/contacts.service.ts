import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateContactId as generateContactIdRpc } from '../../common/helpers/db-sequences';
import { ContactsRepository } from './contacts.repository';
import { CreateContactDto, UpdateContactDto, CreateAttachmentDto, UpdateAttachmentDto } from './dto/contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly repo: ContactsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Contacts ────────────────────────────────────────────────────────────────

  listContacts(options?: {
    type?: string;
    types?: string[];
    search?: string;
    limit?: number;
    page?: number;
    pageSize?: number;
  }) {
    if (options?.page != null && options?.pageSize != null && options?.type) {
      return this.repo.findAllPaginated({
        type: options.type,
        page: options.page,
        pageSize: options.pageSize,
        search: options.search,
      });
    }
    return this.repo.findAll(options);
  }

  generateContactId(contactType: string) {
    return generateContactIdRpc(this.prisma, contactType);
  }

  async getContact(id: string) {
    const contact = await this.repo.findById(id);
    if (!contact) throw new NotFoundException(`Contact '${id}' not found`);
    return contact;
  }

  getContactByContactId(contactId: string) {
    return this.repo.findByContactId(contactId);
  }

  getContactsByIds(ids: string[]) {
    return this.repo.findByIds(ids);
  }

  async createContact(dto: CreateContactDto, userId?: string) {
    const fullName =
      dto.full_name ||
      `${dto.first_name || ''} ${dto.last_name || ''}`.trim();

    const contactId =
      dto.contact_id || (await generateContactIdRpc(this.prisma, dto.contact_type));

    const data: Record<string, unknown> = {
      contact_type: dto.contact_type,
      contact_id: contactId,
      created_by: dto.created_by || userId,
      full_name: fullName,
      first_name: dto.first_name || '',
      last_name: dto.last_name || '',
      email: dto.email || '',
      phone: dto.phone || '',
      city: dto.city || '',
      state: dto.state || '',
      company: dto.company || '',
      contact_data: dto.contact_data || {},
    };

    return this.repo.create(data);
  }

  async updateContact(id: string, dto: UpdateContactDto) {
    await this.getContact(id);
    return this.repo.update(id, dto as Record<string, unknown>);
  }

  async updateContactWithMerge(id: string, contactData: Record<string, unknown>) {
    await this.getContact(id);
    return this.repo.updateWithMerge(id, contactData);
  }

  async patchContactData(id: string, patch: Record<string, unknown>) {
    await this.getContact(id);
    return this.repo.patchContactData(id, patch);
  }

  async deleteContact(id: string) {
    await this.getContact(id);
    return this.repo.delete(id);
  }

  async deleteContacts(ids: string[]) {
    return this.repo.deleteMany(ids);
  }

  // ─── Attachments ─────────────────────────────────────────────────────────────

  listAttachments(contactId: string, activeOnly?: boolean) {
    return this.repo.findAttachments(contactId, activeOnly);
  }

  createAttachment(contactId: string, uploadedBy: string, dto: CreateAttachmentDto) {
    return this.repo.createAttachment(contactId, uploadedBy, dto);
  }

  updateAttachment(id: string, dto: UpdateAttachmentDto) {
    return this.repo.updateAttachment(id, dto);
  }

  deleteAttachment(id: string) {
    return this.repo.deleteAttachments([id]);
  }

  // ─── Conversation Log Types ──────────────────────────────────────────────────

  getConversationLogTypes() {
    return this.repo.findConversationLogTypes();
  }
}

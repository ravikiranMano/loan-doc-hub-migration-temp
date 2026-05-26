import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAttachmentDto, UpdateAttachmentDto } from './dto/contact.dto';

@Injectable()
export class ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Contacts ────────────────────────────────────────────────────────────────

  private buildContactsWhere(options?: {
    type?: string;
    types?: string[];
    search?: string;
  }): Prisma.contactsWhereInput {
    const where: Prisma.contactsWhereInput = {};

    if (options?.type) {
      where.contact_type = options.type;
    } else if (options?.types?.length) {
      where.contact_type = { in: options.types };
    }

    if (options?.search?.trim()) {
      const s = options.search.trim();
      where.OR = [
        { full_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { contact_id: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
        { state: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { company: { contains: s, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  findAll(options?: { type?: string; types?: string[]; search?: string; limit?: number }) {
    const where = this.buildContactsWhere(options);
    return this.prisma.contacts.findMany({
      where,
      take: options?.limit ?? undefined,
      orderBy: { created_at: 'desc' },
    });
  }

  async findAllPaginated(options: {
    type?: string;
    page: number;
    pageSize: number;
    search?: string;
  }) {
    const where = this.buildContactsWhere({ type: options.type, search: options.search });
    const skip = (options.page - 1) * options.pageSize;
    const [contacts, totalCount] = await Promise.all([
      this.prisma.contacts.findMany({
        where,
        skip,
        take: options.pageSize,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.contacts.count({ where }),
    ]);
    return { contacts, totalCount };
  }

  findById(id: string) {
    return this.prisma.contacts.findUnique({ where: { id } });
  }

  findByContactId(contactId: string) {
    return this.prisma.contacts.findUnique({ where: { contact_id: contactId } });
  }

  findByEmail(email: string) {
    return this.prisma.contacts.findFirst({ where: { email } });
  }

  findByIds(ids: string[]) {
    return this.prisma.contacts.findMany({ where: { id: { in: ids } } });
  }

  create(data: Record<string, unknown>) {
    return this.prisma.contacts.create({ data: data as any });
  }

  update(id: string, data: Record<string, unknown>) {
    return this.prisma.contacts.update({
      where: { id },
      data: { ...data, updated_at: new Date() } as any,
    });
  }

  async updateWithMerge(id: string, contactData: Record<string, unknown>) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contacts.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Contact '${id}' not found`);

      const cd = contactData as Record<string, string>;
      const fullName =
        cd.full_name || `${cd.first_name || ''} ${cd.last_name || ''}`.trim();

      const existingFv = (existing.contact_data as Record<string, unknown>) || {};
      const mergedData: Record<string, unknown> = { ...cd };
      Object.entries(existingFv).forEach(([key, value]) => {
        if (key.startsWith('_')) mergedData[key] = value;
      });

      const phoneValue =
        cd.phone ||
        cd['phone.cell'] ||
        cd['phone.mobile'] ||
        cd['phone.home'] ||
        cd['phone.work'] ||
        '';

      const updated = await tx.contacts.update({
        where: { id },
        data: {
          full_name: fullName,
          first_name: cd.first_name || '',
          last_name: cd.last_name || '',
          email: cd.email || '',
          phone: phoneValue,
          city: cd.city || cd['address.city'] || cd['primary_address.city'] || '',
          state: cd.state || cd['address.state'] || cd['primary_address.state'] || '',
          company: cd.company || '',
          contact_data: mergedData as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });

      const linkedParticipants = await tx.deal_participants.findMany({
        where: { contact_id: id },
        select: { id: true, deal_id: true },
      });

      if (linkedParticipants.length > 0) {
        await tx.deal_participants.updateMany({
          where: { id: { in: linkedParticipants.map((p) => p.id) } },
          data: {
            name: fullName,
            email: cd.email || '',
            phone: phoneValue,
            updated_at: new Date(),
          },
        });

        const newCapacity = (cd.capacity || '').toString().trim();
        if (newCapacity) {
          const dealIds = Array.from(
            new Set(linkedParticipants.map((p) => p.deal_id).filter(Boolean)),
          );
          const capacityKey = `participant_${id}_capacity`;
          for (const dealId of dealIds) {
            const existingSection = await tx.deal_section_values.findFirst({
              where: { deal_id: dealId, section: 'participants' },
            });
            const fv =
              (existingSection?.field_values as Record<string, unknown>) || {};
            const updatedFv = { ...fv, [capacityKey]: newCapacity };
            if (existingSection) {
              await tx.deal_section_values.update({
                where: { id: existingSection.id },
                data: {
                  field_values: updatedFv as Prisma.InputJsonValue,
                  updated_at: new Date(),
                },
              });
            } else {
              await tx.deal_section_values.create({
                data: {
                  deal_id: dealId,
                  section: 'participants',
                  field_values: updatedFv as Prisma.InputJsonValue,
                  version: 1,
                },
              });
            }
          }
        }
      }

      return updated;
    });
  }

  async patchContactData(id: string, patch: Record<string, unknown>) {
    const existing = await this.prisma.contacts.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Contact '${id}' not found`);
    const merged = {
      ...((existing.contact_data as Record<string, unknown>) || {}),
      ...patch,
    };
    return this.prisma.contacts.update({
      where: { id },
      data: { contact_data: merged as Prisma.InputJsonValue, updated_at: new Date() },
    });
  }

  delete(id: string) {
    return this.prisma.contacts.delete({ where: { id } });
  }

  async deleteMany(ids: string[]) {
    await this.prisma.deal_participants.deleteMany({
      where: { contact_id: { in: ids } },
    });
    await this.prisma.borrower_attachments.deleteMany({
      where: { contact_id: { in: ids } },
    });
    return this.prisma.contacts.deleteMany({ where: { id: { in: ids } } });
  }

  // ─── Attachments ─────────────────────────────────────────────────────────────

  findAttachments(contactId: string, activeOnly?: boolean) {
    return this.prisma.borrower_attachments.findMany({
      where: {
        contact_id: contactId,
        ...(activeOnly ? { status: 'active' } : {}),
      },
      orderBy: { uploaded_at: 'desc' },
    });
  }

  createAttachment(contactId: string, uploadedBy: string, dto: CreateAttachmentDto) {
    return this.prisma.borrower_attachments.create({
      data: {
        contact_id: contactId,
        uploaded_by: uploadedBy,
        file_name: dto.file_name,
        file_path: dto.file_path,
        file_type: dto.file_type,
        file_size: dto.file_size != null ? String(dto.file_size) : undefined,
        category: dto.category,
        description: dto.description,
      },
    });
  }

  updateAttachment(id: string, dto: UpdateAttachmentDto) {
    return this.prisma.borrower_attachments.update({
      where: { id },
      data: dto as any,
    });
  }

  deleteAttachments(ids: string[]) {
    return this.prisma.borrower_attachments.deleteMany({ where: { id: { in: ids } } });
  }

  // ─── Conversation Log Types ──────────────────────────────────────────────────

  findConversationLogTypes() {
    return this.prisma.conversation_log_types.findMany({
      where: { is_active: true },
      orderBy: { display_order: 'asc' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, $Enums } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto, CreateParticipantDto, UpdateParticipantDto, CreateLoanHistoryDto, UpdateLoanHistoryDto, CreateAssignmentDto } from './dto/deals.dto';

@Injectable()
export class DealsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Deals ───────────────────────────────────────────────────────────────────

  private buildDealsWhere(options?: {
    status?: string;
    search?: string;
    state?: string;
    product_type?: string;
    ids?: string[];
  }): Prisma.dealsWhereInput {
    const where: Prisma.dealsWhereInput = {};

    if (options?.ids?.length) {
      where.id = { in: options.ids };
    }
    if (options?.status) {
      const statuses = options.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as $Enums.deal_status[];
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (options?.state) {
      where.state = options.state;
    }
    if (options?.product_type) {
      where.product_type = options.product_type;
    }
    if (options?.search?.trim()) {
      const s = options.search.trim();
      where.OR = [
        { deal_number: { contains: s, mode: 'insensitive' } },
        { borrower_name: { contains: s, mode: 'insensitive' } },
        { property_address: { contains: s, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /** List deals — filters by comma-separated status values when provided. */
  findAll(options?: {
    status?: string;
    search?: string;
    state?: string;
    product_type?: string;
    page?: number;
    limit?: number;
    ids?: string[];
  }) {
    const where = this.buildDealsWhere(options);
    const orderBy = options?.status
      ? { created_at: 'desc' as const }
      : { updated_at: 'desc' as const };

    return this.prisma.deals.findMany({
      where,
      orderBy,
    });
  }

  /** Paginated deal list with total count and associated packets. */
  async findAllPaginated(options: {
    status?: string;
    search?: string;
    state?: string;
    product_type?: string;
    page: number;
    limit: number;
    ids?: string[];
  }) {
    const where = this.buildDealsWhere(options);
    const skip = (options.page - 1) * options.limit;

    const [data, count] = await Promise.all([
      this.prisma.deals.findMany({
        where,
        skip,
        take: options.limit,
        orderBy: { updated_at: 'desc' },
        include: { packets: { select: { name: true } } },
      }),
      this.prisma.deals.count({ where }),
    ]);

    return { data, count };
  }

  findById(id: string) {
    return this.prisma.deals.findUnique({ where: { id } });
  }

  /** List deals for dashboard view with selected fields. */
  findForDashboard() {
    return this.prisma.deals.findMany({
      select: {
        id: true,
        deal_number: true,
        borrower_name: true,
        status: true,
        updated_at: true,
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  search(query: string, limit = 50) {
    return this.prisma.deals.findMany({
      where: {
        OR: [
          { deal_number: { contains: query, mode: 'insensitive' } },
          { borrower_name: { contains: query, mode: 'insensitive' } },
          { property_address: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, deal_number: true, borrower_name: true },
      orderBy: { deal_number: 'desc' },
      take: limit,
    });
  }

  create(dto: CreateDealDto) {
    return this.prisma.deals.create({ data: dto as unknown as Prisma.dealsUncheckedCreateInput });
  }

  update(id: string, dto: UpdateDealDto) {
    return this.prisma.deals.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as unknown as Prisma.dealsUncheckedUpdateInput,
    });
  }

  delete(id: string) {
    return this.prisma.deals.delete({ where: { id } });
  }

  count() {
    return this.prisma.deals.count();
  }

  // ─── Participants ─────────────────────────────────────────────────────────────

  findParticipantsFiltered(options?: {
    contactId?: string;
    role?: string;
    dealIds?: string[];
    search?: string;
    limit?: number;
  }) {
    const where: Prisma.deal_participantsWhereInput = {};
    if (options?.contactId) where.contact_id = options.contactId;
    if (options?.role) where.role = options.role as $Enums.app_role;
    if (options?.dealIds?.length) where.deal_id = { in: options.dealIds };
    if (options?.search?.trim()) {
      const s = options.search.trim();
      where.email = { not: null };
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }
    return this.prisma.deal_participants.findMany({
      where,
      take: options?.limit,
      orderBy: { created_at: 'desc' },
    });
  }

  async findParticipants(
    dealId: string,
    options?: { role?: string; roles?: string[]; sort?: string; include?: string },
  ) {
    const where: Record<string, unknown> = { deal_id: dealId };
    if (options?.role) where['role'] = options.role;
    if (options?.roles?.length) where['role'] = { in: options.roles };

    const includeContacts = options?.include === 'contact';

    const participants = await this.prisma.deal_participants.findMany({
      where,
      orderBy: options?.sort === 'created_at'
        ? { created_at: 'asc' }
        : { sequence_order: 'asc' },
    });

    if (!includeContacts) return participants;

    const contactIds = [
      ...new Set(
        participants.map((p) => p.contact_id).filter((id): id is string => !!id),
      ),
    ];
    if (!contactIds.length) {
      return participants.map((p) => ({ ...p, contacts: null }));
    }

    const contacts = await this.prisma.contacts.findMany({
      where: { id: { in: contactIds } },
    });
    const contactsById = new Map(contacts.map((c) => [c.id, c]));

    return participants.map((p) => ({
      ...p,
      contacts: p.contact_id ? contactsById.get(p.contact_id) ?? null : null,
    }));
  }

  findParticipantById(id: string) {
    return this.prisma.deal_participants.findUnique({ where: { id } });
  }

  countParticipants(dealId: string) {
    return this.prisma.deal_participants.count({ where: { deal_id: dealId } });
  }

  createParticipant(dealId: string, dto: CreateParticipantDto) {
    return this.prisma.deal_participants.create({
      data: { deal_id: dealId, ...dto } as unknown as Prisma.deal_participantsUncheckedCreateInput,
    });
  }

  updateParticipant(id: string, dto: UpdateParticipantDto) {
    return this.prisma.deal_participants.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as unknown as Prisma.deal_participantsUncheckedUpdateInput,
    });
  }

  deleteParticipant(id: string) {
    return this.prisma.deal_participants.delete({ where: { id } });
  }

  deleteParticipantsByIds(ids: string[]) {
    return this.prisma.deal_participants.deleteMany({ where: { id: { in: ids } } });
  }

  deleteParticipantsByContactIds(contactIds: string[]) {
    return this.prisma.deal_participants.deleteMany({
      where: { contact_id: { in: contactIds } },
    });
  }

  // ─── Section Values ──────────────────────────────────────────────────────────

  findSections(dealId: string) {
    return this.prisma.deal_section_values.findMany({ where: { deal_id: dealId } });
  }

  findSection(dealId: string, section: string) {
    return this.prisma.deal_section_values.findFirst({
      where: { deal_id: dealId, section: section as $Enums.field_section },
    });
  }

  async upsertSection(dealId: string, section: string, fieldValues: Record<string, unknown>) {
    const sec = section as $Enums.field_section;
    const existing = await this.prisma.deal_section_values.findFirst({
      where: { deal_id: dealId, section: sec },
      select: { field_values: true, version: true },
    });
    const existingFv =
      (existing?.field_values as Record<string, unknown> | null | undefined) ?? {};
    const mergedFv = { ...existingFv, ...fieldValues } as Prisma.InputJsonValue;
    return this.prisma.deal_section_values.upsert({
      where: { deal_id_section: { deal_id: dealId, section: sec } },
      create: { deal_id: dealId, section: sec, field_values: mergedFv, version: 1 },
      update: {
        field_values: mergedFv,
        updated_at: new Date(),
        version: (existing?.version ?? 0) + 1,
      },
    });
  }

  /** Mirrors `.select('deal_id, field_values').eq('section', section)`. */
  findSectionsBySection(section: string) {
    return this.prisma.deal_section_values.findMany({
      where: { section: section as $Enums.field_section },
      select: { deal_id: true, field_values: true },
    });
  }

  /** Mirrors `.in('deal_id', dealIds)` with optional section filter. */
  findSectionsForDeals(
    dealIds: string[],
    options?: { section?: string; sections?: string[] },
  ) {
    const where: Prisma.deal_section_valuesWhereInput = {
      deal_id: { in: dealIds },
    };
    if (options?.section) {
      where.section = options.section as $Enums.field_section;
    } else if (options?.sections?.length) {
      where.section = { in: options.sections as $Enums.field_section[] };
    }
    return this.prisma.deal_section_values.findMany({
      where,
      select: { deal_id: true, field_values: true, section: true },
    });
  }

  // ─── Loan History ────────────────────────────────────────────────────────────

  findLoanHistory(dealId: string) {
    return this.prisma.loan_history.findMany({
      where: { deal_id: dealId },
      include: { loan_history_lenders: true },
      orderBy: { date_received: 'desc' },
    });
  }

  findLoanHistoryByDealIds(
    dealIds: string[],
    orderColumn: 'date_due' | 'date_received' = 'date_due',
    ascending = false,
  ) {
    return this.prisma.loan_history.findMany({
      where: { deal_id: { in: dealIds } },
      include: { loan_history_lenders: true },
      orderBy: { [orderColumn]: ascending ? 'asc' : 'desc' },
    });
  }

  findLoanHistoryLenders(historyIds: string[]) {
    if (!historyIds.length) return [];
    return this.prisma.loan_history_lenders.findMany({
      where: { loan_history_id: { in: historyIds } },
    });
  }

  createLoanHistory(dealId: string, dto: CreateLoanHistoryDto) {
    return this.prisma.loan_history.create({
      data: { deal_id: dealId, ...dto } as unknown as Prisma.loan_historyUncheckedCreateInput,
    });
  }

  updateLoanHistory(id: string, dto: UpdateLoanHistoryDto) {
    return this.prisma.loan_history.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as unknown as Prisma.loan_historyUncheckedUpdateInput,
    });
  }

  deleteLoanHistory(id: string) {
    return this.prisma.loan_history.delete({ where: { id } });
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  findAssignments(dealId: string) {
    return this.prisma.deal_assignments.findMany({ where: { deal_id: dealId } });
  }

  findUserAssignments(userId: string) {
    return this.prisma.deal_assignments.findMany({ where: { user_id: userId } });
  }

  createAssignment(dealId: string, assignedBy: string, dto: CreateAssignmentDto) {
    const role = dto.role as $Enums.app_role;
    return this.prisma.deal_assignments.upsert({
      where: { deal_id_user_id: { deal_id: dealId, user_id: dto.user_id } },
      create: {
        deal_id: dealId,
        user_id: dto.user_id,
        role,
        assigned_by: assignedBy,
        notes: dto.notes,
      },
      update: { role, notes: dto.notes },
    });
  }

  deleteAssignment(dealId: string, userId: string) {
    return this.prisma.deal_assignments.deleteMany({
      where: { deal_id: dealId, user_id: userId },
    });
  }

  // ─── Activity & Journal ──────────────────────────────────────────────────────

  findActivityLog(dealId: string, limit?: number) {
    return this.prisma.activity_log.findMany({
      where: { deal_id: dealId },
      orderBy: { created_at: 'desc' },
      take: limit ?? undefined,
    });
  }

  findRecentActivityLog(dealId: string, since: string) {
    return this.prisma.activity_log.findMany({
      where: { deal_id: dealId, created_at: { gte: new Date(since) } },
      orderBy: { created_at: 'desc' },
    });
  }

  findLastExternalDataReview(dealId: string) {
    return this.prisma.activity_log.findFirst({
      where: { deal_id: dealId, action_type: 'ExternalDataReviewed' },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });
  }

  createActivityLog(
    dealId: string,
    data: { actor_user_id: string; action_type: string; action_details?: Record<string, unknown> },
  ) {
    return this.prisma.activity_log.create({
      data: { deal_id: dealId, ...data } as unknown as Prisma.activity_logUncheckedCreateInput,
    });
  }

  findEventJournal(dealId: string, page?: number, limit?: number) {
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit ?? undefined;
    return this.prisma.event_journal.findMany({
      where: { deal_id: dealId },
      orderBy: { event_number: 'desc' },
      skip,
      take,
    });
  }

  async findEventJournalPaginated(dealId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { deal_id: dealId };
    const [entries, count] = await Promise.all([
      this.prisma.event_journal.findMany({
        where,
        orderBy: { event_number: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.event_journal.count({ where }),
    ]);
    return { entries, count };
  }

  createEventJournal(data: Record<string, unknown>) {
    return this.prisma.event_journal.create({ data: data as unknown as Prisma.event_journalUncheckedCreateInput });
  }

  findEventJournalEntry(id: string) {
    return this.prisma.event_journal.findUnique({ where: { id } });
  }

  findUserDisplayNames(ids: string[]) {
    if (!ids.length) return [];
    return this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, full_name: true, email: true },
    });
  }

  // ─── Magic Links ─────────────────────────────────────────────────────────────

  findMagicLinks(participantId: string) {
    return this.prisma.magic_links.findMany({
      where: { deal_participant_id: participantId },
      orderBy: { created_at: 'desc' },
    });
  }

  createMagicLink(data: Record<string, unknown>) {
    return this.prisma.magic_links.create({ data: data as unknown as Prisma.magic_linksUncheckedCreateInput });
  }

  revokeMagicLink(id: string) {
    return this.prisma.magic_links.update({
      where: { id },
      data: { max_uses: 0 },
    });
  }
}

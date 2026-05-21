import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateDealNumber as generateDealNumberRpc } from '../../common/helpers/db-sequences';
import { DealsRepository } from './deals.repository';
import {
  CreateDealDto,
  UpdateDealDto,
  CreateParticipantDto,
  UpdateParticipantDto,
  UpsertSectionDto,
  CreateLoanHistoryDto,
  UpdateLoanHistoryDto,
  CreateAssignmentDto,
  CreateActivityLogDto,
} from './dto/deals.dto';

@Injectable()
export class DealsService {
  constructor(
    private readonly repo: DealsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Deals ───────────────────────────────────────────────────────────────────

  listDeals(options?: { status?: string; search?: string; page?: number; limit?: number; ids?: string[] }) {
    if (options?.page != null && options?.limit != null) {
      return this.repo.findAllPaginated({
        status: options.status,
        search: options.search,
        page: options.page,
        limit: options.limit,
        ids: options.ids,
      });
    }
    return this.repo.findAll(options);
  }

  listUserAssignments(userId: string) {
    return this.repo.findUserAssignments(userId);
  }

  async getDeal(id: string) {
    const deal = await this.repo.findById(id);
    if (!deal) throw new NotFoundException(`Deal '${id}' not found`);
    return deal;
  }

  getDashboard() {
    return this.repo.findForDashboard();
  }

  searchDeals(query: string, limit?: number) {
    return this.repo.search(query, limit);
  }

  createDeal(dto: CreateDealDto) {
    return this.repo.create(dto);
  }

  async updateDeal(id: string, dto: UpdateDealDto) {
    await this.getDeal(id);
    return this.repo.update(id, dto);
  }

  async deleteDeal(id: string) {
    await this.getDeal(id);
    return this.repo.delete(id);
  }

  countDeals() {
    return this.repo.count();
  }

  generateDealNumber() {
    return generateDealNumberRpc(this.prisma);
  }

  // ─── Participants ─────────────────────────────────────────────────────────────

  listParticipants(
    dealId: string,
    options?: { role?: string; roles?: string[]; sort?: string; include?: string },
  ) {
    return this.repo.findParticipants(dealId, options);
  }

  listParticipantsFiltered(options?: {
    contactId?: string;
    role?: string;
    dealIds?: string[];
    search?: string;
    limit?: number;
  }) {
    return this.repo.findParticipantsFiltered(options);
  }

  async getParticipant(id: string) {
    const participant = await this.repo.findParticipantById(id);
    if (!participant) throw new NotFoundException(`Participant '${id}' not found`);
    return participant;
  }

  createParticipant(dealId: string, dto: CreateParticipantDto) {
    return this.repo.createParticipant(dealId, dto);
  }

  async updateParticipant(id: string, dto: UpdateParticipantDto) {
    await this.getParticipant(id);
    return this.repo.updateParticipant(id, dto);
  }

  async deleteParticipant(id: string) {
    await this.getParticipant(id);
    return this.repo.deleteParticipant(id);
  }

  deleteParticipantsByContactIds(contactIds: string[]) {
    return this.repo.deleteParticipantsByContactIds(contactIds);
  }

  // ─── Sections ────────────────────────────────────────────────────────────────

  listSections(dealId: string) {
    return this.repo.findSections(dealId);
  }

  getSection(dealId: string, section: string) {
    return this.repo.findSection(dealId, section);
  }

  upsertSection(dealId: string, section: string, dto: UpsertSectionDto) {
    return this.repo.upsertSection(dealId, section, dto.field_values);
  }

  listSectionsBySection(section: string) {
    return this.repo.findSectionsBySection(section);
  }

  listSectionsForDeals(
    dealIds: string[],
    options?: { section?: string; sections?: string[] },
  ) {
    return this.repo.findSectionsForDeals(dealIds, options);
  }

  // ─── Loan History ────────────────────────────────────────────────────────────

  listLoanHistory(dealId: string) {
    return this.repo.findLoanHistory(dealId);
  }

  listLoanHistoryByDealIds(
    dealIds: string[],
    orderColumn?: 'date_due' | 'date_received',
    ascending?: boolean,
  ) {
    return this.repo.findLoanHistoryByDealIds(
      dealIds,
      orderColumn ?? 'date_due',
      ascending ?? false,
    );
  }

  listLoanHistoryLenders(historyIds: string[]) {
    return this.repo.findLoanHistoryLenders(historyIds);
  }

  createLoanHistory(dealId: string, dto: CreateLoanHistoryDto) {
    return this.repo.createLoanHistory(dealId, dto);
  }

  async updateLoanHistory(id: string, dto: UpdateLoanHistoryDto) {
    return this.repo.updateLoanHistory(id, dto);
  }

  async deleteLoanHistory(id: string) {
    return this.repo.deleteLoanHistory(id);
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  listAssignments(dealId: string) {
    return this.repo.findAssignments(dealId);
  }

  createAssignment(dealId: string, assignedBy: string, dto: CreateAssignmentDto) {
    return this.repo.createAssignment(dealId, assignedBy, dto);
  }

  deleteAssignment(dealId: string, userId: string) {
    return this.repo.deleteAssignment(dealId, userId);
  }

  // ─── Activity & Journal ──────────────────────────────────────────────────────

  listActivity(dealId: string, limit?: number) {
    return this.repo.findActivityLog(dealId, limit);
  }

  listRecentActivity(dealId: string, since: string) {
    return this.repo.findRecentActivityLog(dealId, since);
  }

  getLastExternalDataReview(dealId: string) {
    return this.repo.findLastExternalDataReview(dealId);
  }

  createActivityLog(dealId: string, dto: CreateActivityLogDto) {
    return this.repo.createActivityLog(dealId, dto);
  }

  listJournal(dealId: string, page?: number, limit?: number) {
    if (page != null && limit != null) {
      return this.repo.findEventJournalPaginated(dealId, page, limit);
    }
    return this.repo.findEventJournal(dealId, page, limit);
  }

  createJournalEntry(payload: Record<string, unknown>) {
    return this.repo.createEventJournal(payload);
  }

  async getJournalEntry(id: string) {
    const entry = await this.repo.findEventJournalEntry(id);
    if (!entry) throw new NotFoundException(`Journal entry '${id}' not found`);
    return entry;
  }

  // ─── Magic Links ─────────────────────────────────────────────────────────────

  listMagicLinks(participantId: string) {
    return this.repo.findMagicLinks(participantId);
  }

  createMagicLink(participantId: string, createdBy: string, body?: Record<string, unknown>) {
    const data: Record<string, unknown> = body
      ? { deal_participant_id: participantId, created_by: createdBy, ...body }
      : {
          deal_participant_id: participantId,
          token: `ml_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          created_by: createdBy,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          max_uses: 1,
          used_count: 0,
        };
    return this.repo.createMagicLink(data);
  }

  revokeMagicLink(id: string) {
    return this.repo.revokeMagicLink(id);
  }
}

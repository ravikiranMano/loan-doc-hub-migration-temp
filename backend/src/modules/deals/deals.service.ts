import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateDealNumber as generateDealNumberRpc,
  generateContactId as generateContactIdRpc,
} from '../../common/helpers/db-sequences';
import {
  CLEAN_FUNDING_HISTORY_KEYS,
  FUNDING_OPERATIONAL_FIELD_KEYS,
  CONTACT_OPERATIONAL_KEYWORDS,
  getCanonicalFundingHistoryKey,
  isOperationalCloneFieldKey,
  sanitizeContactDataForCopy,
} from './deal-clone.constants';
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
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly repo: DealsRepository,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Deals ───────────────────────────────────────────────────────────────────

  listDeals(options?: {
    status?: string;
    search?: string;
    state?: string;
    product_type?: string;
    page?: number;
    limit?: number;
    ids?: string[];
  }) {
    if (options?.page != null && options?.limit != null) {
      return this.repo.findAllPaginated({
        status: options.status,
        search: options.search,
        state: options.state,
        product_type: options.product_type,
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
      return this.repo.findEventJournalPaginated(dealId, page, limit).then(async (result) => ({
        entries: await this.enrichJournalEntries(result.entries),
        count: result.count,
      }));
    }
    return this.repo.findEventJournal(dealId, page, limit).then((entries) =>
      this.enrichJournalEntries(entries),
    );
  }

  /** Attach display names from public.users (journal stores actor_user_id only). */
  private async enrichJournalEntries<T extends { actor_user_id: string }>(entries: T[]) {
    if (!entries.length) return entries;
    const ids = [...new Set(entries.map((e) => e.actor_user_id))];
    const users = await this.repo.findUserDisplayNames(ids);
    const nameById = new Map(
      users.map((u) => [u.id, u.full_name || u.email || 'Unknown'] as const),
    );
    return entries.map((e) => ({
      ...e,
      actor_name: nameById.get(e.actor_user_id) ?? 'Unknown',
    }));
  }

  createJournalEntry(payload: Record<string, unknown>) {
    return this.repo.createEventJournal(payload);
  }

  async getJournalEntry(id: string) {
    const entry = await this.repo.findEventJournalEntry(id);
    if (!entry) throw new NotFoundException(`Journal entry '${id}' not found`);
    const [enriched] = await this.enrichJournalEntries([entry]);
    return enriched;
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

  // ─── Participant invite ───────────────────────────────────────────────────────

  async inviteParticipant(
    participantId: string,
    dto: {
      email: string;
      name?: string;
      accessMethod: 'login' | 'magic_link';
      magicLinkUrl?: string;
      dealNumber: string;
      role: string;
    },
  ) {
    const resendApiKey = this.config.get<string>('resend.apiKey');
    if (!resendApiKey) throw new InternalServerErrorException('Email service not configured');

    const recipientName = dto.name || 'there';
    const roleDisplay = dto.role.charAt(0).toUpperCase() + dto.role.slice(1);
    const subject = `You're invited to participate in Deal ${dto.dealNumber}`;

    let html: string;
    if (dto.accessMethod === 'magic_link' && dto.magicLinkUrl) {
      const link = dto.magicLinkUrl;
      html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">Hello ${recipientName}!</h1>
          <p style="color:#4a4a4a;font-size:16px;line-height:1.6;">You have been invited to participate as a <strong>${roleDisplay}</strong> in deal <strong>${dto.dealNumber}</strong>.</p>
          <p style="color:#4a4a4a;font-size:16px;line-height:1.6;">Click the button below to securely access the deal and complete your required information:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${link}" style="display:inline-block;background-color:#2563eb;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Access Deal</a>
          </div>
          <p style="color:#6b7280;font-size:14px;">This link is secure and unique to you. Please do not share it with others.</p>
          <p style="color:#6b7280;font-size:14px;">If you have any questions, please contact your loan officer.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:30px 0;" />
          <p style="color:#9ca3af;font-size:12px;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${link}" style="color:#2563eb;word-break:break-all;">${link}</a></p>
        </div>`;
    } else {
      const appUrl = this.config.get<string>('app.corsOrigin') || '';
      const loginUrl = `${appUrl}/auth`;
      html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:20px;">Hello ${recipientName}!</h1>
          <p style="color:#4a4a4a;font-size:16px;line-height:1.6;">You have been invited to participate as a <strong>${roleDisplay}</strong> in deal <strong>${dto.dealNumber}</strong>.</p>
          <p style="color:#4a4a4a;font-size:16px;line-height:1.6;">To access the deal, please log in to your account:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${loginUrl}" style="display:inline-block;background-color:#2563eb;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Log In</a>
          </div>
          <p style="color:#6b7280;font-size:14px;">If you don't have an account yet, please register using this email address (${dto.email}).</p>
          <p style="color:#6b7280;font-size:14px;">If you have any questions, please contact your loan officer.</p>
        </div>`;
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Loan Portal <onboarding@resend.dev>', to: [dto.email], subject, html }),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({})) as { message?: string };
      throw new InternalServerErrorException(
        `Failed to send invite email: ${errData.message || `HTTP ${resp.status}`}`,
      );
    }

    return { success: true, participantId };
  }

  // ─── Complete participant section ─────────────────────────────────────────────

  async completeParticipantSection(participantId: string, dealId: string) {
    const participant = await this.prisma.deal_participants.findFirst({
      where: { id: participantId, deal_id: dealId },
      include: { deals: { select: { deal_number: true, created_by: true } } },
    });

    if (!participant) throw new NotFoundException('Participant not found');
    if (participant.status === 'completed') throw new BadRequestException('Section already completed');

    await this.prisma.deal_participants.update({
      where: { id: participantId },
      data: { status: 'completed', completed_at: new Date() },
    });

    const actorId = participant.user_id || participant.deals.created_by;
    this.prisma.activity_log.create({
      data: {
        deal_id: dealId,
        actor_user_id: actorId,
        action_type: 'ParticipantCompleted',
        action_details: { role: participant.role, participantId: participant.id } as Prisma.InputJsonValue,
      },
    }).catch((err: unknown) => this.logger.warn('activity_log insert failed', err));

    const allParticipants = await this.prisma.deal_participants.findMany({
      where: { deal_id: dealId },
      orderBy: { sequence_order: 'asc' },
    });

    let nextParticipant: { id: string; role: string } | null = null;
    if (participant.sequence_order !== null) {
      const next = allParticipants.find(
        (p) =>
          p.sequence_order !== null &&
          p.sequence_order > participant.sequence_order! &&
          p.status !== 'completed',
      );
      if (next) nextParticipant = { id: next.id, role: next.role };
    }

    const resendApiKey = this.config.get<string>('resend.apiKey');
    if (resendApiKey && participant.deals.created_by) {
      const csrUser = await this.prisma.users.findUnique({
        where: { id: participant.deals.created_by },
        select: { email: true },
      });

      if (csrUser?.email) {
        const roleDisplay = participant.role.charAt(0).toUpperCase() + participant.role.slice(1);
        const dealNumber = participant.deals.deal_number;
        const emailHtml = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#1a1a1a;">Section Completed</h2>
            <p>The <strong>${roleDisplay}</strong> has completed their section for deal <strong>${dealNumber}</strong>.</p>
            ${nextParticipant
              ? `<p style="color:#666;">Next in sequence: <strong>${nextParticipant.role}</strong> has been unlocked and can now enter their data.</p>`
              : `<p style="color:#22c55e;">All participants in sequence have completed their sections!</p>`}
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
            <p style="color:#888;font-size:12px;">This is an automated notification from your deal management system.</p>
          </div>`;

        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
          body: JSON.stringify({
            from: 'Deal System <noreply@resend.dev>',
            to: [csrUser.email],
            subject: `[${dealNumber}] ${roleDisplay} completed their section`,
            html: emailHtml,
          }),
        }).catch(() => {});
      }
    }

    return { success: true, nextParticipant };
  }

  // ─── Validate magic link ──────────────────────────────────────────────────────

  async validateMagicLink(token: string) {
    if (!token) throw new BadRequestException('Token is required');

    type MagicLinkRpcRow = {
      is_valid: boolean;
      error_message: string | null;
      participant_id: string | null;
      deal_id: string | null;
      role: string | null;
      deal_number: string | null;
    };

    const rows = await this.prisma.$queryRaw<MagicLinkRpcRow[]>`
      SELECT * FROM validate_magic_link(${token})
    `;

    const result = rows?.[0];
    if (!result?.is_valid) {
      return { isValid: false, error: result?.error_message || 'Invalid or expired link' };
    }

    this.prisma.deal_participants.update({
      where: { id: result.participant_id! },
      data: { status: 'in_progress' },
    }).catch((err: unknown) => this.logger.warn('participant status update failed', err));

    this.prisma.activity_log.create({
      data: {
        deal_id: result.deal_id!,
        actor_user_id: result.participant_id!,
        action_type: 'MagicLinkAccessed',
        action_details: {
          role: result.role,
          participantId: result.participant_id,
          dealNumber: result.deal_number,
        } as Prisma.InputJsonValue,
      },
    }).catch((err: unknown) => this.logger.warn('activity_log insert failed', err));

    return {
      isValid: true,
      dealId: result.deal_id,
      role: result.role,
      participantId: result.participant_id,
      dealNumber: result.deal_number,
      sessionToken: crypto.randomUUID(),
    };
  }

  // ─── SSE polling helpers ──────────────────────────────────────────────────────

  async hasRecentDealsChanges(since: Date): Promise<boolean> {
    const count = await this.prisma.deals.count({ where: { updated_at: { gt: since } } });
    return count > 0;
  }

  async hasRecentParticipantChanges(dealId: string, since: Date): Promise<boolean> {
    const count = await this.prisma.deal_participants.count({
      where: { deal_id: dealId, updated_at: { gt: since } },
    });
    return count > 0;
  }

  async hasRecentDocumentChanges(dealId: string, since: Date): Promise<boolean> {
    const [docCount, jobCount] = await Promise.all([
      this.prisma.generated_documents.count({
        where: { deal_id: dealId, created_at: { gt: since } },
      }),
      this.prisma.generation_jobs.count({
        where: {
          deal_id: dealId,
          OR: [
            { created_at: { gt: since } },
            { started_at: { gt: since } },
            { completed_at: { gt: since } },
          ],
        },
      }),
    ]);
    return docCount > 0 || jobCount > 0;
  }

  /**
   * Clone deal business setup (sections, typed field values, participants + contacts).
   * Mirrors CSR DealsPage handleCopyDeal — excludes notes, history, and operational keys.
   */
  async cloneDeal(sourceDealId: string, createdBy?: string) {
    const src = await this.getDeal(sourceDealId);
    const dealNumber = await generateDealNumberRpc(this.prisma);

    return this.prisma.$transaction(async (tx) => {
      const newDeal = await tx.deals.create({
        data: {
          deal_number: dealNumber,
          state: src.state || 'TBD',
          product_type: src.product_type || 'TBD',
          mode: (src.mode as 'doc_prep' | 'servicing_only') || 'doc_prep',
          status: 'draft',
          packet_id: src.packet_id,
          loan_amount: src.loan_amount,
          property_address: src.property_address,
          borrower_name: src.borrower_name,
          notes: src.notes,
          created_by: createdBy ?? src.created_by,
        },
      });
      const newDealId = newDeal.id;

      const excludeDictRows = await tx.field_dictionary.findMany({
        where: {
          OR: [
            { field_key: { in: [...FUNDING_OPERATIONAL_FIELD_KEYS] } },
            ...CONTACT_OPERATIONAL_KEYWORDS.map((token) => ({
              field_key: { contains: token, mode: 'insensitive' as const },
            })),
          ],
        },
        select: { id: true, field_key: true },
      });

      const excludedDictIds = new Set<string>();
      const excludedDbKeys = new Set<string>();
      const emptyFundingHistoryDictRow = excludeDictRows.find(
        (r) => getCanonicalFundingHistoryKey(r.field_key) === 'loan_terms.funding_history',
      );
      for (const r of excludeDictRows) {
        if (
          isOperationalCloneFieldKey(r.field_key) ||
          CLEAN_FUNDING_HISTORY_KEYS.has(getCanonicalFundingHistoryKey(r.field_key))
        ) {
          excludedDictIds.add(r.id);
          excludedDbKeys.add(r.field_key);
        }
      }

      const sectionRows = await tx.deal_section_values.findMany({
        where: { deal_id: sourceDealId, section: { not: 'notes' } },
        select: { section: true, field_values: true, version: true },
      });

      if (sectionRows.length > 0) {
        await tx.deal_section_values.createMany({
          data: sectionRows.map((r) => {
            const cleaned: Record<string, unknown> = {};
            const fv =
              r.field_values && typeof r.field_values === 'object'
                ? (r.field_values as Record<string, unknown>)
                : {};
            for (const [k, v] of Object.entries(fv)) {
              const tail = k.includes('::') ? k.split('::').pop()! : k;
              if (excludedDictIds.has(tail)) continue;
              if (excludedDbKeys.has(tail) || isOperationalCloneFieldKey(k)) continue;
              if (v && typeof v === 'object') {
                const fieldData = v as Record<string, unknown>;
                const indexedKey = String(
                  fieldData.indexed_key || fieldData.indexed_db_key || '',
                );
                if (indexedKey && isOperationalCloneFieldKey(indexedKey)) continue;
              }
              cleaned[k] = v;
            }
            if (r.section === 'loan_terms' && emptyFundingHistoryDictRow?.id) {
              cleaned[emptyFundingHistoryDictRow.id] = {
                value_text: '[]',
                indexed_key: 'loan_terms.funding_history',
                indexed_db_key: emptyFundingHistoryDictRow.field_key,
                updated_at: new Date().toISOString(),
              };
            }
            return {
              deal_id: newDealId,
              section: r.section,
              field_values: cleaned as object,
              version: r.version ?? 1,
            };
          }),
        });
      }

      const fieldRows = await tx.deal_field_values.findMany({
        where: { deal_id: sourceDealId },
        select: {
          field_dictionary_id: true,
          value_text: true,
          value_number: true,
          value_date: true,
          value_json: true,
        },
      });
      const filteredFieldRows = fieldRows.filter(
        (r) => !excludedDictIds.has(r.field_dictionary_id),
      );
      if (filteredFieldRows.length > 0) {
        await tx.deal_field_values.createMany({
          data: filteredFieldRows.map((r) => ({
            deal_id: newDealId,
            field_dictionary_id: r.field_dictionary_id,
            value_text: r.value_text,
            value_number: r.value_number,
            value_date: r.value_date,
            value_json: r.value_json,
            updated_by: createdBy ?? null,
          })),
        });
      }

      const partRows = await tx.deal_participants.findMany({
        where: { deal_id: sourceDealId },
        select: {
          contact_id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
          sequence_order: true,
          access_method: true,
        },
      });

      const clonedContactIds = new Map<string, string>();

      if (partRows.length > 0) {
        const sourceContactIds = [
          ...new Set(partRows.map((p) => p.contact_id).filter(Boolean)),
        ] as string[];

        if (sourceContactIds.length > 0) {
          const contacts = await tx.contacts.findMany({
            where: { id: { in: sourceContactIds } },
          });

          for (const contact of contacts) {
            const generatedContactId = await generateContactIdRpc(tx, contact.contact_type);
            const cloned = await tx.contacts.create({
              data: {
                contact_type: contact.contact_type,
                contact_id: generatedContactId,
                created_by: createdBy ?? contact.created_by,
                full_name: contact.full_name || '',
                first_name: contact.first_name || '',
                last_name: contact.last_name || '',
                email: contact.email || '',
                phone: contact.phone || '',
                city: contact.city || '',
                state: contact.state || '',
                company: contact.company || '',
                contact_data: sanitizeContactDataForCopy(contact.contact_data) as object,
              },
            });
            clonedContactIds.set(contact.id, cloned.id);
          }
        }

        await tx.deal_participants.createMany({
          data: partRows.map((p) => ({
            deal_id: newDealId,
            contact_id: p.contact_id ? clonedContactIds.get(p.contact_id) ?? null : null,
            role: p.role,
            name: p.name,
            email: p.email,
            phone: p.phone,
            sequence_order: p.sequence_order,
            access_method: p.access_method ?? 'login',
            status: 'invited',
          })),
        });

        if (clonedContactIds.size > 0) {
          const participantSection = await tx.deal_section_values.findFirst({
            where: { deal_id: newDealId, section: 'participants' },
          });
          if (participantSection?.field_values) {
            const fv = participantSection.field_values as Record<string, unknown>;
            const remapped: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(fv)) {
              let remappedKey = key;
              clonedContactIds.forEach((newId, oldId) => {
                remappedKey = remappedKey.split(oldId).join(newId);
              });
              remapped[remappedKey] = value;
            }
            await tx.deal_section_values.update({
              where: { id: participantSection.id },
              data: {
                field_values: remapped as object,
                updated_at: new Date(),
                version: participantSection.version + 1,
              },
            });
          }
        }
      }

      return newDeal;
    });
  }
}

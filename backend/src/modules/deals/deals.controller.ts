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
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DealsService } from './deals.service';
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, Public } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(private readonly service: DealsService) {}

  // ─── Deals ───────────────────────────────────────────────────────────────────

  // GET /api/deals?status=&search=&state=&product_type=&page=&limit=&ids=
  @Get()
  listDeals(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('state') state?: string,
    @Query('product_type') productType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('ids') ids?: string,
  ) {
    return this.service.listDeals({
      status,
      search,
      state,
      product_type: productType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      ids: ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    });
  }

  @Post()
  createDeal(@Body() dto: CreateDealDto, @CurrentUser() user: JwtPayload) {
    return this.service.createDeal({ ...dto, created_by: dto.created_by || user?.sub } as CreateDealDto);
  }

  @Get('dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('search')
  searchDeals(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.service.searchDeals(q || '', limit ? parseInt(limit, 10) : undefined);
  }

  @Get('count')
  countDeals() {
    return this.service.countDeals();
  }

  @Get('generate-number')
  async generateDealNumber() {
    const dealNumber = await this.service.generateDealNumber();
    return { dealNumber };
  }

  /** POST /api/deals/:id/clone — duplicate business setup into a new draft deal. */
  @Post(':id/clone')
  cloneDeal(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.cloneDeal(id, user?.sub);
  }

  @Get('sections/by-section/:section')
  listSectionsBySection(@Param('section') section: string) {
    return this.service.listSectionsBySection(section);
  }

  @Get('sections')
  listSectionsForDeals(
    @Query('dealIds') dealIds: string,
    @Query('section') section?: string,
    @Query('sections') sections?: string,
  ) {
    const ids = dealIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.listSectionsForDeals(ids, {
      section,
      sections: sections ? sections.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    });
  }

  @Get('loan-history/lenders')
  listLoanHistoryLenders(@Query('historyIds') historyIds: string) {
    const ids = historyIds
      ? historyIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return this.service.listLoanHistoryLenders(ids);
  }

  @Get('journal/:entryId')
  getJournalEntryGlobal(@Param('entryId') entryId: string) {
    return this.service.getJournalEntry(entryId);
  }

  @Get('loan-history')
  listLoanHistoryByDealIds(
    @Query('dealIds') dealIds: string,
    @Query('orderColumn') orderColumn?: string,
    @Query('ascending') ascending?: string,
  ) {
    const ids = dealIds.split(',').map((s) => s.trim()).filter(Boolean);
    const col =
      orderColumn === 'date_received' ? 'date_received' : ('date_due' as const);
    return this.service.listLoanHistoryByDealIds(ids, col, ascending === 'true');
  }

  @Delete('participants/by-contact')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteParticipantsByContact(@Query('contactIds') contactIds: string) {
    const ids = contactIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.deleteParticipantsByContactIds(ids);
  }

  @Get('participants/:pid/magic-links')
  listMagicLinksForParticipant(@Param('pid') pid: string) {
    return this.service.listMagicLinks(pid);
  }

  @Post('participants/:pid/magic-links')
  createMagicLinkForParticipant(
    @Param('pid') pid: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createMagicLink(pid, user?.sub, body);
  }

  @Patch('magic-links/:mlId/revoke')
  revokeMagicLinkGlobal(@Param('mlId') mlId: string) {
    return this.service.revokeMagicLink(mlId);
  }

  @Get('assignments/by-user/:userId')
  listAssignmentsByUser(@Param('userId') userId: string) {
    return this.service.listUserAssignments(userId);
  }

  @Get('participants')
  listParticipantsGlobal(
    @Query('contactId') contactId?: string,
    @Query('role') role?: string,
    @Query('dealIds') dealIds?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listParticipantsFiltered({
      contactId,
      role,
      dealIds: dealIds ? dealIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('participants/:pid')
  getParticipantById(@Param('pid') pid: string) {
    return this.service.getParticipant(pid);
  }

  @Patch('participants/:pid')
  updateParticipantById(@Param('pid') pid: string, @Body() dto: UpdateParticipantDto) {
    return this.service.updateParticipant(pid, dto);
  }

  @Delete('participants/:pid')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteParticipantById(@Param('pid') pid: string) {
    return this.service.deleteParticipant(pid);
  }

  @Delete('loan-history/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLoanHistoryEntry(@Param('entryId') entryId: string) {
    return this.service.deleteLoanHistory(entryId);
  }

  // ─── SSE realtime (Phase 6 migration) ────────────────────────────────────────

  @Public()
  @Sse('events')
  dealsChanges(): Observable<MessageEvent> {
    return new Observable<MessageEvent>(subscriber => {
      let lastCheck = new Date();
      const timer = setInterval(async () => {
        const since = lastCheck;
        lastCheck = new Date();
        const changed = await this.service.hasRecentDealsChanges(since).catch(() => false);
        if (changed) subscriber.next({ data: { event: 'change' } } as MessageEvent);
      }, 3000);
      return () => clearInterval(timer);
    });
  }

  @Public()
  @Sse(':id/participants/events')
  participantsChanges(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>(subscriber => {
      let lastCheck = new Date();
      const timer = setInterval(async () => {
        const since = lastCheck;
        lastCheck = new Date();
        const changed = await this.service.hasRecentParticipantChanges(id, since).catch(() => false);
        if (changed) subscriber.next({ data: { event: 'change' } } as MessageEvent);
      }, 3000);
      return () => clearInterval(timer);
    });
  }

  @Public()
  @Sse(':id/documents/events')
  documentsChanges(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>(subscriber => {
      let lastCheck = new Date();
      const timer = setInterval(async () => {
        const since = lastCheck;
        lastCheck = new Date();
        const changed = await this.service.hasRecentDocumentChanges(id, since).catch(() => false);
        if (changed) subscriber.next({ data: { event: 'change' } } as MessageEvent);
      }, 3000);
      return () => clearInterval(timer);
    });
  }

  @Get(':id')
  getDeal(@Param('id') id: string) {
    return this.service.getDeal(id);
  }

  @Patch(':id')
  updateDeal(@Param('id') id: string, @Body() dto: UpdateDealDto) {
    return this.service.updateDeal(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDeal(@Param('id') id: string) {
    return this.service.deleteDeal(id);
  }

  // ─── Participants ─────────────────────────────────────────────────────────────

  // GET /api/deals/:id/participants?role=&roles=&sort=&include=contact
  @Get(':id/participants')
  listParticipants(
    @Param('id') id: string,
    @Query('role') role?: string,
    @Query('roles') roles?: string,
    @Query('sort') sort?: string,
    @Query('include') include?: string,
  ) {
    return this.service.listParticipants(id, {
      role,
      roles: roles ? roles.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      sort,
      include,
    });
  }

  @Post(':id/participants')
  createParticipant(@Param('id') id: string, @Body() dto: CreateParticipantDto) {
    return this.service.createParticipant(id, dto);
  }

  @Get(':id/participants/:pid')
  getParticipant(@Param('pid') pid: string) {
    return this.service.getParticipant(pid);
  }

  @Patch(':id/participants/:pid')
  updateParticipant(@Param('pid') pid: string, @Body() dto: UpdateParticipantDto) {
    return this.service.updateParticipant(pid, dto);
  }

  @Delete(':id/participants/:pid')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteParticipant(@Param('pid') pid: string) {
    return this.service.deleteParticipant(pid);
  }

  // ─── Sections ────────────────────────────────────────────────────────────────

  @Get(':id/sections')
  listSections(@Param('id') id: string) {
    return this.service.listSections(id);
  }

  @Get(':id/sections/:section')
  getSection(@Param('id') id: string, @Param('section') section: string) {
    return this.service.getSection(id, section);
  }

  @Patch(':id/sections/:section')
  upsertSection(
    @Param('id') id: string,
    @Param('section') section: string,
    @Body() dto: UpsertSectionDto,
  ) {
    return this.service.upsertSection(id, section, dto);
  }

  // ─── Loan History ────────────────────────────────────────────────────────────

  @Get(':id/loan-history')
  listLoanHistory(@Param('id') id: string) {
    return this.service.listLoanHistory(id);
  }

  @Post(':id/loan-history')
  createLoanHistory(@Param('id') id: string, @Body() dto: CreateLoanHistoryDto) {
    return this.service.createLoanHistory(id, dto);
  }

  @Patch(':id/loan-history/:entryId')
  updateLoanHistory(@Param('entryId') entryId: string, @Body() dto: UpdateLoanHistoryDto) {
    return this.service.updateLoanHistory(entryId, dto);
  }

  @Delete(':id/loan-history/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLoanHistory(@Param('entryId') entryId: string) {
    return this.service.deleteLoanHistory(entryId);
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  @Get(':id/assignments')
  listAssignments(@Param('id') id: string) {
    return this.service.listAssignments(id);
  }

  @Post(':id/assignments')
  createAssignment(
    @Param('id') id: string,
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createAssignment(id, user?.sub, dto);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAssignment(@Param('id') id: string, @Param('userId') userId: string) {
    return this.service.deleteAssignment(id, userId);
  }

  // ─── Activity & Journal ──────────────────────────────────────────────────────

  @Get(':id/activity/last-external-review')
  getLastExternalReview(@Param('id') id: string) {
    return this.service.getLastExternalDataReview(id);
  }

  @Get(':id/activity/recent')
  listRecentActivity(@Param('id') id: string, @Query('since') since: string) {
    return this.service.listRecentActivity(id, since);
  }

  @Post(':id/activity')
  createActivity(@Param('id') id: string, @Body() dto: CreateActivityLogDto) {
    return this.service.createActivityLog(id, dto);
  }

  @Get(':id/activity')
  listActivity(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.listActivity(id, limit ? parseInt(limit, 10) : undefined);
  }

  @Get(':id/journal')
  listJournal(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listJournal(
      id,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':id/journal')
  createJournalEntry(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.createJournalEntry({ ...body, deal_id: id });
  }

  @Get(':id/journal/:entryId')
  getJournalEntry(@Param('entryId') entryId: string) {
    return this.service.getJournalEntry(entryId);
  }

  // ─── Magic Links ─────────────────────────────────────────────────────────────

  @Get(':id/participants/:pid/magic-links')
  listMagicLinks(@Param('pid') pid: string) {
    return this.service.listMagicLinks(pid);
  }

  @Post(':id/participants/:pid/magic-links')
  createMagicLink(@Param('pid') pid: string, @CurrentUser() user: JwtPayload) {
    return this.service.createMagicLink(pid, user?.sub);
  }

  @Patch(':id/participants/:pid/magic-links/:mlId/revoke')
  revokeMagicLink(@Param('mlId') mlId: string) {
    return this.service.revokeMagicLink(mlId);
  }

  // ─── Participant invite (Phase 2 migration) ───────────────────────────────────

  // POST /api/deals/participants/:pid/invite (legacy path — no dealId)
  @Post('participants/:pid/invite')
  inviteParticipant(
    @Param('pid') pid: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.inviteParticipant(pid, body as any);
  }

  // POST /api/deals/:id/participants/:pid/invite (frontend path — with dealId)
  @Post(':id/participants/:pid/invite')
  inviteParticipantByDeal(
    @Param('pid') pid: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.inviteParticipant(pid, body as any);
  }

  // ─── Complete participant section (Phase 3 migration — public, no auth) ───────

  // POST /api/deals/:id/participants/:pid/complete
  @Public()
  @Post(':id/participants/:pid/complete')
  completeParticipantSection(@Param('id') dealId: string, @Param('pid') pid: string) {
    return this.service.completeParticipantSection(pid, dealId);
  }

  // ─── Validate magic link (Phase 5 migration — public, no auth) ───────────────

  // POST /api/deals/magic-links/validate
  @Public()
  @Post('magic-links/validate')
  validateMagicLink(@Body('token') token: string) {
    return this.service.validateMagicLink(token);
  }
}

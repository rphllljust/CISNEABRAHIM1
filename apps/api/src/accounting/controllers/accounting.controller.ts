import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateClosePeriodInput,
  validateReopenPeriodInput,
  validateCreateAccountInput,
  validateCreateChartInput,
  validateCreatePeriodInput,
  validateDraftJournalInput,
  validateReverseJournalInput,
} from '../domain/ledger.validation';
import {
  validateCreatePostingRuleInput,
  validateCreatePostingRuleVersionInput,
  validatePublishPostingRuleVersionInput,
} from '../domain/posting.validation';
import { AccountingAccessService } from '../services/accounting-access.service';
import { AccountingReportingService } from '../services/accounting-reporting.service';

@Controller('accounting')
@UseGuards(JwtAuthGuard)
export class AccountingController {
  constructor(
    private readonly accountingAccess: AccountingAccessService,
    private readonly accountingReporting: AccountingReportingService,
  ) {}

  @Post('charts')
  @HttpCode(200)
  createChart(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.accountingAccess.createChart(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateChartInput(body),
    );
  }

  @Get('charts')
  listCharts(@CurrentAuth() auth: AccessTokenClaims, @Query('unitId') unitId: string) {
    return this.accountingAccess.listCharts({ identityId: auth.sub, sessionId: auth.sid }, unitId);
  }

  @Get('charts/:chartId')
  getChart(@CurrentAuth() auth: AccessTokenClaims, @Param('chartId') chartId: string) {
    return this.accountingAccess.getChart({ identityId: auth.sub, sessionId: auth.sid }, chartId);
  }

  @Get('charts/:chartId/accounts')
  listAccounts(@CurrentAuth() auth: AccessTokenClaims, @Param('chartId') chartId: string) {
    return this.accountingAccess.listAccounts({ identityId: auth.sub, sessionId: auth.sid }, chartId);
  }

  @Patch('charts/:chartId/accounts/:accountId')
  @HttpCode(200)
  updateAccount(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('chartId') chartId: string,
    @Param('accountId') accountId: string,
    @Body() body: { name?: string | null; status?: string | null },
  ) {
    return this.accountingAccess.updateAccount(
      { identityId: auth.sub, sessionId: auth.sid },
      chartId,
      accountId,
      { name: body?.name, status: body?.status },
    );
  }

  @Get('charts/:chartId/periods')
  listPeriods(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('chartId') chartId: string,
    @Query('status') status?: string,
  ) {
    return this.accountingAccess.listPeriods(
      { identityId: auth.sub, sessionId: auth.sid },
      chartId,
      status,
    );
  }

  @Get('charts/:chartId/journals')
  listJournals(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('chartId') chartId: string,
    @Query('periodId') periodId?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('occurredFrom') occurredFrom?: string,
    @Query('occurredTo') occurredTo?: string,
    @Query('sourceKind') sourceKind?: string,
    @Query('accountId') accountId?: string,
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '30',
  ) {
    return this.accountingAccess.listJournals(
      { identityId: auth.sub, sessionId: auth.sid },
      chartId,
      { periodId, status, kind, occurredFrom, occurredTo, sourceKind, accountId, page, pageSize },
    );
  }

  @Get('periods/:periodId/ledger')
  accountLedger(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Query('accountId') accountId: string,
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '30',
  ) {
    return this.accountingAccess.accountLedger(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      accountId,
      page,
      pageSize,
    );
  }

  @Get('periods/:periodId/close-runs')
  listPeriodCloseRuns(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
  ) {
    return this.accountingAccess.listPeriodCloseRuns(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }

  @Post('charts/:chartId/accounts')
  @HttpCode(200)
  createAccount(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('chartId') chartId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.createAccount(
      { identityId: auth.sub, sessionId: auth.sid },
      chartId,
      validateCreateAccountInput(body),
    );
  }

  @Post('periods')
  @HttpCode(200)
  createPeriod(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.accountingAccess.createPeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreatePeriodInput(body),
    );
  }

  @Post('periods/:periodId/close')
  @HttpCode(200)
  closePeriod(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.closePeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      validateClosePeriodInput(body),
    );
  }

  @Post('periods/:periodId/reopen')
  @HttpCode(200)
  reopenPeriod(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.reopenPeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      validateReopenPeriodInput(body),
    );
  }

  @Post('journals')
  @HttpCode(200)
  createDraft(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.accountingAccess.createDraft(
      { identityId: auth.sub, sessionId: auth.sid },
      validateDraftJournalInput(body),
    );
  }

  @Put('journals/:journalId')
  replaceLines(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('journalId') journalId: string,
    @Body() body: { rowVersion: number; lines: never },
  ) {
    return this.accountingAccess.replaceLines(
      { identityId: auth.sub, sessionId: auth.sid },
      journalId,
      body,
    );
  }

  @Get('journals/:journalId')
  getJournal(@CurrentAuth() auth: AccessTokenClaims, @Param('journalId') journalId: string) {
    return this.accountingAccess.getJournal({ identityId: auth.sub, sessionId: auth.sid }, journalId);
  }

  @Post('journals/:journalId/post')
  @HttpCode(200)
  post(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('journalId') journalId: string,
    @Body() body: { rowVersion: number },
  ) {
    return this.accountingAccess.post({ identityId: auth.sub, sessionId: auth.sid }, journalId, body);
  }

  @Post('journals/:journalId/reverse')
  @HttpCode(200)
  reverse(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('journalId') journalId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.reverse(
      { identityId: auth.sub, sessionId: auth.sid },
      journalId,
      validateReverseJournalInput(body),
    );
  }

  @Post('posting-rules')
  @HttpCode(200)
  createPostingRule(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.accountingAccess.createPostingRule(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreatePostingRuleInput(body),
    );
  }

  @Post('posting-rules/:ruleId/versions')
  @HttpCode(200)
  createPostingRuleVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('ruleId') ruleId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.createPostingRuleVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      ruleId,
      validateCreatePostingRuleVersionInput(body),
    );
  }

  @Post('posting-rule-versions/:versionId/publish')
  @HttpCode(200)
  publishPostingRuleVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('versionId') versionId: string,
    @Body() body: never,
  ) {
    return this.accountingAccess.publishPostingRuleVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      versionId,
      validatePublishPostingRuleVersionInput(body),
    );
  }

  @Post('posting-requests')
  @HttpCode(200)
  requestPosting(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.accountingAccess.requestPosting(
      { identityId: auth.sub, sessionId: auth.sid },
      body,
    );
  }

  @Get('posting-requests')
  listPostingRequests(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('unitId') unitId: string,
    @Query('status') status?: string,
    @Query('originKind') originKind?: string,
    @Query('eventKind') eventKind?: string,
    @Query('occurredFrom') occurredFrom?: string,
    @Query('occurredTo') occurredTo?: string,
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '30',
  ) {
    return this.accountingAccess.listPostingRequests(
      { identityId: auth.sub, sessionId: auth.sid },
      { unitId, status, originKind, eventKind, occurredFrom, occurredTo, page, pageSize },
    );
  }

  @Get('ledger')
  reconstruct(@CurrentAuth() auth: AccessTokenClaims, @Query('chartId') chartId: string) {
    return this.accountingAccess.reconstructLedger(
      { identityId: auth.sub, sessionId: auth.sid },
      chartId,
    );
  }

  @Get('periods/:periodId/journal')
  journalBook(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.accountingReporting.journalBook(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }

  @Get('periods/:periodId/general-ledger')
  generalLedger(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.accountingReporting.generalLedger(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }

  @Get('periods/:periodId/trial-balance')
  trialBalance(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.accountingReporting.trialBalance(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }

  @Get('periods/:periodId/income-statement')
  incomeStatement(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.accountingReporting.incomeStatement(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }

  @Get('periods/:periodId/balance-sheet')
  balanceSheet(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.accountingReporting.balanceSheet(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
    );
  }
}

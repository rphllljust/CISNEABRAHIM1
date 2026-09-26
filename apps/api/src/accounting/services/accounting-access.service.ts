import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import type {
  AccountingConfirmedEventInput,
  AccountingLedgerPort,
  AccountingReverseConfirmedEventInput,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  AccountingError,
  JOURNAL_DIRECTIONS,
  assertBalancedEntry,
  assertSourceKind,
  debitTotal,
} from '../domain/ledger';
import { assertAccountPostable, normalBalanceForClass } from '../domain/accounting-semantics';
import {
  compareMoneyAmounts,
  subtractMoneyAmounts,
  sumMoneyAmounts,
} from '../../platform/kernel/money-math';
import {
  POSTING_REQUEST_STATUSES,
  POSTING_VERSION_STATUSES,
  assertPostingEvent,
  assertPostingOrigin,
  assertPostingRuleConfigured,
  assertRequiredPostingContext,
  journalSourceKindForEvent,
  originForEvent,
  originalEventKindForReversal,
  postingIdempotencyKey,
} from '../domain/posting';
import {
  validateConfirmedEconomicEventInput,
  validateCreatePostingRuleInput,
  validateCreatePostingRuleVersionInput,
  validatePublishPostingRuleVersionInput,
  type ConfirmedEconomicEventInput,
  type CreatePostingRuleInput,
  type CreatePostingRuleVersionInput,
} from '../domain/posting.validation';
import { AccountingPostingRepository } from '../repositories/accounting-posting.repository';
import {
  AccountingValidationError,
  requireNonEmptyText,
  optionalPeriodStatus,
  requirePage,
  requirePageSize,
  validateClosePeriodInput,
  validateJournalListQuery,
  validatePostingRequestListQuery,
  validateReopenPeriodInput,
  validateCreateAccountInput,
  validateCreateChartInput,
  validateCreatePeriodInput,
  validateDraftJournalInput,
  validateReverseJournalInput,
  type CreateAccountInput,
  type CreateChartInput,
  type CreatePeriodInput,
  type DraftJournalInput,
  type JournalListQuery,
  type PostingRequestListQuery,
  type ReverseJournalInput,
} from '../domain/ledger.validation';
import { AccountingRepository } from '../repositories/accounting.repository';
import {
  toAccountResponse,
  toChartResponse,
  toJournalResponse,
  toLedgerReconstructionResponse,
  toPeriodResponse,
  type AccountResponse,
  type ChartResponse,
  type JournalResponse,
  type LedgerReconstructionResponse,
  type PeriodResponse,
} from '../serializers/accounting-response.serializer';
import {
  toPostingRequestResponse,
  toPostingRuleResponse,
  toPostingRuleVersionResponse,
  type PostingRequestResponse,
  type PostingRuleResponse,
  type PostingRuleVersionResponse,
} from '../serializers/accounting-posting-response.serializer';
import {
  toPostingRequestPageResponse,
  type PostingRequestPageResponse,
} from '../serializers/accounting-posting-read.serializer';
import {
  toAccountLedgerResponse,
  toAccountsListResponse,
  toChartsListResponse,
  toCloseRunsResponse,
  toJournalPageResponse,
  toPeriodsListResponse,
  type AccountLedgerResponse,
  type AccountsListResponse,
  type ChartsListResponse,
  type CloseRunsResponse,
  type JournalPageResponse,
  type PeriodsListResponse,
} from '../serializers/accounting-read.serializer';
import { AccountingAccessAuthz } from './accounting-access.authz';
import { mapAccountingDomainError } from './accounting-access.errors';

@Injectable()
export class AccountingAccessService implements AccountingLedgerPort {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly postingRepository: AccountingPostingRepository,
    private readonly authz: AccountingAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
  ) {}

  async createChart(actor: IdentityAuthzContext, input: CreateChartInput): Promise<ChartResponse> {
    try {
      const validated = validateCreateChartInput(input);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingChartManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createChart({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingChartManage, row.id, {
        code: row.code,
      });
      return toChartResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async getChart(actor: IdentityAuthzContext, chartId: string): Promise<ChartResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const row = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalRead, {
        id: row.id,
        unitId: row.unit_id,
      });
      return toChartResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async createAccount(
    actor: IdentityAuthzContext,
    chartId: string,
    input: CreateAccountInput,
  ): Promise<AccountResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingChartManage, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const validated = validateCreateAccountInput(input);
      const row = await this.repository.createAccount({
        chartId,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingChartManage, row.id, {
        code: row.code,
        class: row.class,
      });
      return toAccountResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async createPeriod(actor: IdentityAuthzContext, input: CreatePeriodInput): Promise<PeriodResponse> {
    try {
      const validated = validateCreatePeriodInput(input);
      const chart = await this.requireChart(validated.chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPeriodOpen, {
        id: chart.id,
        unitId: validated.unitId,
      });
      const row = await this.repository.createPeriod({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingPeriodOpen, row.id, {
        code: row.code,
      });
      return toPeriodResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async closePeriod(
    actor: IdentityAuthzContext,
    periodId: string,
    input: { rowVersion: number; reason: string },
  ): Promise<PeriodResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const period = await this.requirePeriod(periodId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPeriodClose, {
        id: period.id,
        unitId: period.unit_id,
      });
      const validated = validateClosePeriodInput(input);
      const outcome = await this.repository.closePeriod({
        periodId,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      if (!outcome.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingPeriodClose, outcome.period.id, {
          reason: validated.reason,
          runStatus: outcome.runStatus,
          checks: outcome.checks.map((check) => ({
            kind: check.kind,
            result: check.result,
            blocking: check.blocking,
            observedCount: check.observedCount,
          })),
        });
      }
      return toPeriodResponse(outcome.period, outcome.checks);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async reopenPeriod(
    actor: IdentityAuthzContext,
    periodId: string,
    input: { rowVersion: number; reason: string },
  ): Promise<PeriodResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const period = await this.requirePeriod(periodId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPeriodReopen, {
        id: period.id,
        unitId: period.unit_id,
      });
      const scope = resolveSodScope(period.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.AccountingPeriodReopen,
        originatorIdentityId: period.closed_by_identity_id,
        ...scope,
      });
      const validated = validateReopenPeriodInput(input);
      const row = await this.repository.reopenPeriod({
        periodId,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingPeriodReopen, row.id, {
        reason: validated.reason,
      });
      return toPeriodResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async createDraft(actor: IdentityAuthzContext, input: DraftJournalInput): Promise<JournalResponse> {
    try {
      const validated = validateDraftJournalInput(input);
      const chart = await this.requireChart(validated.chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalDraft, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const aggregate = await this.repository.createDraft({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingJournalDraft, aggregate.entry.id, {
        sourceKind: aggregate.entry.source_kind,
        sourceId: aggregate.entry.source_id,
      });
      return toJournalResponse(aggregate);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async replaceLines(
    actor: IdentityAuthzContext,
    journalEntryId: string,
    input: { rowVersion: number; lines: DraftJournalInput['lines'] },
  ): Promise<JournalResponse> {
    assertUuid(journalEntryId, 'journalEntryId');
    try {
      const current = await this.requireJournal(journalEntryId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalDraft, {
        id: current.entry.id,
        unitId: current.entry.unit_id,
      });
      const validated = validateDraftJournalInput({
        chartId: current.entry.chart_id,
        periodId: current.entry.period_id,
        description: current.entry.description,
        occurredOn: current.entry.occurred_on,
        currencyCode: current.entry.currency_code,
        sourceKind: current.entry.source_kind,
        sourceId: current.entry.source_id,
        sourceReference: current.entry.source_reference,
        idempotencyKey: current.entry.idempotency_key,
        lines: input.lines,
      });
      const aggregate = await this.repository.replaceLines({
        journalEntryId,
        rowVersion: input.rowVersion,
        actorIdentityId: actor.identityId,
        lines: validated.lines,
      });
      return toJournalResponse(aggregate);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async getJournal(actor: IdentityAuthzContext, journalEntryId: string): Promise<JournalResponse> {
    assertUuid(journalEntryId, 'journalEntryId');
    try {
      const aggregate = await this.requireJournal(journalEntryId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalRead, {
        id: aggregate.entry.id,
        unitId: aggregate.entry.unit_id,
      });
      const reversal = await this.repository.findReversalOf(aggregate.entry.id);
      return toJournalResponse(aggregate, reversal);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async post(
    actor: IdentityAuthzContext,
    journalEntryId: string,
    input: { rowVersion: number },
  ): Promise<JournalResponse> {
    assertUuid(journalEntryId, 'journalEntryId');
    try {
      const current = await this.requireJournal(journalEntryId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalPost, {
        id: current.entry.id,
        unitId: current.entry.unit_id,
      });
      assertBalancedEntry(
        current.lines.map((line) => ({
          lineNumber: line.line_number,
          accountId: line.account_id,
          direction: line.direction,
          amount: line.amount,
          description: line.description,
        })),
      );
      const scope = resolveSodScope(current.entry.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.JournalPost,
        originatorIdentityId: current.entry.created_by_identity_id,
        amount: debitTotal(current.lines),
        ...scope,
      });
      const aggregate = await this.repository.post({
        journalEntryId,
        rowVersion: input.rowVersion,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingJournalPost, aggregate.entry.id, {
        sourceKind: aggregate.entry.source_kind,
        sourceId: aggregate.entry.source_id,
        idempotencyKey: aggregate.entry.idempotency_key,
      });
      return toJournalResponse(aggregate);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async reverse(
    actor: IdentityAuthzContext,
    journalEntryId: string,
    input: ReverseJournalInput,
  ): Promise<JournalResponse> {
    assertUuid(journalEntryId, 'journalEntryId');
    try {
      const current = await this.requireJournal(journalEntryId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalReverse, {
        id: current.entry.id,
        unitId: current.entry.unit_id,
      });
      const validated = validateReverseJournalInput(input);
      const aggregate = await this.repository.reverse({
        journalEntryId,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingJournalReverse, aggregate.entry.id, {
        reversesEntryId: journalEntryId,
      });
      return toJournalResponse(aggregate);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async reconstructLedger(
    actor: IdentityAuthzContext,
    chartId: string,
  ): Promise<LedgerReconstructionResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const lines = await this.repository.listPostedLines(chartId);
      return toLedgerReconstructionResponse(chartId, lines);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async postFromSource(input: {
    sourceContext: string;
    sourceId: string;
    unitId: string;
    sourceReference?: string;
    chartId?: string;
    periodId?: string;
    description?: string;
    occurredOn?: string;
    currencyCode?: string;
    idempotencyKey?: string;
    actorIdentityId?: string;
    lines?: DraftJournalInput['lines'];
  }): Promise<{ journalEntryId: string; idempotent: boolean }> {
    try {
      if (!input.chartId || !input.periodId || !input.actorIdentityId || !input.lines) {
        throw new AccountingError('ACCOUNTING_INVALID_SOURCE');
      }
      const sourceKind = assertSourceKind(input.sourceContext);
      const idempotencyKey = input.idempotencyKey ?? input.sourceId;
      const before = await this.repository.findByIdempotency({
        chartId: input.chartId,
        idempotencyKey,
        sourceKind,
        sourceId: input.sourceId,
      });
      const aggregate = await this.repository.createAndPost({
        chartId: input.chartId,
        periodId: input.periodId,
        description: input.description ?? `Source ${input.sourceContext}`,
        occurredOn: input.occurredOn ?? new Date().toISOString().slice(0, 10),
        currencyCode: input.currencyCode ?? 'BRL',
        sourceKind,
        sourceId: input.sourceId,
        sourceReference: input.sourceReference ?? input.sourceId,
        idempotencyKey,
        actorIdentityId: input.actorIdentityId,
        lines: input.lines,
      });
      return {
        journalEntryId: aggregate.entry.id,
        idempotent: Boolean(before && before.entry.status === 'POSTED'),
      };
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async createPostingRule(
    actor: IdentityAuthzContext,
    input: CreatePostingRuleInput,
  ): Promise<PostingRuleResponse> {
    try {
      const validated = validateCreatePostingRuleInput(input);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPostingRuleManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.postingRepository.createRule({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingPostingRuleManage, row.id, {
        originKind: row.origin_kind,
        eventKind: row.event_kind,
      });
      return toPostingRuleResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async createPostingRuleVersion(
    actor: IdentityAuthzContext,
    postingRuleId: string,
    input: CreatePostingRuleVersionInput,
  ): Promise<PostingRuleVersionResponse> {
    try {
      assertUuid(postingRuleId);
      const rule = await this.postingRepository.findRuleById(postingRuleId);
      if (!rule) {
        throw new AccountingError('ACCOUNTING_NOT_FOUND');
      }
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPostingRuleManage, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const debit = await this.repository.findAccountById(input.debitAccountId);
      const credit = await this.repository.findAccountById(input.creditAccountId);
      if (!debit || !credit) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
      }
      if (debit.chart_id !== credit.chart_id) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_CHART_MISMATCH');
      }
      const debitPostability = await this.repository.findAccountPostability(debit.id);
      const creditPostability = await this.repository.findAccountPostability(credit.id);
      assertAccountPostable({
        status: debitPostability.account?.status ?? '',
        hasChildren: debitPostability.hasChildren,
      });
      assertAccountPostable({
        status: creditPostability.account?.status ?? '',
        hasChildren: creditPostability.hasChildren,
      });
      const validated = validateCreatePostingRuleVersionInput(input);
      const version = await this.postingRepository.createDraftVersion({
        postingRuleId,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return toPostingRuleVersionResponse(version);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async publishPostingRuleVersion(
    actor: IdentityAuthzContext,
    versionId: string,
    input: { rowVersion: number },
  ): Promise<PostingRuleVersionResponse> {
    try {
      assertUuid(versionId);
      const current = await this.postingRepository.findVersionById(versionId);
      if (!current) {
        throw new AccountingError('ACCOUNTING_NOT_FOUND');
      }
      const rule = await this.postingRepository.findRuleById(current.posting_rule_id);
      if (!rule) {
        throw new AccountingError('ACCOUNTING_NOT_FOUND');
      }
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPostingRulePublish, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const validated = validatePublishPostingRuleVersionInput(input);
      if (current.status !== POSTING_VERSION_STATUSES.Published) {
        const debitPostability = await this.repository.findAccountPostability(
          current.debit_account_id,
        );
        const creditPostability = await this.repository.findAccountPostability(
          current.credit_account_id,
        );
        assertAccountPostable({
          status: debitPostability.account?.status ?? '',
          hasChildren: debitPostability.hasChildren,
        });
        assertAccountPostable({
          status: creditPostability.account?.status ?? '',
          hasChildren: creditPostability.hasChildren,
        });
      }
      const published = await this.postingRepository.publishVersion(
        versionId,
        validated.rowVersion,
        actor.identityId,
      );
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingPostingRulePublish, published.id, {
        postingRuleId: rule.id,
        versionNumber: published.version_number,
      });
      return toPostingRuleVersionResponse(published);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async requestPosting(
    actor: IdentityAuthzContext,
    input: Omit<ConfirmedEconomicEventInput, 'actorIdentityId'>,
  ): Promise<PostingRequestResponse> {
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPostingRequest, {
      id: actor.identityId,
      unitId: input.unitId,
    });
    const posted = await this.postConfirmedEvent({
      ...input,
      actorIdentityId: actor.identityId,
    });
    const request = await this.postingRepository.findRequestByEvent(
      input.originKind,
      input.eventKind,
      input.sourceId,
    );
    if (!request) {
      throw mapAccountingDomainError(new AccountingError('ACCOUNTING_NOT_FOUND'));
    }
    return toPostingRequestResponse(request, posted.idempotent);
  }

  async postConfirmedEvent(input: AccountingConfirmedEventInput): Promise<{
    journalEntryId: string;
    postingRequestId: string;
    idempotent: boolean;
  }> {
    try {
      const validated = validateConfirmedEconomicEventInput(input);
      const configured = await this.postingRepository.findPublishedVersionForEvent({
        unitId: validated.unitId,
        originKind: validated.originKind,
        eventKind: validated.eventKind,
        effectiveOn: validated.occurredOn,
      });
      assertPostingRuleConfigured(Boolean(configured));
      const rule = configured!.rule;
      const version = configured!.version;
      const context = {
        amount: validated.amount,
        occurredOn: validated.occurredOn,
        currencyCode: validated.currencyCode,
        ...(validated.context ?? {}),
      };
      assertRequiredPostingContext(version.required_context, context);
      const debit = await this.repository.findAccountById(version.debit_account_id);
      const credit = await this.repository.findAccountById(version.credit_account_id);
      if (!debit || !credit) {
        throw new AccountingError('ACCOUNTING_RULE_NOT_CONFIGURED');
      }
      if (debit.chart_id !== credit.chart_id) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_CHART_MISMATCH');
      }
      const period = await this.repository.findOpenPeriodContaining(debit.chart_id, validated.occurredOn);
      if (!period) {
        throw new AccountingError('ACCOUNTING_PERIOD_NOT_FOUND');
      }
      const idempotencyKey = postingIdempotencyKey(validated);
      const sourceKind = journalSourceKindForEvent(validated.eventKind);
      const posted = await this.postingRepository.postConfirmedEvent({
        request: {
          unitId: validated.unitId,
          originKind: validated.originKind,
          eventKind: validated.eventKind,
          sourceId: validated.sourceId,
          sourceReference: validated.sourceReference ?? validated.sourceId,
          idempotencyKey,
          postingRuleId: rule.id,
          postingRuleVersionId: version.id,
          journalEntryId: '',
          amount: validated.amount,
          currencyCode: validated.currencyCode,
          occurredOn: validated.occurredOn,
          context,
          actorIdentityId: validated.actorIdentityId,
        },
        journal: {
          chartId: debit.chart_id,
          periodId: period.id,
          description: `Posting ${validated.eventKind}`,
          occurredOn: validated.occurredOn,
          currencyCode: validated.currencyCode,
          sourceKind,
          sourceId: validated.sourceId,
          sourceReference: validated.sourceReference ?? validated.sourceId,
          idempotencyKey,
          actorIdentityId: validated.actorIdentityId,
          lines: [
            {
              lineNumber: 1,
              accountId: version.debit_account_id,
              direction: JOURNAL_DIRECTIONS.Debit,
              amount: validated.amount,
            },
            {
              lineNumber: 2,
              accountId: version.credit_account_id,
              direction: JOURNAL_DIRECTIONS.Credit,
              amount: validated.amount,
            },
          ],
        },
      });
      return {
        journalEntryId: posted.journal.entry.id,
        postingRequestId: posted.request.id,
        idempotent: posted.idempotent,
      };
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async reverseConfirmedEvent(input: AccountingReverseConfirmedEventInput): Promise<{
    journalEntryId: string | null;
    postingRequestId: string | null;
    idempotent: boolean;
  }> {
    try {
      const originKind = assertPostingOrigin(input.originKind);
      const eventKind = assertPostingEvent(input.eventKind);
      if (originForEvent(eventKind) !== originKind) {
        throw new AccountingError('ACCOUNTING_INVALID_SOURCE');
      }
      const sourceId = assertUuid(input.sourceId, 'sourceId');
      const actorIdentityId = assertUuid(input.actorIdentityId, 'actorIdentityId');
      const existing = await this.postingRepository.findRequestByEvent(originKind, eventKind, sourceId);
      if (existing?.status === POSTING_REQUEST_STATUSES.Posted && existing.journal_entry_id) {
        return {
          journalEntryId: existing.journal_entry_id,
          postingRequestId: existing.id,
          idempotent: true,
        };
      }
      const originalEventKind = originalEventKindForReversal(eventKind);
      const original = await this.postingRepository.findRequestByEvent(
        originKind,
        originalEventKind,
        sourceId,
      );
      if (!original?.journal_entry_id) {
        return { journalEntryId: null, postingRequestId: null, idempotent: true };
      }
      const journal = await this.repository.findJournalById(original.journal_entry_id);
      if (!journal) {
        throw new AccountingError('ACCOUNTING_NOT_FOUND');
      }
      const reversal = await this.repository.reverse({
        journalEntryId: journal.entry.id,
        rowVersion: journal.entry.row_version,
        idempotencyKey:
          input.idempotencyKey?.trim() ||
          postingIdempotencyKey({ originKind, eventKind, sourceId }),
        reason: input.reason.trim(),
        actorIdentityId,
      });
      const recorded = await this.postingRepository.recordPostedRequest(
        {
          unitId: original.unit_id,
          originKind,
          eventKind,
          sourceId,
          sourceReference: original.source_reference,
          idempotencyKey: postingIdempotencyKey({ originKind, eventKind, sourceId }),
          postingRuleId: original.posting_rule_id,
          postingRuleVersionId: original.posting_rule_version_id,
          journalEntryId: reversal.entry.id,
          amount: original.amount,
          currencyCode: original.currency_code,
          occurredOn: String(original.occurred_on).slice(0, 10),
          context: { reversedJournalEntryId: original.journal_entry_id },
          actorIdentityId,
        },
        reversal.entry.id,
      );
      return {
        journalEntryId: reversal.entry.id,
        postingRequestId: recorded.id,
        idempotent: false,
      };
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async listCharts(actor: IdentityAuthzContext, unitId: string): Promise<ChartsListResponse> {
    try {
      const unit = requireNonEmptyText(unitId, 'unitId');
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: unit,
        unitId: unit,
      });
      return toChartsListResponse(unit, await this.repository.listChartsByUnit(unit));
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async listAccounts(
    actor: IdentityAuthzContext,
    chartId: string,
  ): Promise<AccountsListResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      return toAccountsListResponse(chart.id, await this.repository.listAccountsByChart(chart.id));
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async listPeriods(
    actor: IdentityAuthzContext,
    chartId: string,
    status?: string,
  ): Promise<PeriodsListResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const periodStatus = optionalPeriodStatus(status);
      return toPeriodsListResponse(
        chart.id,
        await this.repository.listPeriodsByChart(chart.id, periodStatus),
      );
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async listJournals(
    actor: IdentityAuthzContext,
    chartId: string,
    query: Omit<JournalListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
  ): Promise<JournalPageResponse> {
    assertUuid(chartId, 'chartId');
    try {
      const validated = validateJournalListQuery(query);
      if (validated.periodId !== undefined) {
        assertUuid(validated.periodId, 'periodId');
      }
      if (validated.accountId !== undefined) {
        assertUuid(validated.accountId, 'accountId');
      }
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const result = await this.repository.listJournalPage({
        chartId: chart.id,
        periodId: validated.periodId,
        status: validated.status,
        kind: validated.kind,
        occurredFrom: validated.occurredFrom,
        occurredTo: validated.occurredTo,
        sourceKind: validated.sourceKind,
        accountId: validated.accountId,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      return toJournalPageResponse({
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        items: result.items,
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  /**
   * Rastreabilidade evento -> lancamento ("origem dos lancamentos"). Consulta pura sobre
   * acc.accounting_posting_requests: mostra qual evento de negocio gerou qual lancamento
   * contabil, com o numero do lancamento. Autorizacao por escopo de unidade
   * (accounting:journal:list), o mesmo criterio da lista de lancamentos.
   */
  async listPostingRequests(
    actor: IdentityAuthzContext,
    query: Omit<PostingRequestListQuery, 'page' | 'pageSize'> & {
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<PostingRequestPageResponse> {
    try {
      const validated = validatePostingRequestListQuery(query);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.postingRepository.listRequestPage({
        unitId: validated.unitId,
        status: validated.status,
        originKind: validated.originKind,
        eventKind: validated.eventKind,
        occurredFrom: validated.occurredFrom,
        occurredTo: validated.occurredTo,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      const statusCounts = await this.postingRepository.countRequestStatuses(validated.unitId);
      return toPostingRequestPageResponse({
        unitId: validated.unitId,
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        statusCounts,
        items: result.items,
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async accountLedger(
    actor: IdentityAuthzContext,
    periodId: string,
    accountId: string,
    page: unknown,
    pageSize: unknown,
  ): Promise<AccountLedgerResponse> {
    assertUuid(periodId, 'periodId');
    assertUuid(accountId, 'accountId');
    try {
      const pageNumber = requirePage(page, 'page');
      const pageSizeNumber = requirePageSize(pageSize, 'pageSize');
      const period = await this.requirePeriod(periodId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: period.id,
        unitId: period.unit_id,
      });
      const account = await this.repository.findAccountById(accountId);
      if (!account || account.chart_id !== period.chart_id) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
      }
      const openingFacts = await this.repository.listPostedLineFacts({
        chartId: period.chart_id,
        beforeOn: period.starts_on.slice(0, 10),
      });
      const periodFacts = await this.repository.listPostedLineFacts({
        chartId: period.chart_id,
        periodId: period.id,
      });
      const opening = sumSidesForAccount(openingFacts, accountId);
      const movement = sumSidesForAccount(periodFacts, accountId);
      const closingDebits = sumMoneyAmounts([opening.debits, movement.debits]);
      const closingCredits = sumMoneyAmounts([opening.credits, movement.credits]);
      const all = await this.repository.listAllLedgerMovements(period.id, accountId);
      let runningDebits = opening.debits;
      let runningCredits = opening.credits;
      const enriched = all.map((row) => {
        if (row.direction === JOURNAL_DIRECTIONS.Debit) {
          runningDebits = sumMoneyAmounts([runningDebits, row.amount]);
        } else {
          runningCredits = sumMoneyAmounts([runningCredits, row.amount]);
        }
        return { ...row, runningBalance: sideBalance(runningDebits, runningCredits) };
      });
      const slice = enriched.slice(pageNumber * pageSizeNumber, (pageNumber + 1) * pageSizeNumber);
      return toAccountLedgerResponse({
        periodId: period.id,
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          class: account.class,
          status: account.status,
          normalBalance: normalBalanceForClass(account.class),
        },
        openingBalance: sideBalance(opening.debits, opening.credits),
        periodDebits: movement.debits,
        periodCredits: movement.credits,
        closingBalance: sideBalance(closingDebits, closingCredits),
        page: pageNumber,
        pageSize: pageSizeNumber,
        total: enriched.length,
        totalPages: Math.ceil(enriched.length / pageSizeNumber),
        movements: slice,
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async listPeriodCloseRuns(
    actor: IdentityAuthzContext,
    periodId: string,
  ): Promise<CloseRunsResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const period = await this.requirePeriod(periodId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: period.id,
        unitId: period.unit_id,
      });
      const { runs } = await this.repository.listPeriodCloseRuns(period.id);
      return toCloseRunsResponse(period.id, runs);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async updateAccount(
    actor: IdentityAuthzContext,
    chartId: string,
    accountId: string,
    input: { name?: string | null; status?: string | null },
  ): Promise<AccountResponse> {
    assertUuid(chartId, 'chartId');
    assertUuid(accountId, 'accountId');
    try {
      const chart = await this.requireChart(chartId);
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingChartManage, {
        id: chart.id,
        unitId: chart.unit_id,
      });
      const current = await this.repository.findAccountById(accountId);
      if (!current || current.chart_id !== chart.id) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
      }
      const name = input.name === undefined || input.name === null
        ? undefined
        : requireNonEmptyText(input.name, 'name');
      let status: string | undefined;
      if (input.status !== undefined && input.status !== null) {
        const normalized = input.status.trim().toUpperCase();
        if (normalized !== 'ACTIVE' && normalized !== 'INACTIVE') {
          throw new AccountingValidationError('status');
        }
        status = normalized;
      }
      const row = await this.repository.updateAccount({
        accountId,
        name,
        status,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingChartManage, row.id, {
        chartId: chart.id,
        accountId: row.id,
        code: row.code,
        previous: {
          name: current.name,
          status: current.status,
        },
        current: {
          name: row.name,
          status: row.status,
        },
      });
      return toAccountResponse(row);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  private async requireChart(chartId: string) {
    const row = await this.repository.findChartById(chartId);
    if (!row) {
      throw new AccountingError('ACCOUNTING_CHART_NOT_FOUND');
    }
    return row;
  }

  private async requirePeriod(periodId: string) {
    const row = await this.repository.findPeriodById(periodId);
    if (!row) {
      throw new AccountingError('ACCOUNTING_PERIOD_NOT_FOUND');
    }
    return row;
  }

  private async requireJournal(journalEntryId: string) {
    const row = await this.repository.findJournalById(journalEntryId);
    if (!row) {
      throw new AccountingError('ACCOUNTING_NOT_FOUND');
    }
    return row;
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccountingLedger,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }
}

type AccountSideFact = { account_id: string; direction: string; amount: string };

function sumSidesForAccount(facts: AccountSideFact[], accountId: string): {
  debits: string;
  credits: string;
} {
  let debits = '0.0000';
  let credits = '0.0000';
  for (const fact of facts) {
    if (fact.account_id !== accountId) {
      continue;
    }
    if (fact.direction === JOURNAL_DIRECTIONS.Debit) {
      debits = sumMoneyAmounts([debits, fact.amount]);
    } else {
      credits = sumMoneyAmounts([credits, fact.amount]);
    }
  }
  return { debits, credits };
}

function sideBalance(debits: string, credits: string): { side: 'DEBIT' | 'CREDIT'; amount: string } {
  const comparison = compareMoneyAmounts(debits, credits);
  if (comparison > 0) {
    return { side: 'DEBIT', amount: subtractMoneyAmounts(debits, credits) };
  }
  if (comparison < 0) {
    return { side: 'CREDIT', amount: subtractMoneyAmounts(credits, debits) };
  }
  return { side: 'DEBIT', amount: '0.0000' };
}

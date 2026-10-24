import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  ENTERPRISE_CORE_PORT,
  type AccountingLedgerPort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import {
  POSTING_FAILURE_INJECTION,
  POSTING_FAILURE_STAGES,
  PostingFailureInjection,
} from '../../platform/kernel/posting-failure-injection';
import { FISCAL_STATUSES, FiscalError } from '../domain/fiscal-document';
import {
  FISCAL_ACCOUNTING_EVENTS,
  FISCAL_ACCOUNTING_ORIGIN,
  fiscalDocumentPostingAmount,
  taxCalculationPostingAmount,
} from '../domain/fiscal-accounting';
import { FiscalRepository } from '../repositories/fiscal.repository';
import { TaxEngineRepository } from '../repositories/tax-engine.repository';
import { FiscalAccessAuthz } from './fiscal-access.authz';
import { TaxEngineAccessAuthz } from './tax-engine-access.authz';

@Injectable()
export class FiscalAccountingIntegrationService {
  constructor(
    private readonly fiscalRepository: FiscalRepository,
    private readonly taxRepository: TaxEngineRepository,
    private readonly fiscalAuthz: FiscalAccessAuthz,
    private readonly taxAuthz: TaxEngineAccessAuthz,
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.AccountingLedger)
    private readonly accounting?: AccountingLedgerPort,
    @Optional()
    @Inject(POSTING_FAILURE_INJECTION)
    private readonly failures?: PostingFailureInjection,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.accounting);
  }

  async postAuthorizedDocument(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
  ): Promise<{ journalEntryId: string; postingRequestId: string; idempotent: boolean }> {
    const aggregate = await this.requireFiscalDocument(fiscalDocumentId);
    await this.fiscalAuthz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentSubmit, {
      id: aggregate.document.id,
      unitId: aggregate.document.unit_id,
    });
    if (aggregate.document.status !== FISCAL_STATUSES.Authorized) {
      throw new FiscalError('FISCAL_INVALID_TRANSITION');
    }
    this.failures?.consume(POSTING_FAILURE_STAGES.AfterFiscalEvent);
    const accounting = this.requireAccounting();
    this.failures?.consume(POSTING_FAILURE_STAGES.BeforeJournal);
    return accounting.postConfirmedEvent({
      originKind: FISCAL_ACCOUNTING_ORIGIN,
      eventKind: FISCAL_ACCOUNTING_EVENTS.Authorized,
      sourceId: aggregate.document.id,
      unitId: aggregate.document.unit_id,
      amount: fiscalDocumentPostingAmount(
        aggregate.items.map((item) => ({ lineAmount: item.line_amount })),
      ),
      currencyCode: aggregate.document.currency_code,
      occurredOn: aggregate.document.issued_on.slice(0, 10),
      sourceReference: aggregate.document.idempotency_key,
      actorIdentityId: actor.identityId,
    });
  }

  async reverseCancelledDocument(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    reason: string,
  ): Promise<{ journalEntryId: string | null; postingRequestId: string | null; idempotent: boolean }> {
    const aggregate = await this.requireFiscalDocument(fiscalDocumentId);
    await this.fiscalAuthz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentCancel, {
      id: aggregate.document.id,
      unitId: aggregate.document.unit_id,
    });
    if (aggregate.document.status !== FISCAL_STATUSES.Cancelled) {
      throw new FiscalError('FISCAL_INVALID_TRANSITION');
    }
    this.failures?.consume(POSTING_FAILURE_STAGES.AfterFiscalEvent);
    const accounting = this.requireAccounting();
    this.failures?.consume(POSTING_FAILURE_STAGES.BeforeJournal);
    return accounting.reverseConfirmedEvent({
      originKind: FISCAL_ACCOUNTING_ORIGIN,
      eventKind: FISCAL_ACCOUNTING_EVENTS.Cancelled,
      sourceId: aggregate.document.id,
      unitId: aggregate.document.unit_id,
      actorIdentityId: actor.identityId,
      reason,
    });
  }

  async postConfirmedTaxCalculation(
    actor: IdentityAuthzContext,
    calculationId: string,
  ): Promise<{ journalEntryId: string; postingRequestId: string; idempotent: boolean }> {
    const aggregate = await this.taxRepository.findCalculationById(calculationId);
    if (!aggregate) {
      throw new FiscalError('TAX_CALCULATION_NOT_FOUND');
    }
    await this.taxAuthz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxCalculate, {
      id: aggregate.calculation.id,
      unitId: aggregate.calculation.unit_id,
    });
    this.failures?.consume(POSTING_FAILURE_STAGES.AfterFiscalEvent);
    const accounting = this.requireAccounting();
    this.failures?.consume(POSTING_FAILURE_STAGES.BeforeJournal);
    return accounting.postConfirmedEvent({
      originKind: FISCAL_ACCOUNTING_ORIGIN,
      eventKind: FISCAL_ACCOUNTING_EVENTS.TaxConfirmed,
      sourceId: aggregate.calculation.id,
      unitId: aggregate.calculation.unit_id,
      amount: taxCalculationPostingAmount(aggregate.calculation.result_amount),
      currencyCode: aggregate.context.currency_code,
      occurredOn: aggregate.context.effective_on.slice(0, 10),
      sourceReference: aggregate.calculation.idempotency_key,
      actorIdentityId: actor.identityId,
    });
  }

  /**
   * F1.1 — REMOVIDOS: `tryPostAuthorizedDocument`, `tryReverseCancelledDocument`,
   * `tryPostConfirmedTaxCalculation`.
   *
   * Os três eram `catch { return; }` sobre uma operação contábil obrigatória: o
   * documento fiscal era autorizado e o journal podia simplesmente não existir —
   * sem erro, sem retry e sem nenhum registro diagnosticável. FISCAL não sabia, o
   * operador não sabia, o fechamento não sabia.
   *
   * O caminho correto é o mesmo que FINANCE usa: o fato entra na transação do
   * comando e é publicado na outbox; o ACCOUNTING decide o posting e a falha é
   * VISÍVEL (retry com backoff ou FAILED com `last_error`). Este serviço mantém
   * apenas as operações EXPLÍCITAS, que propagam a falha a quem chamou.
   *
   * Nenhum substituto best-effort foi reintroduzido.
   */

  private requireAccounting(): AccountingLedgerPort {
    if (!this.accounting) {
      throw new FiscalError('FISCAL_GATEWAY_NOT_CONFIGURED');
    }
    return this.accounting;
  }

  private async requireFiscalDocument(fiscalDocumentId: string) {
    const row = await this.fiscalRepository.findById(fiscalDocumentId);
    if (!row) {
      throw new FiscalError('FISCAL_NOT_FOUND');
    }
    return row;
  }
}

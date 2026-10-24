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
import { PAYROLL_PERIOD_STATUSES, PayrollError } from '../domain/payroll';
import {
  PAYROLL_ACCOUNTING_CURRENCY,
  PAYROLL_ACCOUNTING_EVENTS,
  PAYROLL_ACCOUNTING_ORIGIN,
  payrollClosedPostingAmount,
  payrollCompetenceReference,
} from '../domain/payroll-accounting';
import { PayrollRepository } from '../repositories/payroll.repository';
import { PayrollAccessAuthz } from './payroll-access.authz';

@Injectable()
export class PayrollAccountingIntegrationService {
  constructor(
    private readonly repository: PayrollRepository,
    private readonly authz: PayrollAccessAuthz,
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

  async postClosedPeriod(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
  ): Promise<{ journalEntryId: string; postingRequestId: string; idempotent: boolean }> {
    const period = await this.requirePeriod(payrollPeriodId);
    await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollPeriodClose, {
      id: period.id,
      unitId: period.unit_id,
    });
    if (period.status !== PAYROLL_PERIOD_STATUSES.Closed) {
      throw new PayrollError('PAYROLL_PERIOD_NOT_CLOSED');
    }
    const results = await this.repository.listLatestResults(period.id);
    this.failures?.consume(POSTING_FAILURE_STAGES.AfterPayrollEvent);
    const accounting = this.requireAccounting();
    this.failures?.consume(POSTING_FAILURE_STAGES.BeforeJournal);
    return accounting.postConfirmedEvent({
      originKind: PAYROLL_ACCOUNTING_ORIGIN,
      eventKind: PAYROLL_ACCOUNTING_EVENTS.Closed,
      sourceId: period.id,
      unitId: period.unit_id,
      amount: payrollClosedPostingAmount(
        results.map((result) => ({
          earningTotal: result.earning_total,
          employerChargeTotal: result.employer_charge_total,
        })),
      ),
      currencyCode: PAYROLL_ACCOUNTING_CURRENCY,
      occurredOn: period.ends_on.slice(0, 10),
      sourceReference: payrollCompetenceReference({
        unitId: period.unit_id,
        competenceYear: Number(period.competence_year),
        competenceMonth: Number(period.competence_month),
      }),
      actorIdentityId: actor.identityId,
      context: {
        competenceYear: Number(period.competence_year),
        competenceMonth: Number(period.competence_month),
      },
    });
  }

  async reverseReopenedPeriod(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    reason: string,
  ): Promise<{ journalEntryId: string | null; postingRequestId: string | null; idempotent: boolean }> {
    const period = await this.requirePeriod(payrollPeriodId);
    await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollPeriodReopen, {
      id: period.id,
      unitId: period.unit_id,
    });
    this.failures?.consume(POSTING_FAILURE_STAGES.AfterPayrollEvent);
    const accounting = this.requireAccounting();
    this.failures?.consume(POSTING_FAILURE_STAGES.BeforeJournal);
    return accounting.reverseConfirmedEvent({
      originKind: PAYROLL_ACCOUNTING_ORIGIN,
      eventKind: PAYROLL_ACCOUNTING_EVENTS.Reopened,
      sourceId: period.id,
      unitId: period.unit_id,
      actorIdentityId: actor.identityId,
      reason,
    });
  }

  /**
   * F1.1 — REMOVIDOS: `tryPostClosedPeriod` / `tryReverseReopenedPeriod`.
   *
   * Eram `catch { return; }` sobre posting contábil obrigatório de fechamento de
   * folha: a competência fechava e o journal podia não existir, em silêncio.
   *
   * O chamador passa a usar `postClosedPeriod` / `reverseReopenedPeriod`, que
   * PROPAGAM a falha. Nenhum substituto best-effort foi reintroduzido.
   */

  private requireAccounting(): AccountingLedgerPort {
    if (!this.accounting) {
      throw new PayrollError('PAYROLL_NOT_FOUND');
    }
    return this.accounting;
  }

  private async requirePeriod(payrollPeriodId: string) {
    const row = await this.repository.findPeriodById(payrollPeriodId);
    if (!row) {
      throw new PayrollError('PAYROLL_NOT_FOUND');
    }
    return row;
  }
}

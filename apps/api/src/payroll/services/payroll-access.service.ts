import { HttpStatus, Injectable } from '@nestjs/common';
import { AUTHZ_ERROR_CODES } from '../../authorization/errors/authz-error-codes';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
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
import type { PayrollContractPort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { EconomicEventLedgerRepository } from '../../platform/outbox/repositories/economic-event-ledger.repository';
import {
  ECONOMIC_EVENT_KINDS,
  ECONOMIC_EVENT_SOURCE_KINDS,
} from '../../platform/bounded-contexts/economic-event-contract';
import {
  PAYROLL_ACCOUNTING_CURRENCY,
  payrollClosedPostingAmount,
  payrollCompetenceReference,
} from '../domain/payroll-accounting';
import {
  PAYROLL_PERIOD_STATUSES,
  PayrollError,
  assertFormulaUndecided,
  assertPeriodAcceptsEvents,
  assertPeriodCanCalculate,
  assertPeriodCanClose,
  assertPeriodCanReopen,
  calculateFromRegisteredEvents,
} from '../domain/payroll';
import {
  validateCreateEmploymentContractInput,
  validateEmploymentContractListQuery,
  validateOpenPayrollPeriodInput,
  validatePayrollPeriodListQuery,
  validateRecordPayrollEventInput,
  type CreateEmploymentContractInput,
  type EmploymentContractListQuery,
  type OpenPayrollPeriodInput,
  type PayrollPeriodListQuery,
  type RecordPayrollEventInput,
} from '../domain/payroll.validation';
import { PayrollRepository } from '../repositories/payroll.repository';
import type { PayrollEventRow, PayrollPeriodRow } from '../repositories/payroll.repository.types';
import {
  toEmploymentContractListResponse,
  toEmploymentContractResponse,
  toPayrollEventResponse,
  toPayrollPeriodListResponse,
  toPayrollPeriodResponse,
  toPayrollResultResponse,
  type EmploymentContractListResponse,
  type EmploymentContractResponse,
  type PayrollCalculationResponse,
  type PayrollEventResponse,
  type PayrollPeriodListResponse,
  type PayrollPeriodResponse,
  type PayrollResultResponse,
} from '../serializers/payroll-response.serializer';
import { PayrollAccessAuthz } from './payroll-access.authz';
import { mapPayrollDomainError } from './payroll-access.errors';
import { PayrollAccountingIntegrationService } from './payroll-accounting-integration.service';

@Injectable()
export class PayrollAccessService implements PayrollContractPort {
  constructor(
    private readonly repository: PayrollRepository,
    private readonly authz: PayrollAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly accountingIntegration: PayrollAccountingIntegrationService,
    private readonly sod: SodEnforcementService,
    /** F1.2 — publica o fato econômico do fechamento na transação que o fecha. */
    private readonly economicEvents: EconomicEventLedgerRepository,
  ) {}

  async createContract(
    actor: IdentityAuthzContext,
    input: CreateEmploymentContractInput,
  ): Promise<EmploymentContractResponse> {
    try {
      const validated = validateCreateEmploymentContractInput(input);
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollContractManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createContract({
        ...validated,
        endsOn: validated.endsOn ?? null,
        personRef: validated.personRef ?? null,
        actorIdentityId: actor.identityId,
      });
      return toEmploymentContractResponse(row);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async openPeriod(
    actor: IdentityAuthzContext,
    input: OpenPayrollPeriodInput,
  ): Promise<PayrollPeriodResponse> {
    try {
      const validated = validateOpenPayrollPeriodInput(input);
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollPeriodOpen, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.openPeriod({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return toPayrollPeriodResponse(row);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async recordEvent(
    actor: IdentityAuthzContext,
    input: RecordPayrollEventInput,
  ): Promise<PayrollEventResponse> {
    try {
      const validated = validateRecordPayrollEventInput(input);
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollEventRecord, {
        id: validated.employmentContractId,
        unitId: validated.unitId,
      });
      const existing = await this.repository.findEventByIdempotency(
        validated.payrollPeriodId,
        validated.idempotencyKey,
      );
      if (existing) {
        return toPayrollEventResponse(existing, true);
      }
      const contract = await this.repository.findContractById(validated.employmentContractId);
      if (!contract || contract.unit_id !== validated.unitId) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      const recorded = await this.repository.withLockedPeriod(
        validated.payrollPeriodId,
        async (client, period) => {
          this.assertPeriodUnit(period, validated.unitId);
          assertPeriodAcceptsEvents(period.status);
          return this.repository.insertEvent(client, {
            ...validated,
            sourceKind: validated.sourceKind ?? null,
            sourceId: validated.sourceId ?? null,
            actorIdentityId: actor.identityId,
          });
        },
      );
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PayrollEventRecord,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PayrollLedger,
        resourceId: recorded.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { payrollPeriodId: recorded.payroll_period_id, eventKind: recorded.event_kind },
      });
      return toPayrollEventResponse(recorded, false);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async calculatePeriod(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    unitId: string,
  ): Promise<PayrollCalculationResponse> {
    try {
      const periodId = assertUuid(payrollPeriodId, 'payrollPeriodId');
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollCalculate, {
        id: periodId,
        unitId,
      });
      const outcome = await this.repository.withLockedPeriod(periodId, async (client, period) => {
        this.assertPeriodUnit(period, unitId);
        assertPeriodCanCalculate(period.status);
        const events = await this.repository.listEventsForPeriod(periodId);
        if (period.status === PAYROLL_PERIOD_STATUSES.Calculated) {
          return { period, idempotent: true };
        }
        const grouped = groupEventsByContract(events);
        for (const [employmentContractId, contractEvents] of grouped) {
          const totals = calculateFromRegisteredEvents(
            contractEvents.map((event) => ({
              eventKind: event.event_kind,
              amount: event.amount,
              componentLabel: event.component_label,
            })),
          );
          const calculationNumber = await this.repository.nextCalculationNumber(
            client,
            periodId,
            employmentContractId,
          );
          await this.repository.insertCalculation(client, {
            unitId: period.unit_id,
            payrollPeriodId: periodId,
            employmentContractId,
            calculationNumber,
            inputs: {
              eventIds: contractEvents.map((event) => event.id),
              amounts: contractEvents.map((event) => event.amount),
            },
            earningTotal: totals.earningTotal,
            deductionTotal: totals.deductionTotal,
            employerChargeTotal: totals.employerChargeTotal,
            netTotal: totals.netTotal,
            actorIdentityId: actor.identityId,
          });
        }
        const calculated = await this.repository.markCalculated(client, periodId, actor.identityId);
        return { period: calculated, idempotent: false };
      });
      const results = await this.repository.listLatestResults(periodId);
      assertFormulaUndecided('UNDECIDED');
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PayrollCalculate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PayrollLedger,
        resourceId: periodId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { idempotent: outcome.idempotent },
      });
      return {
        period: toPayrollPeriodResponse(outcome.period),
        results: results.map(toPayrollResultResponse),
        idempotent: outcome.idempotent,
      };
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async closePeriodAuthorized(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    unitId: string,
  ): Promise<PayrollPeriodResponse> {
    try {
      const periodId = assertUuid(payrollPeriodId, 'payrollPeriodId');
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollPeriodClose, {
        id: periodId,
        unitId,
      });
      const current = await this.repository.findPeriodById(periodId);
      if (!current || current.unit_id !== unitId) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      if (current.status !== PAYROLL_PERIOD_STATUSES.Closed) {
        assertPeriodCanClose(current.status);
      }
      const calculator = await this.repository.findLatestCalculationActor(periodId);
      if (calculator) {
        const scope = resolveSodScope(unitId);
        await this.sod.enforce(actor, {
          duty: SOD_DUTIES.PayrollClose,
          originatorIdentityId: calculator,
          ...scope,
        });
      }
      const closed = await this.closeLockedPeriod(periodId, unitId, actor.identityId);
      // F1.2 — o posting não é chamado aqui: o fato é publicado dentro da transação
      // de closeLockedPeriod e ACCOUNTING consome pela outbox.
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PayrollPeriodClose,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PayrollLedger,
        resourceId: periodId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { status: closed.status },
      });
      return toPayrollPeriodResponse(closed);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async closePeriod(_input: { payrollPeriodId: string; unitId: string }): Promise<void> {
    throw new AuthzHttpException(
      HttpStatus.FORBIDDEN,
      AUTHZ_ERROR_CODES.SOD_DUTY_CONFLICT,
      'Payroll close requires an authorized distinct checker.',
    );
  }

  async reopenPeriod(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    unitId: string,
  ): Promise<PayrollPeriodResponse> {
    try {
      const periodId = assertUuid(payrollPeriodId, 'payrollPeriodId');
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollPeriodReopen, {
        id: periodId,
        unitId,
      });
      const current = await this.repository.findPeriodById(periodId);
      if (!current || current.unit_id !== unitId) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      const scope = resolveSodScope(unitId);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.PayrollReopen,
        originatorIdentityId: current.updated_by_identity_id,
        ...scope,
      });
      const reopened = await this.repository.withLockedPeriod(periodId, async (client, period) => {
        this.assertPeriodUnit(period, unitId);
        assertPeriodCanReopen(period.status);
        const row = await this.repository.markReopened(client, periodId, actor.identityId);

        /**
         * F1.2 — O ESTORNO DA REABERTURA É FATO ECONÔMICO NA MESMA TRANSAÇÃO.
         *
         * Antes, `reverseReopenedPeriod` era chamado SÍNCRONO logo depois do commit.
         * Isso tinha os dois defeitos que a F1.2 elimina:
         *
         *  1. ACOPLAMENTO — o port contábil é `@Optional()`; sem `AccountingModule`
         *     carregado, a reabertura falhava com `Payroll Http Exception` genérica, e a
         *     competência não reabria por um motivo que nada tinha a ver com folha.
         *  2. ORDEM — o estorno rodava fora da transação. Queda do processo no intervalo
         *     deixava a competência reaberta sem estorno e sem registro diagnosticável.
         *
         * O valor é o MESMO que o fechamento publicou: soma de ganhos + encargos
         * empregador dos resultados mais recentes. É ele que a compensação precisa
         * estornar, e o contrato liga os dois fatos por `reversesSourceId`.
         */
        const results = await this.repository.listLatestResults(row.id);
        const amount = payrollClosedPostingAmount(
          results.map((result) => ({
            earningTotal: result.earning_total,
            employerChargeTotal: result.employer_charge_total,
          })),
        );
        if (amount && Number(amount) > 0) {
          await this.economicEvents.record(client, {
            unitId: row.unit_id,
            eventKind: ECONOMIC_EVENT_KINDS.PayrollReopened,
            sourceKind: ECONOMIC_EVENT_SOURCE_KINDS.PayrollPeriod,
            sourceId: row.id,
            amount,
            currencyCode: PAYROLL_ACCOUNTING_CURRENCY,
            occurredOn: row.ends_on,
            actorIdentityId: actor.identityId,
            sourceReference: payrollCompetenceReference({
              unitId: row.unit_id,
              competenceYear: row.competence_year,
              competenceMonth: row.competence_month,
            }),
            reversesSourceId: row.id,
            context: { payrollPeriodId: row.id, reason: 'Payroll competence reopened' },
          });
        }
        return row;
      });
      // Sem posting síncrono: o fato `PAYROLL_REOPENED` já foi publicado acima e a
      // CONTROLADORIA decide a compensação pela outbox, de forma retentável e visível.
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PayrollPeriodReopen,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PayrollLedger,
        resourceId: periodId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { status: reopened.status },
      });
      return toPayrollPeriodResponse(reopened);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async listPeriods(
    actor: IdentityAuthzContext,
    query: {
      unitId?: unknown;
      status?: unknown;
      q?: unknown;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<PayrollPeriodListResponse> {
    try {
      const validated: PayrollPeriodListQuery = validatePayrollPeriodListQuery(query);
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollRead, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.repository.listPeriods(validated);
      return toPayrollPeriodListResponse({
        items: result.items,
        total: result.total,
        page: validated.page,
        pageSize: validated.pageSize,
      });
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async listContracts(
    actor: IdentityAuthzContext,
    query: {
      unitId?: unknown;
      q?: unknown;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<EmploymentContractListResponse> {
    try {
      const validated: EmploymentContractListQuery = validateEmploymentContractListQuery(query);
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollRead, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.repository.listContracts(validated);
      return toEmploymentContractListResponse({
        items: result.items,
        total: result.total,
        page: validated.page,
        pageSize: validated.pageSize,
      });
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async getPeriod(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    unitId: string,
  ): Promise<PayrollPeriodResponse> {
    try {
      const periodId = assertUuid(payrollPeriodId, 'payrollPeriodId');
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollRead, {
        id: periodId,
        unitId,
      });
      const period = await this.repository.findPeriodById(periodId);
      if (!period || period.unit_id !== unitId) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      return toPayrollPeriodResponse(period);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  async listResults(
    actor: IdentityAuthzContext,
    payrollPeriodId: string,
    unitId: string,
  ): Promise<PayrollResultResponse[]> {
    try {
      const periodId = assertUuid(payrollPeriodId, 'payrollPeriodId');
      await this.authz.assertPayrollAction(actor, AUTHZ_ACTIONS.PayrollRead, {
        id: periodId,
        unitId,
      });
      const period = await this.repository.findPeriodById(periodId);
      if (!period || period.unit_id !== unitId) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      const results = await this.repository.listLatestResults(periodId);
      return results.map(toPayrollResultResponse);
    } catch (error) {
      throw mapPayrollDomainError(error);
    }
  }

  private async closeLockedPeriod(
    payrollPeriodId: string,
    unitId: string,
    actorIdentityId?: string,
  ): Promise<PayrollPeriodRow> {
    return this.repository.withLockedPeriod(payrollPeriodId, async (client, period) => {
      this.assertPeriodUnit(period, unitId);
      if (period.status === PAYROLL_PERIOD_STATUSES.Closed) {
        return period;
      }
      assertPeriodCanClose(period.status);
      const actor = actorIdentityId ?? period.created_by_identity_id;
      const closed = await this.repository.markClosed(client, payrollPeriodId, actor);

      /**
       * F1.2 — FATO ECONÔMICO NA MESMA TRANSAÇÃO DO FECHAMENTO.
       *
       * Antes: `markClosed` commitava e o posting rodava depois, em outra transação.
       * Se o processo caísse no intervalo, a competência ficava fechada sem journal e
       * sem evento — invisível, irrecuperável pela fila.
       *
       * O valor é o MESMO que o posting usava: soma dos ganhos + encargos
       * empregador dos resultados mais recentes. Sem esse valor não há folha a
       * contabilizar, e o fato não é publicado (em vez de publicar zero).
       */
      const results = await this.repository.listLatestResults(closed.id);
      const amount = payrollClosedPostingAmount(
        results.map((result) => ({
          earningTotal: result.earning_total,
          employerChargeTotal: result.employer_charge_total,
        })),
      );
      if (amount && Number(amount) > 0) {
        await this.economicEvents.record(client, {
          unitId: closed.unit_id,
          eventKind: ECONOMIC_EVENT_KINDS.PayrollClosed,
          sourceKind: ECONOMIC_EVENT_SOURCE_KINDS.PayrollPeriod,
          sourceId: closed.id,
          amount,
          currencyCode: PAYROLL_ACCOUNTING_CURRENCY,
          occurredOn: closed.ends_on,
          actorIdentityId: actor,
          sourceReference: payrollCompetenceReference({
            unitId: closed.unit_id,
            competenceYear: Number(closed.competence_year),
            competenceMonth: Number(closed.competence_month),
          }),
          context: {
            competenceYear: Number(closed.competence_year),
            competenceMonth: Number(closed.competence_month),
          },
        });
      }

      return closed;
    });
  }

  private assertPeriodUnit(period: PayrollPeriodRow, unitId: string): void {
    if (period.unit_id !== unitId) {
      throw new PayrollError('PAYROLL_NOT_FOUND');
    }
  }
}

function groupEventsByContract(events: PayrollEventRow[]): Map<string, PayrollEventRow[]> {
  const grouped = new Map<string, PayrollEventRow[]>();
  for (const event of events) {
    const current = grouped.get(event.employment_contract_id) ?? [];
    current.push(event);
    grouped.set(event.employment_contract_id, current);
  }
  return grouped;
}

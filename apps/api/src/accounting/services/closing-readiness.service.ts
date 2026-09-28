import { Inject, Injectable, Optional } from '@nestjs/common';
import { hasPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  ENTERPRISE_CORE_PORT,
  type FiscalDocumentPort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  PERIOD_CLOSE_CHECK_KINDS,
  PERIOD_CLOSE_CHECK_RESULTS,
  type PeriodCloseCheck,
} from '../domain/period-close';
import { PERIOD_STATUSES } from '../domain/ledger';
import { requireNonEmptyText } from '../domain/ledger.validation';
import { AccountingRepository } from '../repositories/accounting.repository';
import { toPeriodResponse, type PeriodResponse } from '../serializers/accounting-response.serializer';
import { AccountingAccessAuthz } from './accounting-access.authz';
import { mapAccountingDomainError, accountingNotFound } from './accounting-access.errors';

/** Uma pendencia/exception do fechamento, sempre com o recorte que a resolve. */
export type ClosingException = {
  kind: string;
  severity: 'BLOCKING' | 'INFORMATIONAL';
  observedCount: number;
  detail: string;
  /** Nome do conjunto afetado (fiscal, accounting, ...) para o operador saber onde agir. */
  area: string;
  /** Rota real e autorizada que mostra os registros que causam a pendencia. */
  drilldown: { path: string; label: string } | null;
};

export type ClosingWithheldSection = {
  area: string;
  reason: string;
};

export type ClosingReadinessResponse = {
  unitId: string;
  period: PeriodResponse;
  /** `true` somente quando TODAS as verificacoes foram avaliadas e nenhuma bloqueia. */
  closeReady: boolean | null;
  accounting: {
    evaluated: boolean;
    periodStatus: string;
    journalCounts: Record<string, number>;
  };
  fiscal: {
    evaluated: boolean;
    unauthorized: number;
    rejected: number;
    pendingAuthorization: number;
    draft: number;
  } | null;
  blockers: ClosingException[];
  pending: ClosingException[];
  nextActions: Array<{ label: string; kind: string; enabled: boolean; reason: string | null }>;
  withheld: ClosingWithheldSection[];
};

/**
 * Mapa de cada verificacao de fechamento para a tela REAL que resolve a pendencia.
 *
 * Nao ha regra nova aqui: as verificacoes vem de `evaluatePeriodCloseChecks`, a autoridade que o
 * proprio `closePeriod` usa. O que este mapa acrescenta e apenas o endereco do conjunto afetado.
 */
const CHECK_DRILLDOWN: Record<string, { area: string; path: string; label: string } | undefined> = {
  [PERIOD_CLOSE_CHECK_KINDS.Fiscal]: {
    area: 'fiscal',
    path: '/app/fiscal/documents',
    label: 'Ver documentos fiscais',
  },
  [PERIOD_CLOSE_CHECK_KINDS.Accounting]: {
    area: 'accounting',
    path: '/app/accounting/journals',
    label: 'Ver lançamentos não postados',
  },
  [PERIOD_CLOSE_CHECK_KINDS.DebitCredit]: {
    area: 'accounting',
    path: '/app/accounting/periods',
    label: 'Ver balancete do período',
  },
  [PERIOD_CLOSE_CHECK_KINDS.PendingPosting]: {
    area: 'accounting',
    path: '/app/accounting/posting-origins',
    label: 'Ver origem dos lançamentos',
  },
  [PERIOD_CLOSE_CHECK_KINDS.BankReconciliation]: {
    area: 'finance',
    path: '/app/finance/reconciliation',
    label: 'Abrir conciliação bancária',
  },
  [PERIOD_CLOSE_CHECK_KINDS.Receivables]: {
    area: 'finance',
    path: '/app/finance/receivables',
    label: 'Ver contas a receber',
  },
  [PERIOD_CLOSE_CHECK_KINDS.Payables]: {
    area: 'finance',
    path: '/app/finance/payables',
    label: 'Ver contas a pagar',
  },
  [PERIOD_CLOSE_CHECK_KINDS.DuplicateEconomicEvent]: {
    area: 'accounting',
    path: '/app/accounting/journals',
    label: 'Ver lançamentos do período',
  },
  [PERIOD_CLOSE_CHECK_KINDS.OriginConsistency]: {
    area: 'accounting',
    path: '/app/accounting/posting-origins',
    label: 'Ver origem dos lançamentos',
  },
};

/**
 * CLOSING CENTER — leitura autorizada do fechamento contabil/fiscal de uma competencia.
 *
 * O read model NAO cria regra de negocio e nao copia state machine para o front: ele agrega, em
 * UMA resposta, as verificacoes que `evaluatePeriodCloseChecks` ja calcula para o fechamento real,
 * mais os fatos persistidos de documento fiscal da competencia.
 *
 * Fronteira de autorizacao: o periodo exige a concessao de leitura do ledger no escopo da unidade;
 * a secao fiscal so e calculada quando o ator tambem tem concessao de leitura de documento fiscal.
 * Sem essa concessao a secao e omitida por inteiro — nem contagem, nem existencia, nem status.
 */
@Injectable()
export class ClosingReadinessService {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly authz: AccountingAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    /**
     * Contrato PUBLICADO pelo contexto FISCAL. A contagem de documento fiscal da competencia e
     * fato do contexto fiscal; a contabilidade consome o contrato em vez de ler `fis` direto.
     *
     * `@Optional()` pela mesma razao do lado fiscal (`fiscal-accounting-integration`): os dois
     * contextos se consomem por contrato e o wiring nao pode depender de ordem de modulo. Sem o
     * provedor ligado, o fechamento degrada como "secao fiscal indisponivel" em vez de derrubar
     * a leitura — nunca inventa contagem.
     */
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.FiscalDocument)
    private readonly fiscalDocuments?: FiscalDocumentPort,
  ) {}

  async readiness(
    actor: IdentityAuthzContext,
    query: { unitId?: unknown; periodId?: unknown },
  ): Promise<ClosingReadinessResponse> {
    try {
      const unitId = requireNonEmptyText(
        typeof query.unitId === 'string' ? query.unitId : undefined,
        'unitId',
      );
      const periodId = assertUuid(
        requireNonEmptyText(
          typeof query.periodId === 'string' ? query.periodId : undefined,
          'periodId',
        ),
        'periodId',
      );

      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalList, {
        id: periodId,
        unitId,
      });

      const period = await this.repository.findPeriodById(periodId);
      // Periodo de outra unidade e respondido como inexistente: nao vaza existencia fora do escopo.
      if (!period || period.unit_id !== unitId) {
        throw accountingNotFound();
      }

      const canReadFiscal = await hasPolicyAndGrantScope(
        {
          authorizationRepository: this.authorizationRepository,
          policyDecisionPoint: this.policyDecisionPoint,
        },
        {
          actor,
          action: AUTHZ_ACTIONS.FiscalDocumentRead,
          resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument,
          context: { unitId, isFinancial: true },
        },
      );

      const { checks } = await this.repository.previewPeriodClose(period);
      const journalCounts = await this.repository.countJournalsByPeriodStatus(period.id);

      const fiscal = canReadFiscal
        ? await this.requireFiscalDocuments().countDocumentsInWindow({
            unitId,
            startsOn: period.starts_on.slice(0, 10),
            endsOn: period.ends_on.slice(0, 10),
          })
        : null;

      const withheld: ClosingWithheldSection[] = canReadFiscal
        ? []
        : [
            {
              area: 'fiscal',
              reason:
                'Sem autorização para ler documentos fiscais: a verificação fiscal do fechamento não foi avaliada.',
            },
          ];

      const blockers: ClosingException[] = [];
      const pending: ClosingException[] = [];

      for (const check of checks) {
        if (check.observedCount === 0) {
          continue;
        }
        const withheldByAuthz =
          check.kind === PERIOD_CLOSE_CHECK_KINDS.Fiscal && !canReadFiscal;
        if (withheldByAuthz) {
          // Nao afirmamos PASS nem FAIL: o dado nao pode ser lido por este ator.
          continue;
        }
        const target = CHECK_DRILLDOWN[check.kind];
        const entry: ClosingException = {
          kind: check.kind,
          severity:
            check.blocking && check.result === PERIOD_CLOSE_CHECK_RESULTS.Fail
              ? 'BLOCKING'
              : 'INFORMATIONAL',
          observedCount: check.observedCount,
          detail: check.detail,
          area: target?.area ?? 'accounting',
          drilldown: target ? { path: target.path, label: target.label } : null,
        };
        if (entry.severity === 'BLOCKING') {
          blockers.push(entry);
        } else {
          pending.push(entry);
        }
      }

      const periodClosed = period.status === PERIOD_STATUSES.Closed;
      const closeReady = periodClosed
        ? false
        : withheld.length === 0 && blockers.length === 0;

      const nextActions: ClosingReadinessResponse['nextActions'] = [];
      if (periodClosed) {
        nextActions.push({
          label: 'Período já fechado',
          kind: 'REOPEN_PERIOD',
          enabled: false,
          reason: 'Somente uma reabertura autorizada altera um período fechado.',
        });
      } else {
        nextActions.push({
          label: blockers.length > 0 ? 'Resolver bloqueadores antes de fechar' : 'Fechar período',
          kind: 'CLOSE_PERIOD',
          enabled: closeReady === true,
          reason:
            blockers.length > 0
              ? 'Existem bloqueadores persistidos para este período.'
              : withheld.length > 0
                ? 'A verificação fiscal não pôde ser avaliada por falta de autorização.'
                : null,
        });
      }

      return {
        unitId,
        period: toPeriodResponse(period, []),
        closeReady,
        accounting: {
          evaluated: true,
          periodStatus: period.status,
          journalCounts,
        },
        fiscal: fiscal
          ? {
              evaluated: true,
              unauthorized: fiscal.unauthorized,
              rejected: fiscal.rejected,
              pendingAuthorization: fiscal.pendingAuthorization,
              draft: fiscal.draft,
            }
          : null,
        blockers,
        pending,
        nextActions,
        withheld,
      };
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  /**
   * Sem o contrato fiscal ligado nao existe numero a mostrar — e mostrar zero seria afirmar que
   * nenhum documento foi emitido, o que e falso. Falha explicita em vez de contagem inventada.
   */
  private requireFiscalDocuments(): FiscalDocumentPort {
    if (!this.fiscalDocuments) {
      throw accountingNotFound();
    }
    return this.fiscalDocuments;
  }
}

/** Reexportado para o controller manter o contrato em um unico lugar. */
export type { PeriodCloseCheck };

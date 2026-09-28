import { HttpException, Injectable } from '@nestjs/common';
import { PERIOD_STATUSES } from '../../accounting/domain/ledger';
import type { PeriodResponse } from '../../accounting/serializers/accounting-response.serializer';
import {
  ClosingReadinessService,
  type ClosingException,
  type ClosingReadinessResponse,
} from '../../accounting/services/closing-readiness.service';
import { AccountingAccessService } from '../../accounting/services/accounting-access.service';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE CONTABIL — bloqueadores REAIS do fechamento de competencia.
 *
 * Nada e persistido por esta fonte: o item e DERIVADO a cada leitura do que `ClosingReadinessService`
 * avalia para o fechamento de verdade (as mesmas verificacoes que `closePeriod` executa). Nao existe
 * "tarefa de fechamento" criada aqui — criar uma seria inventar obrigacao e duplicar o dominio.
 *
 * Autorizacao: TODA leitura passa pela autoridade do modulo CONTABILIDADE.
 * - `AccountingAccessService.listPeriodsByUnit` exige `accounting:journal:list` no escopo da UNIDADE;
 *   unidade fora do escopo responde 403 e e DESCARTADA sem deixar sinal.
 * - `ClosingReadinessService.readiness` revalida a mesma concessao para a unidade do periodo e trata
 *   periodo de outra unidade como inexistente (404). Sem autorizacao nao existe item.
 *
 * Cobertura das unidades: as unidades candidatas vem do registro neutro de unidades do
 * `authorization.scope_refs` (`ScopeContextRepository.listUnitScopeRefs`), que NAO concede nada — serve
 * apenas para enumerar candidatos no servidor. Quem autoriza e o modulo contabil, unidade por unidade.
 *
 * DEDUPLICACAO: chave logica `CONTABILIDADE:CLOSING:<unitId>:<periodId>` — uma por competencia aberta
 * com bloqueador real.
 */
@Injectable()
export class AccountingWorkSource implements WorkItemSource {
  readonly domain = 'CONTABILIDADE';

  constructor(
    private readonly closingReadiness: ClosingReadinessService,
    private readonly accountingAccess: AccountingAccessService,
    private readonly scopeContext: ScopeContextRepository,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const unitIds = await this.scopeContext.listUnitScopeRefs();
    const perUnit = await Promise.all(
      unitIds.map(async (unitId) => this.collectUnit(actor, unitId)),
    );
    // O id logico carrega unidade E periodo; a guarda apenas garante o invariante do contrato
    // ("a mesma obrigacao nunca entra duas vezes") mesmo se o registro de unidades repetir uma entrada.
    const items = perUnit.flat().filter(isWorkItem);
    return deduplicateById(items);
  }

  private async collectUnit(actor: WorkItemActor, unitId: string): Promise<Array<WorkItem | null>> {
    const periods = await this.openPeriods(actor, unitId);
    if (periods === null) {
      // Unidade fora do escopo do ator: nenhum item, nenhuma contagem, nenhum sinal de existencia.
      return [];
    }
    const items = await Promise.all(
      periods.map(async (period) => {
        const readiness = await this.readiness(actor, unitId, period);
        if (!readiness) {
          return null;
        }
        return toClosingWorkItem(readiness);
      }),
    );
    return items;
  }

  /** Periodos ABERTOS da unidade. `null` = a unidade nao esta autorizada para este ator. */
  private async openPeriods(actor: WorkItemActor, unitId: string): Promise<PeriodResponse[] | null> {
    try {
      const listed = await this.accountingAccess.listPeriodsByUnit(actor, {
        unitId,
        status: PERIOD_STATUSES.Open,
      });
      return listed.items;
    } catch (error) {
      if (isAccessDenied(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Prontidao real do periodo. `null` = sem autorizacao (403) ou periodo inexistente/fora da unidade
   * (404, a resposta que o dominio usa para nao vazar existencia). Periodo sem bloqueador persistido
   * nao gera item — a fila nao inventa pendencia.
   */
  private async readiness(
    actor: WorkItemActor,
    unitId: string,
    period: PeriodResponse,
  ): Promise<ClosingReadinessResponse | null> {
    try {
      return await this.closingReadiness.readiness(actor, { unitId, periodId: period.id });
    } catch (error) {
      if (isNotForThisActor(error)) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Normaliza a prontidao em UM item de trabalho. Puro. Devolve `null` quando nao ha bloqueador real ou
 * quando o periodo nao tem fim de competencia legivel (nesse caso o item e OMITIDO em vez de receber
 * data inventada).
 *
 * `status` e o estado PERSISTIDO do periodo (`acc.period_close_runs` so existe depois de uma tentativa
 * real de fechamento; o estado corrente da competencia e `period.status`). `dueAt` e `null`: o modelo
 * de fechamento NAO persiste prazo de fechamento, e inventar um seria criar SLA que nao existe.
 */
export function toClosingWorkItem(
  readiness: Pick<ClosingReadinessResponse, 'unitId' | 'period' | 'blockers'>,
): WorkItem | null {
  if (readiness.blockers.length === 0) {
    return null;
  }
  const endsOn = toIsoDateTime(readiness.period.endsOn);
  if (!endsOn) {
    return null;
  }

  return {
    id: `CONTABILIDADE:CLOSING:${readiness.unitId}:${readiness.period.id}`,
    domain: 'CONTABILIDADE',
    kind: 'BLOCKER',
    businessReference: readiness.period.code,
    title: `Fechamento bloqueado na competência ${readiness.period.code}`,
    contextLabel: `Unidade ${readiness.unitId} · ${readiness.period.startsOn} a ${readiness.period.endsOn}`,
    status: readiness.period.status,
    reason: describeBlockers(readiness.blockers),
    occurredAt: endsOn,
    dueAt: null,
    actionLabel: 'Abrir a central de fechamento',
    targetRoute: '/app/closing',
    unitId: readiness.unitId,
  };
}

/** Motivo em linguagem de negocio, listando os CODIGOS e as contagens REAIS que o servico devolve. */
export function describeBlockers(blockers: ClosingException[]): string {
  return blockers
    .map((blocker) => `${blocker.kind}: ${blocker.observedCount} pendência(s) — ${blocker.detail}`)
    .join(' | ');
}

function deduplicateById(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const unique: WorkItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDateTime(dateOnly: string): string | null {
  const value = dateOnly?.trim() ?? '';
  return DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : null;
}

/** Recusa de leitura do dominio dono para a unidade/periodo pedido. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

/** Ausencia deliberada de sinal: periodo de outra unidade e respondido como inexistente pelo dominio. */
function isNotForThisActor(error: unknown): boolean {
  return (
    error instanceof HttpException && (error.getStatus() === 403 || error.getStatus() === 404)
  );
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}

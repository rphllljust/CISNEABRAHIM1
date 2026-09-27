import { HttpException, Injectable } from '@nestjs/common';
import { PAYABLE_STATUSES } from '../../finance/domain/payable';
import { RECEIVABLE_STATUSES } from '../../finance/domain/receivable';
import { PayablesAccessService } from '../../finance/services/payables-access.service';
import { ReceivablesAccessService } from '../../finance/services/receivables-access.service';
import type { PayableDetailResponse } from '../../finance/serializers/payables-response.serializer';
import type { ReceivableDetailResponse } from '../../finance/serializers/receivables-response.serializer';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE FINANCEIRA — titulos REAIS vencidos.
 *
 * Autorizacao: `ReceivablesAccessService.list` e `PayablesAccessService.list` sao as autoridades do
 * modulo FINANCEIRO. Cada uma exige a concessao de LISTA e, linha a linha, a concessao de leitura do
 * titulo no escopo de unidade/cliente do ator — o titulo que o ator nao pode ler simplesmente nao vem
 * na resposta. A fonte NAO decide autorizacao e NAO escreve SQL: sem concessao de lista o dominio
 * responde 403 e a fonte devolve lista VAZIA (nunca contagem, nunca item anonimizado).
 *
 * "Vencido" NAO e redefinido aqui: usa-se o status que o proprio dominio deriva
 * (`deriveReceivableStatus` / `derivePayableStatus`), que so marca `OVERDUE` quando ha saldo em aberto
 * (nao liquidado, nao cancelado) e a data de vencimento ja passou. Titulo liquidado ou cancelado nunca
 * entra na fila.
 *
 * DEDUPLICACAO: chaves logicas `FINANCEIRO:RECEIVABLE:<id>` e `FINANCEIRO:PAYABLE:<id>` — uma por
 * titulo, estavel entre leituras.
 */
@Injectable()
export class FinanceWorkSource implements WorkItemSource {
  readonly domain = 'FINANCEIRO';

  constructor(
    private readonly receivables: ReceivablesAccessService,
    private readonly payables: PayablesAccessService,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const [receivables, payables] = await Promise.all([
      this.collectOverdueReceivables(actor),
      this.collectOverduePayables(actor),
    ]);
    return [...receivables, ...payables];
  }

  private async collectOverdueReceivables(actor: WorkItemActor): Promise<WorkItem[]> {
    let rows: ReceivableDetailResponse[];
    try {
      rows = await this.receivables.list(actor);
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }
    return rows.map(toReceivableWorkItem).filter(isWorkItem);
  }

  private async collectOverduePayables(actor: WorkItemActor): Promise<WorkItem[]> {
    let rows: PayableDetailResponse[];
    try {
      rows = await this.payables.list(actor);
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }
    return rows.map(toPayableWorkItem).filter(isWorkItem);
  }
}

/**
 * Normaliza UM recebivel em item de trabalho. Puro. Devolve `null` quando nao ha trabalho real:
 * titulo que nao esta vencido pelo criterio do dominio, ou vencimento em formato inesperado (nesse
 * caso o item e OMITIDO em vez de receber prazo inventado).
 */
export function toReceivableWorkItem(row: ReceivableDetailResponse): WorkItem | null {
  if (row.status !== RECEIVABLE_STATUSES.Overdue) {
    return null;
  }
  const dueAt = toIsoDateTime(row.dueDate);
  if (!dueAt) {
    return null;
  }

  return {
    id: `FINANCEIRO:RECEIVABLE:${row.id}`,
    domain: 'FINANCEIRO',
    kind: 'OVERDUE',
    businessReference: humanReference(
      row.externalReference,
      `A RECEBER ${row.dueDate} · ${row.currencyCode} ${row.principal}`,
    ),
    title: `Recebível vencido · ${row.currencyCode} ${row.remainingBalance}`,
    contextLabel: `Unidade ${row.unitId} · origem ${row.origin.kind}`,
    status: row.status,
    reason: `Vencimento em ${row.dueDate} com saldo em aberto de ${row.remainingBalance} ${row.currencyCode}.`,
    occurredAt: row.createdAt,
    dueAt,
    actionLabel: 'Abrir o recebível',
    targetRoute: `/app/finance/receivables/${row.id}`,
    unitId: row.unitId,
  };
}

/**
 * Normaliza UMA conta a pagar em item de trabalho. Puro. Mesma regra: so titulo que o dominio deriva
 * como `OVERDUE` (saldo em aberto + vencimento passado) entra na fila. A referencia humana prefere a
 * referencia externa persistida e cai para a referencia de origem do titulo; nunca usa uuid.
 */
export function toPayableWorkItem(row: PayableDetailResponse): WorkItem | null {
  if (row.status !== PAYABLE_STATUSES.Overdue) {
    return null;
  }
  const dueAt = toIsoDateTime(row.dueDate);
  if (!dueAt) {
    return null;
  }
  return {
    id: `FINANCEIRO:PAYABLE:${row.id}`,
    domain: 'FINANCEIRO',
    kind: 'OVERDUE',
    businessReference: humanReference(
      row.externalReference ?? row.origin.reference,
      `A PAGAR ${row.dueDate} · ${row.currencyCode} ${row.principal}`,
    ),
    title: `Conta a pagar vencida · ${row.currencyCode} ${row.remainingBalance}`,
    contextLabel: `Unidade ${row.unitId} · origem ${row.origin.kind}`,
    status: row.status,
    reason: `Vencimento em ${row.dueDate} com saldo em aberto de ${row.remainingBalance} ${row.currencyCode} (faixa de atraso ${row.agingBucket}).`,
    occurredAt: row.createdAt,
    dueAt,
    actionLabel: 'Abrir a conta a pagar',
    targetRoute: `/app/finance/payables/${row.id}`,
    unitId: row.unitId,
  };
}

/** Referencia humana: a persistida quando existe; senao um rotulo derivado dos dados reais do titulo. */
function humanReference(candidate: string | null, derived: string): string {
  const trimmed = candidate?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : derived;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `due_date` e `date` no banco: converte para ISO 8601 real; formato inesperado nao vira data. */
export function toIsoDateTime(dateOnly: string): string | null {
  const value = dateOnly?.trim() ?? '';
  return DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : null;
}

/** Negacao do dominio dono: 403 e a recusa de leitura desta carteira. Outra falha nao vira fila vazia. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}

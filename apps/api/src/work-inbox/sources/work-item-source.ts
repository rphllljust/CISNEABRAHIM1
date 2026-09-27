import type { WorkItem } from '../contracts/work-item.contract';

/**
 * Ator autorizado, no mesmo formato usado pelos servicos de acesso do dominio.
 */
export type WorkItemActor = {
  identityId: string;
  sessionId: string;
};

/**
 * FONTE DE TRABALHO
 *
 * Cada dominio implementa uma fonte. O contrato da fonte e deliberadamente estreito:
 *
 * 1. A fonte APLICA A AUTORIZACAO DO PROPRIO DOMINIO, reutilizando o servico de acesso
 *    que aquele modulo ja usa (capability + escopo de unidade). A Work Inbox NAO decide
 *    autorizacao e NAO reimplementa regra de acesso.
 * 2. Quando o ator NAO pode ler o objeto de origem, a fonte retorna a lista SEM aquele
 *    item — nunca um item anonimizado, nunca uma contagem, nunca um sinal de existencia.
 * 3. A fonte consulta em LOTE. Nao existe consulta por item da fila (sem N+1).
 * 4. A fonte nao executa nada: e somente leitura.
 */
export interface WorkItemSource {
  /** Dominio de origem, usado no diagnostico de degradacao parcial. */
  readonly domain: string;
  collect(actor: WorkItemActor): Promise<WorkItem[]>;
}

/** Token de injecao das fontes registradas. */
export const WORK_ITEM_SOURCES = Symbol('WORK_ITEM_SOURCES');

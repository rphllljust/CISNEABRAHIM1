import { Inject, Injectable } from '@nestjs/common';
import {
  WORK_DOMAINS,
  type WorkDomain,
  type WorkItem,
  WORK_KINDS,
  compareWorkItems,
  deduplicateWorkItems,
} from '../contracts/work-item.contract';
import { WORK_ITEM_SOURCES, type WorkItemActor, type WorkItemSource } from '../sources/work-item-source';

/**
 * UNIFIED WORK INBOX — agregacao server-side.
 *
 * Uma requisicao (`GET /work-inbox`) monta a fila inteira: as fontes autorizadas sao
 * consultadas em paralelo no servidor e NORMALIZADAS para o mesmo contrato. O browser nao
 * faz merge de seis listas e nao dispara uma requisicao por dominio.
 *
 * Regras:
 * - `byDomain` e calculado sobre o MESMO conjunto filtrado que a pagina exibe, ANTES da
 *   paginacao. Assim o contador do workspace e a fila filtrada nunca divergem: os dois
 *   leem o mesmo numero da mesma consulta.
 * - Fonte que falha NAO some em silencio: o dominio entra em `unavailableDomains` e a tela
 *   diz isso ao operador. Fila incompleta apresentada como fila completa e pior que erro.
 * - Ordenacao deterministica e deduplicacao por chave logica antes de paginar.
 */

export const WORK_INBOX_DEFAULT_LIMIT = 25;
export const WORK_INBOX_MAX_LIMIT = 100;

export type WorkInboxQuery = {
  domain?: string;
  kind?: string;
  status?: string;
  unitId?: string;
  overdue?: string;
  limit?: string;
  offset?: string;
};

export type WorkInboxPage = {
  items: WorkItem[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
  /** Contagem real por dominio do conjunto filtrado (base dos workspaces). */
  byDomain: Record<WorkDomain, number>;
  /** Dominios cuja fonte falhou nesta leitura — a fila esta incompleta e isso e dito. */
  unavailableDomains: string[];
};

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function emptyByDomain(): Record<WorkDomain, number> {
  return WORK_DOMAINS.reduce(
    (accumulator, domain) => {
      accumulator[domain] = 0;
      return accumulator;
    },
    {} as Record<WorkDomain, number>,
  );
}

@Injectable()
export class WorkInboxService {
  constructor(
    @Inject(WORK_ITEM_SOURCES) private readonly sources: WorkItemSource[],
  ) {}

  async list(actor: WorkItemActor, query: WorkInboxQuery = {}): Promise<WorkInboxPage> {
    const settled = await Promise.allSettled(
      this.sources.map((source) => source.collect(actor)),
    );

    const collected: WorkItem[] = [];
    const unavailableDomains: string[] = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        collected.push(...result.value);
        return;
      }
      // Fonte indisponivel: o dominio e declarado, nunca mascarado como "sem trabalho".
      unavailableDomains.push(this.sources[index]?.domain ?? `source-${index}`);
    });

    const domain = WORK_DOMAINS.find((candidate) => candidate === query.domain);
    const kind = WORK_KINDS.find((candidate) => candidate === query.kind);
    const wantsOverdue = query.overdue === 'true';
    const statusFilter = query.status?.trim().toLowerCase();
    const unitFilter = query.unitId?.trim().toLowerCase();

    const filtered = deduplicateWorkItems(collected)
      .filter((item) => (domain ? item.domain === domain : true))
      .filter((item) => (kind ? item.kind === kind : true))
      .filter((item) => (unitFilter ? (item.unitId ?? '').toLowerCase() === unitFilter : true))
      .filter((item) =>
        statusFilter ? item.status.toLowerCase() === statusFilter : true,
      )
      .filter((item) =>
        wantsOverdue
          ? item.dueAt !== null && new Date(item.dueAt).getTime() < Date.now()
          : true,
      )
      .sort(compareWorkItems);

    const byDomain = emptyByDomain();
    for (const item of filtered) {
      byDomain[item.domain] += 1;
    }

    const limit = parsePositiveInt(query.limit, WORK_INBOX_DEFAULT_LIMIT, WORK_INBOX_MAX_LIMIT);
    const offset = parsePositiveInt(query.offset, 0, Number.MAX_SAFE_INTEGER);
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    return {
      items,
      limit,
      offset,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      byDomain,
      unavailableDomains,
    };
  }
}

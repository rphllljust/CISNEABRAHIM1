import { describe, expect, it, vi } from 'vitest';
import type { WorkItem } from './contracts/work-item.contract';
import { deduplicateWorkItems } from './contracts/work-item.contract';
import { WorkInboxService } from './services/work-inbox.service';
import type { WorkItemSource } from './sources/work-item-source';

/**
 * UNIFIED WORK INBOX — comportamento vinculante do read model.
 *
 * O que estes testes protegem:
 * - deduplicacao por chave logica (a mesma obrigacao nao entra duas vezes);
 * - ordenacao DETERMINISTICA (paginacao estavel);
 * - paginacao e filtros URL-driven;
 * - `byDomain` calculado sobre o conjunto filtrado (base do contador do workspace);
 * - fonte indisponivel e DECLARADA, nunca mascarada como "sem trabalho";
 * - dominio sem trabalho devolve fila vazia honesta.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'OPERACOES:ALERT:a1',
    domain: 'OPERACOES',
    kind: 'OVERDUE',
    businessReference: 'OS-2026-0001',
    title: 'Ordem de serviço vencida',
    contextLabel: 'Cliente A',
    status: 'Overdue',
    reason: 'Prazo real vencido',
    occurredAt: '2026-09-01T10:00:00.000Z',
    dueAt: '2026-09-10T10:00:00.000Z',
    actionLabel: 'Abrir a OS',
    targetRoute: '/app/service-orders/s1/planning',
    unitId: 'UN-1',
    ...overrides,
  };
}

function source(domain: string, items: WorkItem[]): WorkItemSource {
  return { domain, collect: vi.fn(async () => items) };
}

describe('work inbox — deduplicacao', () => {
  it('mantem a mesma obrigacao uma unica vez, mesmo vinda de fontes diferentes', () => {
    const duplicated = [item(), item({ title: 'outro texto para o mesmo id' })];

    const unique = deduplicateWorkItems(duplicated);

    expect(unique).toHaveLength(1);
    expect(unique[0]?.title).toBe('Ordem de serviço vencida');
  });
});

describe('work inbox — ordenacao deterministica', () => {
  it('ordena por natureza, depois vencido, depois prazo mais antigo, depois referencia', async () => {
    const service = new WorkInboxService([
      source('mixed', [
        item({ id: 'CONTINUITY', kind: 'CONTINUITY', businessReference: 'A' }),
        item({ id: 'BLOCKER', kind: 'BLOCKER', businessReference: 'B' }),
        item({ id: 'EXCEPTION', kind: 'EXCEPTION', businessReference: 'C' }),
        item({ id: 'APPROVAL', kind: 'APPROVAL', businessReference: 'D' }),
        item({ id: 'OVERDUE', kind: 'OVERDUE', businessReference: 'E' }),
      ]),
    ]);

    const page = await service.list(ACTOR);

    expect(page.items.map((entry) => entry.id)).toEqual([
      'BLOCKER',
      'OVERDUE',
      'APPROVAL',
      'EXCEPTION',
      'CONTINUITY',
    ]);
  });

  it('e estavel: duas leituras produzem exatamente a mesma ordem', async () => {
    const items = [
      item({ id: 'B:2', businessReference: 'OS-2' }),
      item({ id: 'A:1', businessReference: 'OS-1' }),
    ];
    const service = new WorkInboxService([source('x', items)]);

    const first = await service.list(ACTOR);
    const second = await service.list(ACTOR);

    expect(first.items.map((entry) => entry.id)).toEqual(second.items.map((entry) => entry.id));
    expect(first.items.map((entry) => entry.id)).toEqual(['A:1', 'B:2']);
  });
});

describe('work inbox — filtros e paginacao', () => {
  const service = new WorkInboxService([
    source('x', [
      item({ id: 'F1', domain: 'FINANCEIRO', unitId: 'UN-1' }),
      item({ id: 'F2', domain: 'FINANCEIRO', unitId: 'UN-2' }),
      item({ id: 'O1', domain: 'OPERACOES', kind: 'EXCEPTION', unitId: 'UN-1' }),
    ]),
  ]);

  it('filtra por dominio, natureza e unidade', async () => {
    await expect(service.list(ACTOR, { domain: 'FINANCEIRO' })).resolves.toMatchObject({ total: 2 });
    await expect(service.list(ACTOR, { kind: 'EXCEPTION' })).resolves.toMatchObject({ total: 1 });
    await expect(service.list(ACTOR, { unitId: 'UN-1' })).resolves.toMatchObject({ total: 2 });
  });

  it('pagina sem perder nem repetir item, com total do conjunto filtrado', async () => {
    const first = await service.list(ACTOR, { limit: '2', offset: '0' });
    const second = await service.list(ACTOR, { limit: '2', offset: '2' });

    expect(first.total).toBe(3);
    expect(first.totalPages).toBe(2);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    const ids = [...first.items, ...second.items].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('limita o teto de pagina para nao permitir leitura ilimitada', async () => {
    const page = await service.list(ACTOR, { limit: '100000' });
    expect(page.limit).toBe(100);
  });

  it('filtro desconhecido nao inventa recorte: devolve o conjunto inteiro', async () => {
    const page = await service.list(ACTOR, { domain: 'INEXISTENTE' });
    expect(page.total).toBe(3);
  });
});

describe('work inbox — contagem por dominio (base do workspace)', () => {
  it('conta por dominio sobre o MESMO conjunto filtrado que a pagina exibe', async () => {
    const service = new WorkInboxService([
      source('x', [
        item({ id: 'F1', domain: 'FINANCEIRO' }),
        item({ id: 'F2', domain: 'FINANCEIRO' }),
        item({ id: 'C1', domain: 'CONTABILIDADE' }),
      ]),
    ]);

    const page = await service.list(ACTOR, { limit: '1' });

    // O contador nao depende da paginacao: e o numero que o drill-down vai reproduzir.
    expect(page.byDomain.FINANCEIRO).toBe(2);
    expect(page.byDomain.CONTABILIDADE).toBe(1);
    expect(page.byDomain.OPERACOES).toBe(0);
    expect(page.items).toHaveLength(1);

    const drilled = await service.list(ACTOR, { domain: 'FINANCEIRO' });
    expect(drilled.total).toBe(page.byDomain.FINANCEIRO);
  });
});

describe('work inbox — degradacao e vazio honesto', () => {
  it('declara o dominio cuja fonte falhou em vez de apresentar fila incompleta como completa', async () => {
    const failing: WorkItemSource = {
      domain: 'FISCAL',
      collect: vi.fn(async () => {
        throw new Error('indisponivel');
      }),
    };
    const service = new WorkInboxService([source('x', [item()]), failing]);

    const page = await service.list(ACTOR);

    expect(page.unavailableDomains).toEqual(['FISCAL']);
    expect(page.items).toHaveLength(1);
  });

  it('sem trabalho real a fila e vazia e diz isso — nenhum item sintetico', async () => {
    const service = new WorkInboxService([source('x', [])]);

    const page = await service.list(ACTOR);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.unavailableDomains).toEqual([]);
  });
});

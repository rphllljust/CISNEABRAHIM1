import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BusinessChain, chainStatusLabel, chainStatusTone } from './BusinessChain';
import type { BusinessChain as BusinessChainModel } from './types';

/**
 * CADEIA EMPRESARIAL — CONTRATO DE APRESENTACAO.
 *
 * Prova o que a interface garante ao usuario:
 *   - cada item tem natureza, REFERENCIA HUMANA, status e data reais;
 *   - o item e CLICAVEL e leva a rota autorizada devolvida pelo servidor;
 *   - a cadeia parcial real nao vira placeholder;
 *   - o backend omitindo um dominio, a interface NAO inventa sinal de existencia.
 */

function chainOf(nodes: BusinessChainModel['nodes']): BusinessChainModel {
  return { anchor: { kind: 'SERVICE_ORDER', id: nodes[0]?.id ?? 'so-1' }, nodes, milestones: [] };
}

const FULL_CHAIN: BusinessChainModel = {
  anchor: { kind: 'SERVICE_REQUEST', id: 'sr-1' },
  nodes: [
    {
      id: 'sr-1',
      kind: 'SERVICE_REQUEST',
      businessReference: 'SR-2026-001',
      status: 'CONVERTED',
      occurredAt: '2026-02-01T10:00:00.000Z',
      route: '/app/requests/sr-1',
      relation: 'ROOT',
      summary: 'Solicitação registrada · origem PHONE',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
    {
      id: 'p-1',
      kind: 'PROPOSAL',
      businessReference: 'PROP-2026-0042',
      status: 'ACCEPTED',
      occurredAt: '2026-02-05T10:00:00.000Z',
      route: '/app/proposals/p-1',
      relation: 'RESULT',
      summary: 'Serviço de manutenção · revisão 2',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
    {
      id: 'so-1',
      kind: 'SERVICE_ORDER',
      businessReference: 'OS-2026-0184',
      status: 'COMPLETED',
      occurredAt: '2026-03-01T10:00:00.000Z',
      route: '/app/service-orders/so-1/planning',
      relation: 'RESULT',
      summary: 'Origem PROPOSAL',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
    {
      id: 'm-1',
      kind: 'MEASUREMENT',
      businessReference: 'Medição de OS-2026-0184',
      status: 'APPROVED',
      occurredAt: '2026-03-10T10:00:00.000Z',
      route: '/app/service-orders/so-1/measurement',
      relation: 'RESULT',
      summary: 'Medição da OS OS-2026-0184',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
    {
      id: 'bd-1',
      kind: 'BILLING_DOCUMENT',
      businessReference: 'NF-2026-0005',
      status: 'FINALIZED',
      occurredAt: '2026-03-15T10:00:00.000Z',
      route: '/app/service-orders/so-1/billing/document',
      relation: 'RESULT',
      summary: 'Nota/Fatura interna · BRL 1200.0000',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
    {
      id: 'r-1',
      kind: 'RECEIVABLE',
      businessReference: 'Cobrança da NF-2026-0005',
      status: 'OPEN',
      occurredAt: '2026-03-15T10:05:00.000Z',
      route: '/app/finance/receivables/r-1',
      relation: 'RESULT',
      summary: 'BRL 1200.0000 · vencimento 2026-04-14',
      unitId: 'UNIDADE-1',
      clientId: 'cliente-1',
    },
  ],
  milestones: [
    { label: 'Comercial concluído', evidence: 'PROP-2026-0042 · ACCEPTED', occurredAt: '2026-02-05T10:00:00.000Z' },
    { label: 'Medição aprovada', evidence: 'Medição de OS-2026-0184 · APPROVED', occurredAt: '2026-03-10T10:00:00.000Z' },
    { label: 'Recebível em aberto', evidence: 'Cobrança da NF-2026-0005 · OPEN', occurredAt: '2026-03-15T10:05:00.000Z' },
  ],
};

/** Item de lista por indice, sem `undefined` implicito: o teste falha alto e claro. */
function step<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Passo ${index} ausente na cadeia renderizada.`);
  }
  return item;
}

function renderChain(chain: BusinessChainModel | null, phase: Parameters<typeof BusinessChain>[0]['phase'] = 'ready') {
  return render(
    <MemoryRouter>
      <BusinessChain chain={chain} phase={phase} />
    </MemoryRouter>,
  );
}

describe('business chain — render', () => {
  it('apresenta a linhagem na ordem canonica com referencia humana e status', () => {
    renderChain(FULL_CHAIN);

    const items = within(screen.getByRole('list', { name: 'Linhagem de negócio' })).getAllByRole('listitem');
    expect(items).toHaveLength(6);

    const references = items.map((item) => within(item).getByRole('link').textContent);
    expect(references).toEqual([
      'SR-2026-001',
      'PROP-2026-0042',
      'OS-2026-0184',
      'Medição de OS-2026-0184',
      'NF-2026-0005',
      'Cobrança da NF-2026-0005',
    ]);

    expect(within(step(items, 2)).getByText('Concluída')).toBeTruthy();
    expect(within(step(items, 4)).getByText('Emitida')).toBeTruthy();
    expect(within(step(items, 5)).getByText('Em aberto')).toBeTruthy();
  });

  it('nenhum identificador tecnico aparece como rotulo', () => {
    const { container } = renderChain(FULL_CHAIN);
    const text = container.textContent ?? '';

    for (const node of FULL_CHAIN.nodes) {
      expect(text).not.toContain(node.id);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it('cada item e um click real para a rota autorizada do objeto', () => {
    renderChain(FULL_CHAIN);

    const items = within(screen.getByRole('list', { name: 'Linhagem de negócio' })).getAllByRole('listitem');
    expect(within(step(items, 2)).getByRole('link').getAttribute('href')).toBe('/app/service-orders/so-1/planning');
    expect(within(step(items, 4)).getByRole('link').getAttribute('href')).toBe('/app/service-orders/so-1/billing/document');
    expect(within(step(items, 5)).getByRole('link').getAttribute('href')).toBe('/app/finance/receivables/r-1');
  });

  it('mostra o tipo de negocio e a relacao de cada no', () => {
    renderChain(FULL_CHAIN);

    const items = within(screen.getByRole('list', { name: 'Linhagem de negócio' })).getAllByRole('listitem');
    expect(within(step(items, 0)).getByText('Solicitação')).toBeTruthy();
    expect(within(step(items, 1)).getByText('Proposta')).toBeTruthy();
    // O no do proprio registro nao repete a relacao (ele E o ponto de partida).
    expect(within(step(items, 0)).queryByText('Registro de origem')).toBeNull();
    expect(within(step(items, 1)).getByText('Gerou')).toBeTruthy();
  });

  it('resume a cadeia por marcos reais, sem score', () => {
    renderChain(FULL_CHAIN);

    const summary = screen.getByRole('list', { name: 'Resumo da cadeia' });
    expect(within(summary).getByText('Comercial concluído')).toBeTruthy();
    expect(within(summary).getByText('Medição aprovada')).toBeTruthy();
    expect(within(summary).getByText('Recebível em aberto')).toBeTruthy();
    expect(screen.queryByText(/score|pontua/i)).toBeNull();
  });
});

describe('business chain — omissao por autorizacao', () => {
  it('nao mostra nada sobre o dominio negado: sem rotulo, sem count, sem placeholder', () => {
    // O backend devolveu a cadeia TERMINANDO na OS — contabilidade e fiscal nao vieram.
    const partial = chainOf(FULL_CHAIN.nodes.slice(0, 3));
    const { container } = renderChain(partial);
    const text = container.textContent ?? '';

    expect(text).not.toContain('Lançamento');
    expect(text).not.toContain('Documento fiscal');
    expect(text).not.toContain('ocult');
    expect(text).not.toContain('sem permissão para ver');

    const items = within(screen.getByRole('list', { name: 'Linhagem de negócio' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('nao renderiza marcador de etapa ausente', () => {
    const partial = chainOf(FULL_CHAIN.nodes.slice(0, 2));
    renderChain(partial);

    expect(screen.queryByRole('list', { name: 'Resumo da cadeia' })).toBeNull();
  });
});

describe('business chain — vazio, parcial e falha', () => {
  it('cadeia sem linhagem registrada nao vira placeholder de erro', () => {
    renderChain(chainOf([step(FULL_CHAIN.nodes, 2)]));

    expect(screen.getByText('Este registro não tem linhagem registrada além dele mesmo.')).toBeTruthy();
  });

  it('cadeia vazia e tratada como ausencia real de linhagem', () => {
    renderChain(chainOf([]));

    expect(screen.getByText(/não tem linhagem registrada/)).toBeTruthy();
  });

  it('negacao da cadeia inteira e dita como negacao, nao como vazio', () => {
    renderChain(null, 'denied');

    expect(screen.getByText('Você não tem permissão para ver a linhagem deste registro.')).toBeTruthy();
  });

  it('falha de leitura oferece nova tentativa', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <BusinessChain chain={null} phase="error" message="Não foi possível carregar a cadeia deste registro." onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Não foi possível carregar a cadeia deste registro.')).toBeTruthy();
    screen.getByRole('button', { name: 'Tentar novamente' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('estado real desconhecido e exibido cru, sem traducao inventada', () => {
    expect(chainStatusLabel('SOME_NEW_STATE')).toBe('SOME_NEW_STATE');
    expect(chainStatusTone('SOME_NEW_STATE')).toBe('neutral');
    expect(chainStatusLabel('SETTLED')).toBe('Liquidado');
    expect(chainStatusLabel('REVERSED')).toBe('Estornado');
  });
});

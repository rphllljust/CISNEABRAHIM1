import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Client360ExecutivePanel } from './Client360ExecutivePanel';
import type { ClientRelatedModules, RelatedModule } from '../hooks/useClientRelatedRecords';

const denied: RelatedModule = { phase: 'denied', allowed: false, rows: [], count: null };
const ready = (count: number | null): RelatedModule => ({
  phase: 'ready',
  allowed: true,
  rows: [],
  count,
});
const modules = (overrides: Partial<ClientRelatedModules>): ClientRelatedModules => ({
  requests: denied,
  proposals: denied,
  purchaseOrders: denied,
  contracts: denied,
  serviceOrders: denied,
  ...overrides,
});

describe('Client360ExecutivePanel — navegação por recorte autoritativo', () => {
  it('abre listas reais filtradas por cliente sem perder o contexto do objeto', () => {
    render(
      <MemoryRouter>
        <Client360ExecutivePanel
          clientId="cliente-123"
          modules={modules({
            requests: ready(3),
            purchaseOrders: ready(21),
            contracts: ready(0),
            serviceOrders: ready(44),
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /abrir solicitações deste cliente/i }).getAttribute('href'))
      .toBe('/app/requests?clientId=cliente-123');
    expect(screen.getByRole('link', { name: /abrir pedidos de compra deste cliente/i }).getAttribute('href'))
      .toBe('/app/purchase-orders?clientId=cliente-123');
    expect(screen.getByRole('link', { name: /abrir contratos deste cliente/i }).getAttribute('href'))
      .toBe('/app/contracts?clientId=cliente-123');
    expect(screen.getByRole('link', { name: /abrir ordens de serviço deste cliente/i }).getAttribute('href'))
      .toBe('/app/service-orders?clientId=cliente-123');
    expect(screen.queryByRole('link', { name: /abrir propostas deste cliente/i })).toBeNull();
  });

  it('omite módulos negados e contagens desconhecidas, sem inventar zero', () => {
    render(
      <MemoryRouter>
        <Client360ExecutivePanel
          clientId="cliente-123"
          modules={modules({
            proposals: ready(null),
            serviceOrders: { phase: 'error', allowed: false, rows: [], count: null },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Propostas')).toBeNull();
    expect(screen.queryByText('Ordens de serviço')).toBeNull();
    expect(screen.getByText(/Nenhum total consolidado foi publicado/)).toBeTruthy();
  });
});

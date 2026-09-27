import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AssetOperationalLifecyclePanel } from './AssetOperationalLifecycle';
import type { AssetOperationalLifecycle } from '../types/asset-operational-lifecycle.types';

const LIFECYCLE: AssetOperationalLifecycle = {
  currentUse: {
    allocationId: 'alloc-1',
    serviceOrderId: 'so-1',
    orderNumber: 'OS-2026-DEMO01',
    orderStatus: 'IN_EXECUTION',
    operationalStart: '2026-01-01T08:00:00.000Z',
    operationalEnd: '2026-01-01T18:00:00.000Z',
    allocationStatus: 'ACTIVE',
    timing: 'CURRENT',
  },
  nextUse: {
    allocationId: 'alloc-2',
    serviceOrderId: 'so-2',
    orderNumber: 'OS-2026-DEMO02',
    orderStatus: 'RELEASED',
    operationalStart: '2026-02-10T08:00:00.000Z',
    operationalEnd: '2026-02-10T18:00:00.000Z',
    allocationStatus: 'ACTIVE',
    timing: 'FUTURE',
  },
  history: [
    {
      allocationId: 'alloc-0',
      serviceOrderId: 'so-0',
      orderNumber: 'OS-2025-DEMO99',
      orderStatus: 'COMPLETED',
      operationalStart: '2025-12-01T08:00:00.000Z',
      operationalEnd: '2025-12-01T17:00:00.000Z',
      allocationStatus: 'ACTIVE',
      timing: 'PAST',
    },
  ],
  occurrences: [
    {
      id: 'occ-1',
      serviceOrderId: 'so-0',
      orderNumber: 'OS-2025-DEMO99',
      occurrenceCode: 'TRAFFIC_DELAY',
      description: 'Atraso por trânsito na chegada ao local',
      recordedAt: '2025-12-01T09:30:00.000Z',
    },
  ],
};

function renderPanel(lifecycle: AssetOperationalLifecycle) {
  return render(
    <MemoryRouter>
      <AssetOperationalLifecyclePanel lifecycle={lifecycle} />
    </MemoryRouter>,
  );
}

describe('AssetOperationalLifecyclePanel', () => {
  it('renders current use and next utilization from the authorized payload', () => {
    renderPanel(LIFECYCLE);

    expect(screen.getByRole('heading', { name: /uso atual/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /próxima utilização/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toHaveAttribute(
      'href',
      '/app/service-orders/so-1/planning',
    );
    expect(screen.getByRole('link', { name: 'OS-2026-DEMO02' })).toBeInTheDocument();
    expect(screen.getAllByText(/alocação ativa/i).length).toBeGreaterThan(0);
  });

  it('renders operational history and occurrences as registered facts only', () => {
    renderPanel(LIFECYCLE);

    expect(screen.getByRole('heading', { name: /histórico operacional/i })).toBeInTheDocument();
    // A mesma OS aparece no histórico e na ocorrência registrada.\n    expect(screen.getAllByRole('link', { name: 'OS-2025-DEMO99' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /ocorrências recentes/i })).toBeInTheDocument();
    expect(screen.getByText('TRAFFIC_DELAY')).toBeInTheDocument();
    expect(screen.getByText(/atraso por trânsito/i)).toBeInTheDocument();
    // Ocorrencia nao e promovida a falha/avaria/manutencao/downtime sem regra do dominio.
    expect(screen.queryByText(/falha|avaria|manutenção|downtime/i)).not.toBeInTheDocument();
  });

  it('declares absence without inventing links or metadata when the payload omits data', () => {
    renderPanel({ currentUse: null, nextUse: null, history: [], occurrences: [] });

    expect(screen.getByText(/sem uso atual registrado/i)).toBeInTheDocument();
    expect(screen.getByText(/sem próxima utilização registrada/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhuma utilização registrada para este recurso/i)).toBeInTheDocument();
    expect(
      screen.getByText(/nenhuma ocorrência registrada nas ordens em que este recurso foi alocado/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

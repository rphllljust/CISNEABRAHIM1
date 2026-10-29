import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getServiceOrderCostEvidence,
  ServiceOrdersApiError,
  type ServiceOrderCostEvidence,
} from '../api/service-orders-api';
import { ServiceOrderCostToServePanel } from './ServiceOrderCostToServePanel';

vi.mock('../api/service-orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/service-orders-api')>();
  return { ...actual, getServiceOrderCostEvidence: vi.fn() };
});

const EVIDENCE: ServiceOrderCostEvidence = {
  serviceOrderId: 'os-real-001', rowVersion: 4,
  entries: [
    {
      id: 'entry-cost-1', category: 'FUEL', costKind: 'ACTUAL', origin: 'EXECUTION',
      description: 'Combustível confirmado', amount: '3000', currencyCode: 'BRL',
      sourceExecutionEntryId: 'entry-exec-1', recordedAt: '2026-10-10T10:00:00Z',
    },
  ],
  summary: {
    capturedAt: '2026-10-10T11:00:00Z', currencyCode: 'BRL',
    revenue: '7000', totalEstimatedCost: '2800', totalActualCost: '3000',
    estimatedMargin: '4200', actualMargin: '4000',
    estimatedToActualVariance: '200', blockingReasons: [],
    disclaimer: 'Operational profitability is indicative and not official accounting.',
    lines: [{
      id: 'entry-cost-1', category: 'FUEL', costKind: 'ACTUAL',
      origin: 'EXECUTION', amount: '3000', currencyCode: 'BRL',
      sourceExecutionEntryId: 'entry-exec-1',
    }],
  },
};

function mount() {
  return render(
    <MemoryRouter>
      <ServiceOrderCostToServePanel serviceOrderId="os-real-001" />
    </MemoryRouter>,
  );
}

describe('Service Order 360 Cost-to-Serve', () => {
  beforeEach(() => vi.mocked(getServiceOrderCostEvidence).mockReset());

  it('presents authoritative figures, variances, source records and economic caveat', async () => {
    vi.mocked(getServiceOrderCostEvidence).mockResolvedValue(EVIDENCE);
    mount();
    expect(await screen.findByText('Cost-to-Serve')).toBeInTheDocument();
    expect(await screen.findByText('BRL 4000')).toBeInTheDocument();
    expect(screen.getByText('BRL 200')).toBeInTheDocument();
    expect(screen.getByText(/Medição aprovada não comprova aceite/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText(/Documentos e registros que compõem os custos/));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Combustível confirmado')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Registro de execução' }))
      .toHaveAttribute('href', '/app/service-orders/os-real-001/execution');
    expect(getServiceOrderCostEvidence).toHaveBeenCalledWith('os-real-001', expect.any(AbortSignal));
  });

  it('never reports mixed-currency totals as valid margins', async () => {
    vi.mocked(getServiceOrderCostEvidence).mockResolvedValue({
      ...EVIDENCE,
      summary: {
        ...EVIDENCE.summary,
        totalActualCost: null, actualMargin: null,
        blockingReasons: ['COST_CURRENCY_MISMATCH'],
      },
    });
    mount();
    expect(await screen.findByText(/Há custos em moedas diferentes/)).toBeInTheDocument();
    expect(screen.getAllByText('Sem evidência suficiente').length).toBeGreaterThan(0);
  });

  it('distinguishes authorization denial from a zero balance', async () => {
    vi.mocked(getServiceOrderCostEvidence).mockImplementation(async () => {
      throw new ServiceOrdersApiError(403, undefined, 'denied');
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('não autorizada');
    expect(screen.queryByText('BRL 0')).not.toBeInTheDocument();
  });

  it('recovers a network error only through an explicit read retry', async () => {
    vi.mocked(getServiceOrderCostEvidence)
      .mockRejectedValueOnce(new ServiceOrdersApiError(0, undefined, 'network'))
      .mockResolvedValueOnce(EVIDENCE);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao consultar');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconsultar fatos econômicos' }));
    await waitFor(() => expect(screen.getByText('BRL 4000')).toBeInTheDocument());
    expect(getServiceOrderCostEvidence).toHaveBeenCalledTimes(2);
  });
});

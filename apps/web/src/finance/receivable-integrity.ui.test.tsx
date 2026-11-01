import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { parseReceivableIntegritySnapshot } from './api/finance-api';
import { ReceivableIntegrityStrip } from './components/ReceivableIntegrityStrip';

const SAMPLE = {
  collectedAt: '2026-10-31T21:00:00.000Z',
  technical: { backlog: {
    receivableHandoffPending: 2,
    receivableHandoffDead: 1,
    billingReceivableOrphans: 3,
  } },
};

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function fetchForIntegrity(handler: () => Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api/v1/observability/metrics')) return handler();
    return response({ error: { code: 'NOT_FOUND' } }, 404);
  });
}

describe('MASTER 001-05 — integridade de Billing e recebíveis', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('exibe as três contagens exatas e a coleta do servidor sem inventar drilldown', async () => {
    const fetchMock = fetchForIntegrity(async () => response(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ReceivableIntegrityStrip />);

    const strip = await screen.findByLabelText('Indicadores de integridade Billing e recebíveis');
    expect(within(strip).getByText('1')).toBeInTheDocument();
    expect(within(strip).getByText('3')).toBeInTheDocument();
    expect(within(strip).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Coleta:/)).toBeInTheDocument();
    expect(within(strip).queryAllByRole('link')).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('/api/v1/observability/metrics');
    })).toBe(true);
  });

  it('aceita zero apenas quando foi efetivamente medido', async () => {
    vi.stubGlobal('fetch', fetchForIntegrity(async () =>
      response({ ...SAMPLE, technical: { backlog: {
        receivableHandoffPending: 0,
        receivableHandoffDead: 0,
        billingReceivableOrphans: 0,
      } } }),
    ));
    renderWithProviders(<ReceivableIntegrityStrip />);
    const strip = await screen.findByLabelText('Indicadores de integridade Billing e recebíveis');
    expect(within(strip).getAllByText('0')).toHaveLength(3);
    expect(screen.queryByText(/não autorizado/i)).not.toBeInTheDocument();
  });

  it('não revela rótulo nem contagens quando o servidor nega 403', async () => {
    vi.stubGlobal('fetch', fetchForIntegrity(async () =>
      response({ error: { code: 'PLATFORM_DENIED' } }, 403),
    ));
    renderWithProviders(<ReceivableIntegrityStrip />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/não autorizado/i));
    expect(screen.queryByText('Handoffs financeiros falhos')).not.toBeInTheDocument();
    expect(screen.queryByText('Faturas sem recebível')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('rejeita payload incompleto ou contaminado, sem o converter em zero', async () => {
    expect(() => parseReceivableIntegritySnapshot({
      ...SAMPLE,
      technical: { backlog: { receivableHandoffPending: 0, receivableHandoffDead: '0' } },
    })).toThrow();
    vi.stubGlobal('fetch', fetchForIntegrity(async () =>
      response({ ...SAMPLE, technical: { backlog: { receivableHandoffPending: 0 } } }),
    ));
    renderWithProviders(<ReceivableIntegrityStrip />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/indisponível/i);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('recupera a leitura após falha de rede sem descartar as asserções', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', fetchForIntegrity(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return response(SAMPLE);
    }));
    renderWithProviders(<ReceivableIntegrityStrip />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/indisponível/i);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    const strip = await screen.findByLabelText('Indicadores de integridade Billing e recebíveis');
    expect(within(strip).getByText('3')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import {
  CashForecastPage,
  buildForecastContextFields,
  cashForecastLineLabel,
  hasOverdueRisk,
} from './pages/CashForecastPage';
import type { CashForecast } from './types/finance.types';

/**
 * PREVISAO DE CAIXA — tesouraria, nao grafico.
 *
 * A tela tem de responder, em 5 segundos: quanto entra, quanto sai, quando, qual o
 * saldo projetado, qual o horizonte, qual a unidade, de onde vem, e o que e REAL
 * contra o que e PREVISAO. Nada aqui e calculado no navegador.
 */

function forecastFixture(overrides: Partial<CashForecast> = {}): CashForecast {
  return {
    status: 'PROJECTED',
    unitId: 'UN-1',
    currencyCode: 'BRL',
    asOf: '2026-10-01',
    horizonEndsOn: '2026-10-31',
    realized: { cashBalance: '1000.0000', inflows: '500.0000', outflows: '200.0000' },
    forecast: {
      inflows: '800.0000',
      outflows: '300.0000',
      overdueInflows: '0.0000',
      overdueOutflows: '0.0000',
      net: '500.0000',
    },
    projectedCash: { amount: '1500.0000' },
    lines: [{ kind: 'RECEIVABLE', amount: '800.0000', sourceKind: 'RECEIVABLE' }],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function stubForecast(payload: CashForecast) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(payload)),
  );
}

async function project() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/unidade/i), 'UN-1');
  await user.click(screen.getByRole('button', { name: /projetar/i }));
  return user;
}

describe('Previsão de caixa — leitura de tesouraria', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('separa o REALIZADO do PREVISTO e mostra o saldo projetado', async () => {
    stubForecast(forecastFixture());
    renderWithProviders(<CashForecastPage />);
    await project();

    await waitFor(() => {
      expect(screen.getByText(/realizado \(fato\)/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/previsto no horizonte/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/saldo projetado/i).length).toBeGreaterThan(0);
    // O saldo projetado veio do servidor, nao de soma local.
    expect(screen.getAllByText(/1\.500/).length).toBeGreaterThan(0);
  });

  it('declara horizonte, unidade e moeda do recorte consultado', async () => {
    stubForecast(forecastFixture());
    renderWithProviders(<CashForecastPage />);
    await project();

    await waitFor(() => {
      expect(screen.getByText('Horizonte até:')).toBeInTheDocument();
    });
    expect(screen.getByText('Unidade:')).toBeInTheDocument();
    expect(screen.getByText('Posição:')).toBeInTheDocument();
    expect(screen.getByText('Moeda:')).toBeInTheDocument();
  });

  it('mostra o risco somente quando existe título vencido de fato', async () => {
    stubForecast(
      forecastFixture({
        forecast: {
          inflows: '800.0000',
          outflows: '300.0000',
          overdueInflows: '250.0000',
          overdueOutflows: '0.0000',
          net: '500.0000',
        },
      }),
    );
    renderWithProviders(<CashForecastPage />);
    await project();

    await waitFor(() => {
      expect(screen.getByText(/títulos já vencidos/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/a receber vencido/i)).toBeInTheDocument();
  });

  it('nao inventa risco quando nao ha vencido', async () => {
    stubForecast(forecastFixture());
    renderWithProviders(<CashForecastPage />);
    await project();

    await waitFor(() => {
      expect(screen.getByText(/realizado \(fato\)/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/títulos já vencidos/i)).not.toBeInTheDocument();
  });

  it('usa rotulo humano nas linhas em vez da chave tecnica', () => {
    expect(cashForecastLineLabel('RECEIVABLE')).toBe('Recebível');
    expect(cashForecastLineLabel('PAYABLE')).toBe('Pagável');
    // Tipo desconhecido e mostrado como veio — nunca oculto.
    expect(cashForecastLineLabel('OUTRO')).toBe('OUTRO');
  });

  it('hasOverdueRisk so afirma risco com valor vencido maior que zero', () => {
    expect(hasOverdueRisk(forecastFixture())).toBe(false);
    expect(
      hasOverdueRisk(
        forecastFixture({
          forecast: {
            inflows: '0.0000',
            outflows: '0.0000',
            overdueInflows: '10.0000',
            overdueOutflows: '0.0000',
            net: '0.0000',
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasOverdueRisk(
        forecastFixture({
          forecast: {
            inflows: '0.0000',
            outflows: '0.0000',
            overdueInflows: '0.0000',
            overdueOutflows: '5.0000',
            net: '0.0000',
          },
        }),
      ),
    ).toBe(true);
  });

  it('fatos de contexto descrevem o recorte exato da projecao', () => {
    const fields = buildForecastContextFields(forecastFixture());
    const labels = fields.map((field) => field.label);
    expect(labels).toContain('Unidade');
    expect(labels).toContain('Horizonte até');
    expect(labels).toContain('Linhas devolvidas');
  });
});

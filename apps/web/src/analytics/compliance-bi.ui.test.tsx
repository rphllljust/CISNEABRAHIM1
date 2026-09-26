import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ComplianceBiPage } from './pages/ComplianceBiPage';

type SnapshotOverrides = {
  fiscalAvailable?: boolean;
  accountingAvailable?: boolean;
  taxAmount?: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function createComplianceFetchMock(overrides: SnapshotOverrides = {}) {
  const fiscalAvailable = overrides.fiscalAvailable ?? true;
  const accountingAvailable = overrides.accountingAvailable ?? true;
  const taxAmount = overrides.taxAmount === undefined ? '15.0000' : overrides.taxAmount;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/v1/auth/session')) {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          expiresAt: new Date().toISOString(),
          status: 'active',
        },
      });
    }
    if (url.includes('/api/v1/requests/service-requests/operational-units')) {
      return jsonResponse({ items: ['UN-DEV-001'] });
    }
    if (url.includes('/api/v1/authz/probe')) {
      return jsonResponse({ status: 'ok' });
    }
    if (url.includes('/api/v1/analytics/compliance')) {
      if (!fiscalAvailable && !accountingAvailable) {
        return jsonResponse({ error: { code: 'ANALYTICS_ACCESS_DENIED', message: 'Denied.' } }, 403);
      }
      return jsonResponse({
        generatedAt: '2026-09-25T12:00:00.000Z',
        businessTimezone: 'America/Porto_Velho',
        unitId: 'UN-DEV-001',
        period: { preset: 'month', from: '2026-09-01', to: '2026-09-25' },
        visibility: { fiscal: fiscalAvailable, accounting: accountingAvailable },
        fiscal: fiscalAvailable
          ? {
              available: true,
              metrics: [
                {
                  metricId: 'fiscal.documents_pending_transmission_count',
                  metricVersion: '1.0.0',
                  valueType: 'integer',
                  available: true,
                  value: 2,
                },
                {
                  metricId: 'fiscal.tax_obligations_open_count',
                  metricVersion: '1.0.0',
                  valueType: 'integer',
                  available: true,
                  value: 0,
                },
                {
                  metricId: 'fiscal.tax_obligations_open_amount',
                  metricVersion: '1.0.0',
                  valueType: 'decimal(18,4)',
                  available: taxAmount !== null,
                  value: taxAmount,
                },
              ],
            }
          : { available: false, metrics: [] },
        accounting: accountingAvailable
          ? {
              available: true,
              metrics: [
                {
                  metricId: 'accounting.periods_open_count',
                  metricVersion: '1.0.0',
                  valueType: 'integer',
                  available: true,
                  value: 1,
                },
                {
                  metricId: 'accounting.journal_entries_posted_count',
                  metricVersion: '1.0.0',
                  valueType: 'integer',
                  available: true,
                  value: 3,
                },
              ],
            }
          : { available: false, metrics: [] },
      });
    }
    return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
  });
}

function renderCompliance() {
  renderWithProviders(
    <Routes>
      <Route path="/app/reports/compliance" element={<ComplianceBiPage />} />
    </Routes>,
    { router: { initialEntries: ['/app/reports/compliance'] } },
  );
}

describe('Painel de conformidade fiscal e contábil (BI)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renderiza os indicadores enviados pelo servidor sem recalcular', async () => {
    vi.stubGlobal('fetch', createComplianceFetchMock());
    renderCompliance();
    await waitFor(() => {
      expect(
        screen.getByRole('table', { name: /indicadores de conformidade — fiscal/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('table', { name: /indicadores de conformidade — contábil/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/documentos fiscais sem autorização/i)).toBeInTheDocument();
    expect(screen.getByText(/15,00/)).toBeInTheDocument();
    // A unidade aparece no filtro (select) e no cabecalho do recorte consultado.
    expect(screen.getAllByText(/UN-DEV-001/).length).toBeGreaterThanOrEqual(2);
  });

  it('NAO_DATA != 0: valor nulo aparece como sem dados, nunca como zero', async () => {
    vi.stubGlobal('fetch', createComplianceFetchMock({ taxAmount: null }));
    renderCompliance();
    await waitFor(() => {
      expect(screen.getByText(/sem dados no período/i)).toBeInTheDocument();
    });
    // A contagem real da mesma tela continua sendo zero legitimo.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('bloco sem concessao fica indisponivel em vez de aparecer zerado', async () => {
    vi.stubGlobal('fetch', createComplianceFetchMock({ accountingAvailable: false }));
    renderCompliance();
    await waitFor(() => {
      expect(screen.getByText(/contábil indisponível/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('table', { name: /indicadores de conformidade — contábil/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: /indicadores de conformidade — fiscal/i }),
    ).toBeInTheDocument();
  });

  it('sem concessao fiscal nem contabil exibe a negacao do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      createComplianceFetchMock({ fiscalAvailable: false, accountingAvailable: false }),
    );
    renderCompliance();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/permiss/i);
    });
  });
});

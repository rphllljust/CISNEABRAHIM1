import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './pages/ReportsPage';
import type { ReportCatalogItem } from './types/reports.types';

const {
  getReportCatalog,
  previewReport,
  createReportExport,
  getReportExport,
  downloadReportExport,
  cancelReportExport,
} = vi.hoisted(() => ({
  getReportCatalog: vi.fn<typeof import('./api/reports-api').getReportCatalog>(),
  previewReport: vi.fn<typeof import('./api/reports-api').previewReport>(),
  createReportExport: vi.fn<typeof import('./api/reports-api').createReportExport>(),
  getReportExport: vi.fn<typeof import('./api/reports-api').getReportExport>(),
  downloadReportExport: vi.fn<typeof import('./api/reports-api').downloadReportExport>(),
  cancelReportExport: vi.fn<typeof import('./api/reports-api').cancelReportExport>(),
}));

vi.mock('./api/reports-api', () => ({
  getReportCatalog,
  previewReport,
  createReportExport,
  getReportExport,
  downloadReportExport,
  cancelReportExport,
  ReportsApiError: class ReportsApiError extends Error {
    kind = 'unknown';
  },
}));

const catalog: ReportCatalogItem[] = [
  {
    reportType: 'SERVICE_ORDERS_BY_PERIOD',
    label: 'OS por período',
    formats: ['CSV', 'XLSX'],
    allowedFilters: ['period', 'from', 'to', 'unitId'],
    sensitive: false,
    columns: ['Número OS', 'Cliente', 'Status'],
  },
];

const preview = {
  contract: {
    name: 'OS por período',
    filters: { period: 'month' },
    columns: ['Número OS', 'Cliente', 'Status'],
    sort: { field: 'createdAt', direction: 'DESC' as const },
    timezone: 'America/Porto_Velho',
    generatedAt: null,
    actor: { identityId: 'id-1', sessionId: 's-1' },
    scope: { summary: 'scoped' },
  },
  preview: [{ orderNumber: 'SO-001', clientName: 'Alfa', status: 'PREPARED' }],
  total: 1,
};

describe('ReportsPage', () => {
  beforeEach(() => {
    getReportCatalog.mockReset();
    previewReport.mockReset();
    createReportExport.mockReset();
    getReportExport.mockReset();
    downloadReportExport.mockReset();
    cancelReportExport.mockReset();

    getReportCatalog.mockResolvedValue(catalog);
    previewReport.mockResolvedValue(preview);
  });

  it('renders catalog, preview table and accessible landmarks', async () => {
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SO-001')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 1, name: /relatórios/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    // A previa e o conteudo principal da tela — nao um painel ao lado de um seletor.
    expect(
      screen.getByRole('region', { name: /pré-visualização do relatório/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/filtros do relatório/i)).toBeInTheDocument();
    expect(screen.getByText(/até 1 de 1 linhas/i)).toBeInTheDocument();
    expect(screen.getByText(/america\/porto_velho/i)).toBeInTheDocument();
  });

  /**
   * HUMANIZACAO NA PREVIA — o aceite da wave de convergencia.
   *
   * `PREPARED` e um enum do ciclo da OS. Antes ele chegava a tela cru, porque a celula passava por
   * `formatCell()` generico. A previa de relatorio e superficie de LEITURA: se o sistema ja sabe
   * traduzir o valor pelo dicionario do dominio dono, o enum nao pode aparecer.
   */
  it('apresenta status do dominio na forma humana, preservando o valor original', async () => {
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    const celula = await screen.findByText('Preparada');
    expect(celula).toBeInTheDocument();
    // O valor cru continua auditavel no title, nunca descartado.
    expect(celula).toHaveAttribute('title', 'Valor original: PREPARED');
    expect(screen.queryByText('PREPARED')).not.toBeInTheDocument();
  });

  /**
   * IDENTIFICADOR INTERNO DE UNIDADE — o operador lia `unit-synthetic-homolog`, um slug de
   * ambiente somado a codigo tecnico, apresentado como se fosse o nome da unidade. O contrato de
   * unidades nao publica nome humano (PARK_API_GAP), entao a coluna declara o ESCOPO.
   */
  it('não expõe identificador interno de unidade na prévia', async () => {
    previewReport.mockResolvedValue({
      ...preview,
      contract: { ...preview.contract, columns: ['Número OS', 'Unidade', 'Status'] },
      preview: [{ orderNumber: 'SO-002', unitId: 'unit-synthetic-homolog', status: 'COMPLETED' }],
    });

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No seu escopo')).toBeInTheDocument();
    expect(screen.queryByText(/unit-synthetic-homolog/)).not.toBeInTheDocument();
    // COMPLETED e o ciclo da OS: vem do mapa real do modulo de OS, nao de traducao inventada.
    expect(screen.getByText('Concluída')).toBeInTheDocument();
  });

  it('generates export and exposes download action', async () => {
    const user = userEvent.setup();
    createReportExport.mockResolvedValue({
      id: 'export-1',
      reportType: 'SERVICE_ORDERS_BY_PERIOD',
      format: 'CSV',
      status: 'COMPLETED',
      contract: preview.contract,
      rowCount: 1,
      fileSizeBytes: 200,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadReady: true,
    });

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await screen.findByText('SO-001');
    await user.click(screen.getByRole('button', { name: /gerar exportação/i }));

    await waitFor(() => {
      expect(createReportExport).toHaveBeenCalled();
    });
    expect(await screen.findByRole('button', { name: /baixar csv/i })).toBeInTheDocument();
    expect(screen.getByText(/concluída — 1 linhas/i)).toBeInTheDocument();
  });

  it('distinguishes an empty authorized catalog from permission denied', async () => {
    getReportCatalog.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Nenhum relatório disponível')).toBeInTheDocument();
    expect(screen.queryByText(/não tem permissão/i)).not.toBeInTheDocument();
  });

  it('uses the unitId from cross-module drilldown in the preview and export payload', async () => {
    const unitId = '11111111-1111-4111-8111-111111111111';
    createReportExport.mockResolvedValue({
      id: 'export-scoped',
      reportType: 'SERVICE_ORDERS_BY_PERIOD',
      format: 'CSV',
      status: 'COMPLETED',
      contract: { ...preview.contract, filters: { period: 'month', unitId } },
      rowCount: 1,
      fileSizeBytes: 200,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadReady: true,
    });

    render(
      <MemoryRouter initialEntries={[`/app/reports?unitId=${unitId}`]}>
        <ReportsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(previewReport).toHaveBeenCalledWith(
        'SERVICE_ORDERS_BY_PERIOD',
        expect.objectContaining({ unitId }),
        expect.any(AbortSignal),
      );
    });

    await userEvent.setup().click(screen.getByRole('button', { name: /gerar exportação/i }));
    await waitFor(() => {
      expect(createReportExport).toHaveBeenCalledWith(
        'SERVICE_ORDERS_BY_PERIOD',
        expect.objectContaining({ unitId }),
        'CSV',
      );
    });
  });

  it('distinguishes preview API failure from an empty dataset and supports a retry', async () => {
    previewReport.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(preview);
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Falha ao consultar a prévia deste relatório/)).toBeInTheDocument();
    expect(screen.queryByText('Nenhum dado para os filtros atuais')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('SO-001')).toBeInTheDocument();
  });

  it('selects XLSX and sends the actual format through the export command', async () => {
    const user = userEvent.setup();
    createReportExport.mockResolvedValue({
      id: 'export-xlsx',
      reportType: 'SERVICE_ORDERS_BY_PERIOD',
      format: 'XLSX',
      status: 'COMPLETED',
      contract: preview.contract,
      rowCount: 1,
      fileSizeBytes: 1294,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      downloadReady: true,
    });

    render(<MemoryRouter><ReportsPage /></MemoryRouter>);
    await screen.findByText('SO-001');

    await user.selectOptions(screen.getByLabelText('Formato'), 'XLSX');
    await user.click(screen.getByRole('button', { name: /gerar exportação/i }));

    await waitFor(() => {
      expect(createReportExport).toHaveBeenCalledWith(
        'SERVICE_ORDERS_BY_PERIOD',
        expect.any(Object),
        'XLSX',
      );
    });
    expect(await screen.findByRole('button', { name: /baixar xlsx/i })).toBeInTheDocument();
  });

  it('does not send incompatible period/unit filters to the report owner', async () => {
    getReportCatalog.mockResolvedValue([
      ...catalog,
      {
        reportType: 'FINANCIAL_AGING',
        label: 'Aging financeiro',
        formats: ['CSV', 'XLSX'],
        allowedFilters: [],
        sensitive: true,
        columns: ['Faixa', 'Quantidade', 'Valor'],
      },
    ]);
    render(<MemoryRouter initialEntries={['/app/reports?unitId=unit-from-drill']}><ReportsPage /></MemoryRouter>);
    await screen.findByText('SO-001');

    await userEvent.setup().selectOptions(screen.getByLabelText('Tipo'), 'FINANCIAL_AGING');
    await waitFor(() => {
      expect(previewReport).toHaveBeenCalledWith(
        'FINANCIAL_AGING',
        {},
        expect.any(AbortSignal),
      );
    });
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unidade')).not.toBeInTheDocument();
  });

});

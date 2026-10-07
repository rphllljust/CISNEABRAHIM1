import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhysicalAssetsListPage } from './PhysicalAssetsListPage';
import { ASSET_OPERATIONAL_AVAILABILITIES } from '../types/physical-asset.types';

const {
  mockListPhysicalAssets,
  mockGetPhysicalAssetSummary,
  mockGetPhysicalAsset,
  mockDeactivatePhysicalAsset,
  mockActivatePhysicalAsset,
} = vi.hoisted(() => ({
  mockListPhysicalAssets: vi.fn(),
  mockGetPhysicalAssetSummary: vi.fn(),
  mockGetPhysicalAsset: vi.fn(),
  mockDeactivatePhysicalAsset: vi.fn(),
  mockActivatePhysicalAsset: vi.fn(),
}));

vi.mock('../hooks/useAssetCapabilities', () => ({
  useAssetCapabilities: () => ({
    capabilities: {
      canCreate: true,
      canList: true,
      canRead: true,
      canUpdate: true,
      canDeactivate: true,
      canActivate: true,
    },
    loading: false,
    error: false,
  }),
  useAssetResourceTypes: () => ({
    resourceTypes: [
      { id: 'truck', code: 'TRUCK', name: 'Caminhão', classification: 'VEHICLE', status: 'ACTIVE' },
    ],
    loading: false,
    error: false,
  }),
}));

vi.mock('../api/physical-assets-api', () => ({
  /* A tela trata `AssetsApiError` no caminho de erro: o dublê precisa publicar a classe. */
  AssetsApiError: class AssetsApiError extends Error {},
  listPhysicalAssets: mockListPhysicalAssets,
  getPhysicalAssetSummary: mockGetPhysicalAssetSummary,
  getPhysicalAsset: mockGetPhysicalAsset,
  deactivatePhysicalAsset: mockDeactivatePhysicalAsset,
  activatePhysicalAsset: mockActivatePhysicalAsset,
}));

function mockListSuccess(
  items: Array<Record<string, unknown>>,
  options?: { total?: number; summary?: Record<string, number> },
) {
  mockGetPhysicalAssetSummary.mockResolvedValue(
    options?.summary ?? { total: items.length, available: 0, allocated: items.length, unavailable: 0 },
  );
  mockListPhysicalAssets.mockResolvedValue({
    items,
    limit: 20,
    offset: 0,
    total: options?.total ?? items.length,
  });
  /*
   * O DETALHE responde pelo mesmo registro que a grade entregou. Sem isso, abrir o contexto num
   * teste que nao declarou o detalhe mediria um painel alimentado por `undefined`.
   */
  mockGetPhysicalAsset.mockImplementation((id: string) =>
    Promise.resolve(items.find((item) => item['id'] === id) ?? items[0]),
  );
}

const allocatedItem = {
  id: 'asset-1',
  assetCode: 'TRK-001',
  resourceTypeId: 'truck',
  resourceTypeCode: 'TRUCK',
  resourceTypeClassification: 'VEHICLE',
  name: 'Caminhao pipa',
  lifecycleStatus: 'ACTIVE',
  allocationStatus: 'ALLOCATED',
  unitId: 'unit-a',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deactivatedAt: null,
  vehicle: { plate: 'ABC-1234', chassis: null, model: null },
  currentAllocation: {
    serviceOrderId: 'so-1',
    orderNumber: 'OS-2026-0001',
  },
};

describe('PhysicalAssetsListPage', () => {
  beforeEach(() => {
    mockListPhysicalAssets.mockReset();
    mockGetPhysicalAssetSummary.mockReset();
    mockGetPhysicalAsset.mockReset();
    mockDeactivatePhysicalAsset.mockReset();
    mockActivatePhysicalAsset.mockReset();
  });

  it('renders operational availability with service order and summary strip', async () => {
    mockListSuccess([allocatedItem], {
      summary: { total: 2, available: 1, allocated: 1, unavailable: 0 },
    });

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'TRK-001' })).toBeInTheDocument();
    expect(screen.getByLabelText(/disponibilidade operacional: alocado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OS-2026-0001' })).toHaveAttribute(
      'href',
      '/app/service-orders/so-1/planning',
    );
    expect(screen.getByRole('button', { name: 'Filtrar ativos disponíveis' })).toHaveTextContent(
      '1',
    );
    expect(screen.getByText('1–1 de 1 ativos')).toBeInTheDocument();
  });

  it('keeps row actions out of the grade and offers the real command in the context region', async () => {
    const user = userEvent.setup();
    mockListSuccess([allocatedItem]);
    mockGetPhysicalAsset.mockResolvedValue(allocatedItem);

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'TRK-001' });

    /*
     * A GRADE NAO REPETE MENU DE ACOES POR LINHA.
     *
     * Os tres itens do antigo menu `···` eram `navigate(...)`: navegacao vestida de acao, repetida
     * em toda linha, e o drillback para a ficha ja existia como link real no codigo do ativo.
     * Enquanto isso, os comandos que o contrato PUBLICA nao apareciam em lugar nenhum da tela.
     */
    expect(screen.queryByRole('button', { name: 'Ações para TRK-001' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument();

    /* O CONTEXTO le o DETALHE e oferece o comando do estado publicado (ativo -> inativar). */
    await user.click(screen.getByText('Caminhao pipa'));

    expect(await screen.findByRole('button', { name: 'Inativar ativo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir ficha completa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar ativo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Histórico e alocações' })).toBeInTheDocument();
    expect(mockGetPhysicalAsset).toHaveBeenCalledWith('asset-1', expect.anything());
  });

  it('offers reactivation only for an inactive asset — o comando segue o estado publicado', async () => {
    const user = userEvent.setup();
    const inactive = {
      ...allocatedItem,
      lifecycleStatus: 'INACTIVE',
      allocationStatus: 'AVAILABLE',
      currentAllocation: null,
    };
    mockListSuccess([inactive]);
    mockGetPhysicalAsset.mockResolvedValue(inactive);

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'TRK-001' });
    await user.click(screen.getByText('Caminhao pipa'));

    expect(await screen.findByRole('button', { name: 'Reativar ativo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inativar ativo' })).not.toBeInTheDocument();
    /* Sem alocacao corrente, o drillback de historico nao e oferecido — nao se inventa alvo. */
    expect(screen.queryByRole('button', { name: 'Histórico e alocações' })).not.toBeInTheDocument();
  });

  it('shows registered empty state when there are no assets', async () => {
    mockListSuccess([], { total: 0, summary: { total: 0, available: 0, allocated: 0, unavailable: 0 } });

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Nenhum ativo cadastrado.')).toBeInTheDocument();
  });

  it('shows filtered empty state after applying availability filter', async () => {
    const user = userEvent.setup();
    mockGetPhysicalAssetSummary.mockResolvedValue({
      total: 1,
      available: 0,
      allocated: 1,
      unavailable: 0,
    });
    mockListPhysicalAssets
      .mockResolvedValueOnce({
        items: [allocatedItem],
        limit: 20,
        offset: 0,
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [],
        limit: 20,
        offset: 0,
        total: 0,
      });

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'TRK-001' });
    await user.selectOptions(
      screen.getByLabelText('Disponibilidade'),
      ASSET_OPERATIONAL_AVAILABILITIES.Unavailable,
    );

    expect(
      await screen.findByText('Nenhum ativo encontrado para os filtros selecionados.'),
    ).toBeInTheDocument();
  });

  it('requests availability filter from backend when summary metric is selected', async () => {
    const user = userEvent.setup();
    mockListSuccess([allocatedItem]);

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'TRK-001' });
    await user.click(screen.getByRole('button', { name: 'Filtrar ativos alocados' }));

    await vi.waitFor(() => {
      expect(mockListPhysicalAssets).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availability: ASSET_OPERATIONAL_AVAILABILITIES.Allocated,
        }),
        expect.anything(),
      );
    });
  });

  it('shows unavailable operational detail for inactive assets', async () => {
    mockListSuccess([
      {
        ...allocatedItem,
        assetCode: 'TRK-INA',
        lifecycleStatus: 'INACTIVE',
        allocationStatus: 'AVAILABLE',
        currentAllocation: null,
      },
    ]);

    render(
      <MemoryRouter>
        <PhysicalAssetsListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Cadastro inativo')).toBeInTheDocument();
    expect(screen.getByLabelText(/disponibilidade operacional: indispon/i)).toBeInTheDocument();
  });
});

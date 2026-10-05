import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetListPage } from './FleetListPage';

const { mockListFleetVehicles, mockGetFleetSummary } = vi.hoisted(() => ({
  mockListFleetVehicles: vi.fn(),
  mockGetFleetSummary: vi.fn(),
}));

vi.mock('../../assets/hooks/useAssetCapabilities', () => ({
  useAssetCapabilities: () => ({
    capabilities: { canCreate: true, canList: true, canRead: true, canUpdate: true },
    loading: false,
    error: false,
  }),
  useAssetResourceTypes: () => ({
    resourceTypes: [
      { id: 'truck', code: 'TRUCK', name: 'Caminhao', classification: 'VEHICLE', status: 'ACTIVE' },
      { id: 'exc', code: 'EXCAVATOR', name: 'Escavadeira', classification: 'MACHINE', status: 'ACTIVE' },
    ],
    loading: false,
    error: false,
  }),
}));

vi.mock('../api/fleet-api', () => ({
  listFleetVehicles: mockListFleetVehicles,
  getFleetSummary: mockGetFleetSummary,
}));

const vehicleItem = {
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

describe('FleetListPage', () => {
  beforeEach(() => {
    mockListFleetVehicles.mockReset();
    mockGetFleetSummary.mockReset();
    mockGetFleetSummary.mockResolvedValue({
      total: 1,
      available: 0,
      allocated: 1,
      unavailable: 0,
    });
    mockListFleetVehicles.mockResolvedValue({
      items: [vehicleItem],
      limit: 20,
      offset: 0,
      total: 1,
    });
  });

  it('renders fleet view with plate and operational availability', async () => {
    render(
      <MemoryRouter>
        <FleetListPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'TRK-001' })).toBeInTheDocument();
    // A placa tem coluna propria (primeira classe na frota) e continua legivel.
    expect(screen.getByText(/ABC-1234/)).toBeInTheDocument();
    expect(screen.getByLabelText(/disponibilidade operacional: alocado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OS-2026-0001' })).toHaveAttribute(
      'href',
      '/app/service-orders/so-1/planning',
    );
  });

  it('shows empty state when the fleet has no vehicles', async () => {
    mockListFleetVehicles.mockResolvedValue({
      items: [],
      limit: 20,
      offset: 0,
      total: 0,
    });
    mockGetFleetSummary.mockResolvedValue({
      total: 0,
      available: 0,
      allocated: 0,
      unavailable: 0,
    });
    render(
      <MemoryRouter>
        <FleetListPage />
      </MemoryRouter>,
    );
    // O estado vazio usa a MESMA moldura das demais worklists (`WorklistStatePanel`), cujo
    // titulo e um paragrafo de status — nao um heading. A assercao e por texto, como nas listas
    // ja convergidas (Clientes, Solicitações, Propostas, Pedidos, Contratos, Catálogo).
    expect(
      await screen.findByText('Nenhum veículo cadastrado na frota.'),
    ).toBeInTheDocument();
    // O estado vazio declara o que é a frota e por onde começar — mesma gramática operacional
    // das demais worklists. O "Novo veículo" do cabeçalho já cobre a ação de criação.
    expect(
      screen.getByText(/A frota é a visão operacional sobre os ativos físicos de veículo/i),
    ).toBeInTheDocument();
  });
});
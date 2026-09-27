import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssetForm, type AssetFormProps } from './AssetForm';
import { VEHICLE_CLASSIFICATION } from '../types/physical-asset.types';
import { ASSET_LIFECYCLE_STATUSES, ASSET_ALLOCATION_STATUSES } from '../types/physical-asset.types';

const RESOURCE_TYPES = [
  {
    id: 'truck',
    code: 'TRUCK',
    name: 'Caminhão',
    classification: VEHICLE_CLASSIFICATION,
    status: 'ACTIVE',
  },
  {
    id: 'exc',
    code: 'EXCAVATOR',
    name: 'Escavadeira',
    classification: 'MACHINE',
    status: 'ACTIVE',
  },
];

const OPERATIONAL_UNITS = ['unit-a'];

/**
 * O contrato estruturado mudou a MOLDURA do formulário, não os fatos: os campos de veículo
 * continuam condicionados ao tipo de recurso, os rótulos acessíveis continuam existindo e o
 * resumo mostra apenas fatos da própria edição.
 */
function renderForm(overrides: Partial<AssetFormProps> = {}) {
  const base: AssetFormProps = {
    mode: 'create',
    values: {
      assetCode: '',
      resourceTypeId: '',
      name: '',
      unitId: '',
      plate: '',
      chassis: '',
      model: '',
    },
    resourceTypes: RESOURCE_TYPES,
    resourceTypesLoading: false,
    operationalUnits: OPERATIONAL_UNITS,
    fieldErrors: {},
    submitError: null,
    submitting: false,
    onChange: vi.fn(),
    onSubmit: (event) => event.preventDefault(),
    cancelHref: '/app/assets',
  };

  return render(
    <MemoryRouter>
      <AssetForm {...base} {...overrides} />
    </MemoryRouter>,
  );
}

describe('AssetForm', () => {
  it('shows vehicle fields only when vehicle resource type is selected', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AssetForm
          mode="create"
          values={{
            assetCode: '',
            resourceTypeId: 'exc',
            name: '',
            unitId: '',
            plate: '',
            chassis: '',
            model: '',
          }}
          resourceTypes={RESOURCE_TYPES}
          resourceTypesLoading={false}
          operationalUnits={OPERATIONAL_UNITS}
          fieldErrors={{}}
          submitError={null}
          submitting={false}
          onChange={() => undefined}
          onSubmit={(event) => event.preventDefault()}
          cancelHref="/app/assets"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText(/placa/i)).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <AssetForm
          mode="create"
          values={{
            assetCode: '',
            resourceTypeId: 'truck',
            name: '',
            unitId: '',
            plate: '',
            chassis: '',
            model: '',
          }}
          resourceTypes={RESOURCE_TYPES}
          resourceTypesLoading={false}
          operationalUnits={OPERATIONAL_UNITS}
          fieldErrors={{}}
          submitError={null}
          submitting={false}
          onChange={() => undefined}
          onSubmit={(event) => event.preventDefault()}
          cancelHref="/app/assets"
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/placa/i)).toBeInTheDocument();
  });

  it('exposes accessible labels for core fields', () => {
    renderForm({
      values: {
        assetCode: 'TRK-1',
        resourceTypeId: 'truck',
        name: 'Caminhão',
        unitId: 'unit-a',
        plate: 'ABC-1234',
        chassis: '',
        model: '',
      },
    });

    expect(screen.getByLabelText(/código do ativo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nome \/ descrição/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/placa/i)).toBeInTheDocument();
  });

  it('organiza o cadastro em seções de negócio', () => {
    renderForm();

    expect(screen.getByRole('region', { name: 'Identificação' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Classificação' })).toBeInTheDocument();
  });

  it('resume a própria edição sem inventar fato que não existe', () => {
    renderForm({
      values: {
        assetCode: 'TRK-1',
        resourceTypeId: 'truck',
        name: 'Caminhão',
        unitId: 'unit-a',
        plate: 'ABC-1234',
        chassis: '',
        model: '',
      },
    });

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(summary).toHaveTextContent('TRK-1');
    expect(summary).toHaveTextContent('Caminhão (TRUCK)');
    expect(summary).toHaveTextContent('unit-a');
    // Cadastro não tem situação nem disponibilidade: elas não aparecem no resumo.
    expect(summary).not.toHaveTextContent('Situação');
  });

  it('mostra situação e disponibilidade persistidas na edição', () => {
    renderForm({
      mode: 'edit',
      asset: {
        id: 'asset-1',
        assetCode: 'TRK-1',
        resourceTypeId: 'truck',
        resourceTypeCode: 'TRUCK',
        resourceTypeClassification: VEHICLE_CLASSIFICATION,
        name: 'Caminhão',
        lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
        allocationStatus: ASSET_ALLOCATION_STATUSES.Allocated,
        unitId: 'unit-a',
        version: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deactivatedAt: null,
        vehicle: { plate: 'ABC-1234', chassis: null, model: null },
        currentAllocation: { serviceOrderId: 'so-1', orderNumber: 'OS-2026-0001' },
      },
      values: {
        assetCode: 'TRK-1',
        resourceTypeId: 'truck',
        name: 'Caminhão',
        unitId: 'unit-a',
        plate: 'ABC-1234',
        chassis: '',
        model: '',
      },
    });

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(summary).toHaveTextContent('Ativo');
    const availability = screen.getByRole('region', { name: 'Disponibilidade' });
    expect(availability).toHaveTextContent('Alocado');
    expect(availability).toHaveTextContent('OS-2026-0001');
  });
});

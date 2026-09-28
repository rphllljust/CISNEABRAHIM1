import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceDefinitionForm } from './ServiceDefinitionForm';
import { createEmptyFormState } from '../utils/catalog-form-state';

const referenceData = {
  categories: [],
  units: [
    { id: '1', code: 'DAY', name: 'Dia', status: 'ACTIVE' },
    { id: '2', code: 'KM', name: 'Quilômetro', status: 'ACTIVE' },
  ],
  resourceTypes: [{ id: '1', code: 'TRUCK', name: 'Caminhão', status: 'ACTIVE' }],
  laborTypes: [{ id: '1', code: 'DRIVER', name: 'Motorista', status: 'ACTIVE' }],
  // O endpoint real de políticas não devolve `label`: o rótulo humano vem do vocabulário do catálogo.
  pricingModels: [{ code: 'DAILY' }, { code: 'PER_KM' }],
  measurementModels: [{ code: 'TIME' }],
};

/** Códigos INTERNOS: nenhum deles pode aparecer como texto na tela do operador. */
const INTERNAL_CODES = [
  'BY_PERIOD',
  'BY_QUANTITY',
  'BY_EVENT',
  'CHECKLIST',
  'UNIT',
  'TIME',
  'DISTANCE',
  'VOLUME',
  'WEIGHT',
  'TRIP',
  'GLOBAL_COMPLETION',
  'MEASUREMENT_APPROVED',
  'FIXED_PRICE',
  'PERIODIC',
  'MILESTONE',
  'REQUIRED',
  'OPTIONAL',
  'CONDITIONAL',
  'PHOTO',
  'DOCUMENT',
  'SIGNATURE',
  'START_TIME',
  'END_TIME',
  'LOCATION',
  'MILEAGE',
  'HOUR_METER',
  'RECEIPT',
  'OBSERVATION',
  'WHEN_MEASUREMENT_BASIS_IS',
  'WHEN_ARCHETYPE_IS',
  'WHEN_RESOURCE_TYPE_IS',
  'WHEN_LABOR_TYPE_IS',
  'GLOBAL_PRICE',
  'UNIT_PRICE',
  'HOURLY',
  'DAILY',
  'MONTHLY',
  'PER_TRIP',
  'PER_KM',
  'PER_M3',
  'NEGOTIATED_PO_PRICE',
  'RENTAL',
  'TRUCK',
  'DRIVER',
  'DAY',
  'KM',
];

function expectNoInternalCodeOnScreen() {
  const rendered = document.body.textContent ?? '';
  for (const code of INTERNAL_CODES) {
    expect(rendered).not.toContain(code);
  }
}

function renderForm(state = createEmptyFormState()) {
  return render(
    <ServiceDefinitionForm
      formId="catalog-form"
      state={state}
      errors={{}}
      referenceData={referenceData}
      includeCode
      onChange={() => undefined}
    />,
  );
}

describe('ServiceDefinitionForm accessibility', () => {
  it('exposes labeled sections for structured configuration', () => {
    renderForm();

    expect(screen.getByRole('heading', { name: /identificação/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /medição/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /modelos de preço/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^código da definição/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^nome/i)).toBeInTheDocument();
  });

  it('resume a edição atual antes das seções, sem indicador inventado', () => {
    renderForm();

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Locação')).toBeInTheDocument();
    expect(within(summary).getByText('1 modelo de preço')).toBeInTheDocument();
    expect(within(summary).getByText('0 recursos físicos')).toBeInTheDocument();
    expect(within(summary).getByText('0 requisitos de mão de obra')).toBeInTheDocument();
    expect(within(summary).getByText('0 requisitos de evidência')).toBeInTheDocument();
  });

  it('cada repetidor tem ação na própria seção, remoção discreta e nenhum "Adicionar" solto', () => {
    renderForm();

    expect(screen.getByRole('button', { name: '+ Adicionar unidade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Adicionar modelo de preço' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Adicionar recurso físico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Adicionar mão de obra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Adicionar evidência' })).toBeInTheDocument();

    // Remover é ação secundária com nome acessível explícito — nunca um botão azul "Remover".
    const remove = screen.getByRole('button', { name: 'Remover o modelo de preço 1' });
    expect(remove).toHaveTextContent('Remover');
    expect(remove.className).not.toMatch(/bg-brand-600/);

    // O "Adicionar" solto no meio do card não existe mais com esse nome.
    expect(screen.queryByRole('button', { name: /^adicionar$/i })).not.toBeInTheDocument();
  });

  it('campo monetário usa CurrencyField: valor normalizado vira BRL em repouso', () => {
    const state = createEmptyFormState();
    renderForm({
      ...state,
      pricingModels: [
        {
          modelCode: 'DAILY',
          unitCode: 'DAY',
          salePrice: '1500.50',
          internalCost: null,
          currencyCode: 'BRL',
          sortOrder: 0,
        },
      ],
    });

    const price = screen.getByLabelText('Preço de venda');
    expect((price as HTMLInputElement).value.replace(/\u00a0/g, ' ')).toBe('R$ 1.500,50');
  });

  it('não renderiza custo interno sem autorização explícita da tela', () => {
    renderForm();

    expect(screen.queryByLabelText('Custo interno')).not.toBeInTheDocument();
  });

  it('renderiza custo interno quando a tela autoriza o editor', () => {
    render(
      <ServiceDefinitionForm
        formId="catalog-form"
        state={createEmptyFormState()}
        errors={{}}
        referenceData={referenceData}
        includeCode
        showInternalCost
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Custo interno')).toBeInTheDocument();
  });

  it('abre a linha de requisito já com o contexto real do domínio', () => {
    const state = createEmptyFormState();
    renderForm({
      ...state,
      resourceRequirements: [
        { resourceTypeCode: 'TRUCK', requirementLevel: 'REQUIRED', minQuantity: 2, sortOrder: 0 },
      ],
      laborRequirements: [
        { laborTypeCode: 'DRIVER', requirementLevel: 'OPTIONAL', minQuantity: 1, sortOrder: 0 },
      ],
    });

    expect(screen.getByText(/Caminhão · Obrigatório · mín\. 2/)).toBeInTheDocument();
    expect(screen.getByText(/Motorista · Opcional · mín\. 1/)).toBeInTheDocument();

    const resourceSection = screen.getByRole('region', {
      name: /requisitos de recurso físico/i,
    });
    // O rótulo é humano; o VALOR do campo continua sendo o código do payload.
    expect(within(resourceSection).getByLabelText('Tipo de recurso')).toHaveValue('TRUCK');
    expect(within(resourceSection).getByLabelText('Nível do recurso')).toHaveValue('REQUIRED');
    expect(within(resourceSection).getByLabelText('Quantidade mínima')).toHaveValue(2);
    expectNoInternalCodeOnScreen();
  });

  it('mostra rótulo humano nos vocabulários, mantendo o código como valor', () => {
    renderForm();

    const mode = screen.getByLabelText<HTMLSelectElement>('Modo de medição');
    expect(mode).toHaveValue('BY_PERIOD');
    expect(mode.selectedOptions[0]?.textContent).toBe('Por período');

    const basis = screen.getByLabelText<HTMLSelectElement>('Base de medição');
    expect(basis).toHaveValue('TIME');
    expect(basis.selectedOptions[0]?.textContent).toBe('Tempo');

    const policy = screen.getByLabelText<HTMLSelectElement>('Política de faturamento');
    expect(policy).toHaveValue('MEASUREMENT_APPROVED');
    expect(policy.selectedOptions[0]?.textContent).toBe('Após medição aprovada');

    // Unidade: o operador lê "Dia", nunca "DAY — Dia".
    const defaultUnit = screen.getByLabelText<HTMLSelectElement>('Unidade padrão');
    expect(within(defaultUnit).getByRole('option', { name: 'Dia' })).toBeInTheDocument();
    expect(within(defaultUnit).queryByRole('option', { name: /DAY/ })).not.toBeInTheDocument();

    // Modelo de preço: rótulo humano, valor comercial preservado.
    const pricingModel = screen.getByLabelText<HTMLSelectElement>('Modelo');
    expect(pricingModel).toHaveValue('DAILY');
    expect(pricingModel.selectedOptions[0]?.textContent).toBe('Diário');

    expectNoInternalCodeOnScreen();
  });
});

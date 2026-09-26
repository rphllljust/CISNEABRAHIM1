import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceDefinitionForm } from './ServiceDefinitionForm';
import { createEmptyFormState } from '../utils/catalog-form-state';

const referenceData = {
  categories: [],
  units: [{ id: '1', code: 'DAY', name: 'Dia', status: 'ACTIVE' }],
  resourceTypes: [{ id: '1', code: 'TRUCK', name: 'Caminhão', status: 'ACTIVE' }],
  laborTypes: [{ id: '1', code: 'DRIVER', name: 'Motorista', status: 'ACTIVE' }],
  pricingModels: [{ code: 'DAILY', label: 'DAILY' }],
  measurementModels: [{ code: 'TIME', label: 'TIME' }],
};

describe('ServiceDefinitionForm accessibility', () => {
  it('exposes labeled sections for structured configuration', () => {
    render(
      <ServiceDefinitionForm
        formId="catalog-form"
        state={createEmptyFormState()}
        errors={{}}
        referenceData={referenceData}
        includeCode
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: /identificação/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /medição/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /modelos de preço/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^código da definição$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument();
  });
});

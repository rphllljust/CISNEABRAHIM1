import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { TaxAssessmentsPage } from './TaxAssessmentsPage';

const { mockListTaxAssessments, mockScope } = vi.hoisted(() => ({
  mockListTaxAssessments: vi.fn(),
  mockScope: { unitId: 'unit-1' },
}));

vi.mock('../hooks/useFiscalUnits', () => ({
  useFiscalUnits: () => ({
    units: [],
    options: [],
    unitId: mockScope.unitId,
    setUnitId: vi.fn(),
  }),
}));

vi.mock('../api/fiscal-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/fiscal-api')>()),
  listTaxAssessments: mockListTaxAssessments,
}));

function renderList() {
  renderWithProviders(
    <Routes>
      <Route path="/app/fiscal/assessments" element={<TaxAssessmentsPage />} />
    </Routes>,
    { router: { initialEntries: ['/app/fiscal/assessments'] } },
  );
}

describe('obrigações tributárias — escopo e concorrência', () => {
  beforeEach(() => {
    mockListTaxAssessments.mockReset();
    mockScope.unitId = 'unit-1';
  });

  it('não declara zero obrigações se nenhuma unidade foi selecionada', async () => {
    mockScope.unitId = '';
    renderList();

    expect(await screen.findByText('Selecione uma unidade operacional')).toBeInTheDocument();
    expect(screen.getByText(/ainda não existe total conhecido/i)).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma apuração')).not.toBeInTheDocument();
    expect(mockListTaxAssessments).not.toHaveBeenCalled();
  });

  it('descarta resposta antiga quando situação muda mesmo se a API ignora abort', async () => {
    let resolveOld: ((value: { items: never[]; total: number; page: number }) => void) | undefined;
    mockListTaxAssessments.mockImplementation((filters: { status?: string }) => {
      if (filters.status === 'FINALIZED') {
        return Promise.resolve({ items: [], total: 0, page: 0 });
      }
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });

    renderList();
    await waitFor(() => expect(resolveOld).toBeDefined());

    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'FINALIZED' } });
    expect(await screen.findByText('Nenhuma apuração para o recorte atual')).toBeInTheDocument();

    await act(async () => {
      resolveOld?.({ items: [], total: 7, page: 0 });
    });

    expect(screen.getByText('Nenhuma apuração para o recorte atual')).toBeInTheDocument();
    expect(screen.queryByText('7 apuração(ões) no recorte')).not.toBeInTheDocument();
  });

  it('descarta erro antigo após o recorte novo ser carregado', async () => {
    let rejectOld: ((reason: Error) => void) | undefined;
    mockListTaxAssessments.mockImplementation((filters: { status?: string }) => {
      if (filters.status === 'DRAFT') {
        return Promise.resolve({ items: [], total: 0, page: 0 });
      }
      return new Promise((_resolve, reject) => {
        rejectOld = reject;
      });
    });

    renderList();
    await waitFor(() => expect(rejectOld).toBeDefined());

    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'DRAFT' } });
    expect(await screen.findByText('Nenhuma apuração para o recorte atual')).toBeInTheDocument();

    await act(async () => {
      rejectOld?.(new Error('Resposta obsoleta da consulta anterior'));
    });

    expect(screen.getByText('Nenhuma apuração para o recorte atual')).toBeInTheDocument();
    expect(screen.queryByText('Resposta obsoleta da consulta anterior')).not.toBeInTheDocument();
  });
});

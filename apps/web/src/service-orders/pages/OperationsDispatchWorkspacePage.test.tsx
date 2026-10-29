import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { OperationsDispatchWorkspacePage } from './OperationsDispatchWorkspacePage';
import { OperationsApiError, listOperationUnitOptions } from '../api/operations-api';

vi.mock('../api/operations-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/operations-api')>();
  return { ...real, listOperationUnitOptions: vi.fn() };
});
vi.mock('../components/OperationalUnitGovernance', () => ({
  OperationalUnitGovernance: () => null,
}));
vi.mock('./DispatchBoardPage', () => ({
  DispatchBoardPage: ({ unitId }: { unitId: string | null }) =>
    <div data-testid="dispatch-active-unit">{unitId}</div>,
}));
vi.mock('./ExecutionConsolePage', () => ({
  ExecutionConsolePage: ({ unitId }: { unitId: string | null }) =>
    <div data-testid="execution-active-unit">{unitId}</div>,
}));

function mount() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/operations" element={<OperationsDispatchWorkspacePage />} />
    </Routes>,
    { router: { initialEntries: ['/app/operations'] } },
  );
}

describe('Enterprise dispatch unit discovery', () => {
  beforeEach(() => vi.mocked(listOperationUnitOptions).mockReset());

  it('shows authorized names/codes without service orders and preserves the internal contract value', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a', 'unit-b'],
      details: [
        { id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true },
        { id: 'unit-b', code: 'GUA', name: 'Guajará-Mirim', configured: true },
      ],
    });
    mount();
    const select = await screen.findByRole('combobox', { name: 'Unidade operacional' });
    const choices = within(select).getAllByRole('option');
    expect(choices.map(option => option.textContent)).toEqual(['Porto Velho · PVH', 'Guajará-Mirim · GUA']);
    expect(choices.map(option => (option as HTMLOptionElement).value)).toEqual(['unit-a', 'unit-b']);
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a');
    await userEvent.setup().selectOptions(select, 'unit-b');
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-b');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Execução' }));
    expect(screen.getByTestId('execution-active-unit')).toHaveTextContent('unit-b');
  });

  it('separates absence of authorization from absence of operational orders', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({ items: [], details: [] });
    mount();
    expect(await screen.findByText('Nenhuma unidade autorizada para consulta')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-active-unit')).not.toBeInTheDocument();
  });

  it('never maps access denied into a blank worklist', async () => {
    vi.mocked(listOperationUnitOptions).mockRejectedValue(
      new OperationsApiError(403, 'SERVICE_ORDERS_DENIED', 'denied'),
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Acesso negado');
    expect(screen.queryByText('Nenhuma unidade autorizada para consulta')).not.toBeInTheDocument();
  });

  it('distinguishes offline failure and allows retry without dropping capabilities on a narrow viewport', async () => {
    vi.mocked(listOperationUnitOptions)
      .mockRejectedValueOnce(new OperationsApiError(0, undefined, 'network'))
      .mockResolvedValueOnce({
        items: ['unit-a'],
        details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
      });
    const oldWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent('indisponível');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await waitFor(() => expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a'));
      expect(screen.getByRole('combobox', { name: 'Unidade operacional' })).toHaveValue('unit-a');
      expect(screen.getByRole('button', { name: 'Execução' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
    }
  });
});

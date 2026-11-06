import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { DispatchBoardPage } from './DispatchBoardPage';
import { ExecutionConsolePage } from './ExecutionConsolePage';
import { getDispatchBoard, getExecutionConsole } from '../api/operations-api';

vi.mock('../api/operations-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/operations-api')>();
  return { ...real, getDispatchBoard: vi.fn(), getExecutionConsole: vi.fn() };
});

describe('lote 04 — ausência de unidade não é resultado zero do servidor', () => {
  it('despacho não fabrica contadores ou freshness sem unidade selecionada', async () => {
    renderWithProviders(<DispatchBoardPage unitId={null} />);
    await waitFor(() => expect(screen.getByText('Nenhuma unidade selecionada')).toBeInTheDocument());
    expect(getDispatchBoard).not.toHaveBeenCalled();
    expect(screen.queryByText('Nenhuma ordem bloqueada')).not.toBeInTheDocument();
  });

  it('execução não apresenta fila vazia como consulta confirmada sem unidade', async () => {
    renderWithProviders(<ExecutionConsolePage unitId={null} />);
    await waitFor(() => expect(screen.getByText('Nenhuma unidade selecionada')).toBeInTheDocument());
    expect(getExecutionConsole).not.toHaveBeenCalled();
    expect(screen.queryByText('Nenhuma execução atrasada')).not.toBeInTheDocument();
  });
});

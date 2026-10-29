import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalUnitGovernance } from './OperationalUnitGovernance';
import {
  createGovernedUnit, listGovernedUnits, readGovernedUnitHistory,
  UnitGovernanceError, updateGovernedUnit,
} from '../api/unit-governance-api';

vi.mock('../api/unit-governance-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/unit-governance-api')>();
  return {
    ...actual,
    createGovernedUnit: vi.fn(), listGovernedUnits: vi.fn(),
    updateGovernedUnit: vi.fn(), readGovernedUnitHistory: vi.fn(),
  };
});

const unit = { id: 'unit-a', code: 'PVH', name: 'Porto Velho', version: 2, canManage: true };

describe('Enterprise unit governance context', () => {
  beforeEach(() => {
    vi.mocked(createGovernedUnit).mockReset();
    vi.mocked(listGovernedUnits).mockReset();
    vi.mocked(updateGovernedUnit).mockReset();
    vi.mocked(readGovernedUnitHistory).mockReset();
  });

  it('exposes names and versions without exposing UUIDs or write commands to a read-only operator', async () => {
    vi.mocked(listGovernedUnits).mockResolvedValue({
      items: [{ ...unit, canManage: false }], canCreate: false,
    });
    render(<OperationalUnitGovernance onChanged={vi.fn()} />);
    const summary = await screen.findByText(/Contexto empresarial · Governança/);
    await userEvent.setup().click(summary);
    expect(screen.getByRole('button', { name: /Porto Velho · PVH/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cadastrar unidade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar identidade' })).not.toBeInTheDocument();
    expect(screen.getByText(/Consulta permitida/)).toBeInTheDocument();
    expect(screen.queryByText('unit-a')).not.toBeInTheDocument();
  });

  it('uses server version and permissions for an identity update', async () => {
    vi.mocked(listGovernedUnits).mockResolvedValue({ items: [unit], canCreate: true });
    vi.mocked(updateGovernedUnit).mockResolvedValue({ ...unit, name: 'Porto Velho Centro', version: 3 });
    const changed = vi.fn();
    render(<OperationalUnitGovernance onChanged={changed} />);
    await userEvent.setup().click(await screen.findByText(/Contexto empresarial · Governança/));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Editar cadastro' }));
    expect(screen.getByRole('textbox', { name: 'Código empresarial' })).toHaveValue('PVH');
    expect(screen.getByRole('textbox', { name: 'Nome empresarial' })).toHaveValue('Porto Velho');
    await userEvent.setup().clear(screen.getByRole('textbox', { name: 'Nome empresarial' }));
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Nome empresarial' }), 'Porto Velho Centro');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Atualizar identidade' }));
    await waitFor(() => expect(updateGovernedUnit).toHaveBeenCalledTimes(1));
    const updateRequest = vi.mocked(updateGovernedUnit).mock.calls[0];
    expect(updateRequest?.[0]).toBe('unit-a');
    expect(updateRequest?.[1]).toMatchObject({
      code: 'PVH', name: 'Porto Velho Centro', expectedVersion: 2,
    });
    expect(typeof updateRequest?.[1].idempotencyKey).toBe('string');
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it('reuses the idempotency key on a network retry and remains available on mobile', async () => {
    vi.mocked(listGovernedUnits).mockResolvedValue({ items: [], canCreate: true });
    vi.mocked(createGovernedUnit)
      .mockRejectedValueOnce(new UnitGovernanceError(0, 'NETWORK'))
      .mockResolvedValueOnce({ ...unit, version: 1 });
    const oldWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      render(<OperationalUnitGovernance onChanged={vi.fn()} />);
      await userEvent.setup().click(await screen.findByText(/Contexto empresarial · Governança/));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cadastrar unidade' }));
      await userEvent.setup().type(screen.getByRole('textbox', { name: 'Código empresarial' }), 'PVH');
      await userEvent.setup().type(screen.getByRole('textbox', { name: 'Nome empresarial' }), 'Porto Velho');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Registrar unidade' }));
      expect(await screen.findByText(/Falha de rede/)).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Registrar unidade' }));
      await waitFor(() => expect(createGovernedUnit).toHaveBeenCalledTimes(2));
      const calls = vi.mocked(createGovernedUnit).mock.calls;
      expect(calls[0]?.[0].idempotencyKey).toBe(calls[1]?.[0].idempotencyKey);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
    }
  });

  it('completes an authorized legacy unit identity without inventing a second technical unit', async () => {
    vi.mocked(listGovernedUnits).mockResolvedValue({
      items: [], canCreate: true, unconfigured: ['UN-PROD-001'],
    });
    vi.mocked(createGovernedUnit).mockResolvedValue({
      id: 'UN-PROD-001', code: 'PVH', name: 'Porto Velho', version: 1,
    });
    render(<OperationalUnitGovernance onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByText(/Contexto empresarial · Governança/));
    expect(screen.queryByText('UN-PROD-001')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cadastrar identidade pendente 1' }));
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Código empresarial' }), 'PVH');
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Nome empresarial' }), 'Porto Velho');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Registrar unidade' }));
    await waitFor(() => expect(createGovernedUnit).toHaveBeenCalledWith(expect.objectContaining({
      refId: 'UN-PROD-001', code: 'PVH', name: 'Porto Velho',
    })));
  });

  it('loads the append-only audit trail without presenting technical actor identifiers', async () => {
    vi.mocked(listGovernedUnits).mockResolvedValue({ items: [unit], canCreate: false });
    vi.mocked(readGovernedUnitHistory).mockResolvedValue({
      unit, events: [{
        action: 'CREATED', version: 1, actorIdentityId: 'internal-user-id',
        occurredAt: '2026-10-28T14:00:00.000Z',
      }],
    });
    render(<OperationalUnitGovernance onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByText(/Contexto empresarial · Governança/));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Consultar histórico de identidade' }));
    expect(await screen.findByRole('list', { name: 'Histórico da unidade' })).toHaveTextContent('Cadastro · versão 1');
    expect(screen.queryByText('internal-user-id')).not.toBeInTheDocument();
  });
});

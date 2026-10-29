import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore, resetTokenStoreForTests } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { OperationalUnitsTab } from './pages/OperationalUnitsTab';

const UNIT = { id: 'unit-no-os', code: 'PVH', name: 'Porto Velho', version: 2, canManage: true };

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('enterprise organizational UNIT workbench', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    vi.unstubAllGlobals();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('shows business name/code, missing master situations and history on a responsive workspace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === '/api/v1/organization/operational-units') {
        return reply({ items: [UNIT], unconfigured: ['unit-without-identity'], canCreate: true });
      }
      if (pathname === '/api/v1/organization/operational-units/unit-no-os/history') {
        return reply({ unit: UNIT, events: [{
          version: 2, action: 'UPDATED', actorIdentityId: 'actor-1',
          occurredAt: '2026-10-20T10:00:00.000Z', oldValue: null, newValue: UNIT,
        }] });
      }
      return reply({ code: 'NOT_FOUND' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OperationalUnitsTab />);
    await screen.findByText('Unidades operacionais · Control Tower');
    expect(screen.getAllByText('Porto Velho').length).toBeGreaterThan(0);
    expect(screen.getByText('PVH · versão 2')).toBeInTheDocument();
    expect(screen.getByText(/Referências sem identidade:/)).toBeInTheDocument();
    expect(await screen.findByText('Identidade alterada')).toBeInTheDocument();
    expect(screen.getByLabelText('Fila de unidades')).toBeInTheDocument();
    expect(screen.getByLabelText('Objeto empresarial ativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contexto da decisão')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([input]) => !parseRequestPath(input).pathname.includes('service-orders'))).toBe(true);
  });

  it('exposes an explicit network error and retry without pretending there are zero units', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fail) throw new TypeError('Network unavailable');
      return reply({ items: [], unconfigured: [], canCreate: false });
    }));
    const user = userEvent.setup();
    render(<OperationalUnitsTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('não foi possível');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Reconsultar diretório' }));
    expect(await screen.findByText('Nenhuma unidade empresarial configurada neste escopo.')).toBeInTheDocument();
  });

  it('does not render a manage command for a read-only operator', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = parseRequestPath(input);
      if (pathname.endsWith('/history')) return reply({ unit: { ...UNIT, canManage: false }, events: [] });
      return reply({ items: [{ ...UNIT, canManage: false }], unconfigured: [], canCreate: false });
    }));
    render(<OperationalUnitsTab />);
    await screen.findByText('Unidades operacionais · Control Tower');
    await waitFor(() => expect(screen.getAllByText('Porto Velho').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Registrar unidade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar nova versão' })).not.toBeInTheDocument();
  });
});

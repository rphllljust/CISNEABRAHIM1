import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeApiError } from '../financial-ui/enterprise-api';
import { PayrollRoute } from './pages/PayrollPage';

const {
  expireSession, resolveAuthorizedUnit, probeSurfaceAccess, probeExplicitCapability,
} = vi.hoisted(() => ({
  expireSession: vi.fn(),
  resolveAuthorizedUnit: vi.fn(),
  probeSurfaceAccess: vi.fn(),
  probeExplicitCapability: vi.fn(),
}));

vi.mock('../auth/context/AuthProvider', () => ({
  useAuth: () => ({ expireSession, identityId: 'identity-test' }),
}));

vi.mock('../shell/surface-access', () => ({
  resolveAuthorizedUnit,
  probeSurfaceAccess,
  probeExplicitCapability,
}));

function mount() {
  return render(
    <MemoryRouter initialEntries={['/app/payroll']}>
      <Routes>
        <Route path="/app/payroll" element={
          <PayrollRoute><p>Folha autorizada</p></PayrollRoute>
        } />
        <Route path="/app/no-access" element={<p>Acesso negado</p>} />
        <Route path="/login" element={<p>Sessão expirada</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('payroll access gate uses authoritative responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthorizedUnit.mockResolvedValue('UNIT-A');
    probeExplicitCapability.mockResolvedValue({ outcome: 'denied' });
  });

  it('shows recovery for transient 503 instead of false 403', async () => {
    probeSurfaceAccess
      .mockRejectedValueOnce(new BackofficeApiError(503, undefined, 'unknown'))
      .mockResolvedValueOnce({ outcome: 'allowed' });
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/serviço pode estar indisponível/i);
    expect(screen.queryByText('Acesso negado')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Folha autorizada')).toBeInTheDocument();
    expect(probeSurfaceAccess).toHaveBeenCalledTimes(2);
  });

  it('respects an actual PDP denial', async () => {
    probeSurfaceAccess.mockResolvedValue({ outcome: 'denied' });
    mount();
    expect(await screen.findByText('Acesso negado')).toBeInTheDocument();
  });

  it('expires the session on a backend 401', async () => {
    probeSurfaceAccess.mockRejectedValue(new BackofficeApiError(401, undefined, 'denied'));
    mount();
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
    expect(expireSession).toHaveBeenCalled();
  });
});

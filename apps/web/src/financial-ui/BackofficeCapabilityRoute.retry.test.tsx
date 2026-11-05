import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BackofficeApiError } from './enterprise-api';
import { BackofficeCapabilityRoute } from './BackofficeCapabilityRoute';

vi.mock('../auth/context/AuthProvider', () => ({
  useAuth: () => ({ expireSession: vi.fn() }),
}));

function mount(probe: () => Promise<boolean>) {
  return render(
    <MemoryRouter initialEntries={['/app/inventory']}>
      <Routes>
        <Route path="/app/inventory" element={
          <BackofficeCapabilityRoute probe={probe} capabilityId="inventory:item:list">
            <p>Conteúdo autorizado</p>
          </BackofficeCapabilityRoute>
        } />
        <Route path="/app/no-access" element={<p>Acesso negado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('shared ERP module gate', () => {
  it('provides recovery on outage rather than sending the operator to 403', async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(true);
    const user = userEvent.setup();
    mount(probe);
    expect(await screen.findByRole('alert')).toHaveTextContent(/serviço pode estar indisponível/);
    expect(screen.queryByText('Acesso negado')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Conteúdo autorizado')).toBeInTheDocument();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('still denies verified PDP rejection', async () => {
    mount(vi.fn().mockRejectedValue(new BackofficeApiError(403, undefined, 'denied')));
    expect(await screen.findByText('Acesso negado')).toBeInTheDocument();
  });
});

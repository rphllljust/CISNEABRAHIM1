import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsRoute } from '../clients/ClientsRoute';
import { ProposalsRoute } from '../proposals/ProposalsRoute';
import { CapabilityRoute } from './CapabilityRoute';
import { probeClientListAccess } from '../clients/api/clients-api';
import { probeProposalListAccess } from '../proposals/api/proposals-api';
import { probeRequest } from '../auth/api/authz-api';

vi.mock('../clients/api/clients-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/api/clients-api')>()),
  probeClientListAccess: vi.fn(),
}));
vi.mock('../proposals/api/proposals-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../proposals/api/proposals-api')>()),
  probeProposalListAccess: vi.fn(),
}));
vi.mock('../auth/api/authz-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/api/authz-api')>()),
  probeRequest: vi.fn(),
}));
vi.mock('../auth/context/AuthProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/context/AuthProvider')>()),
  useAuth: () => ({ expireSession: vi.fn() }),
}));

function route(element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/app/module']}>
      <Routes>
        <Route path="/app/module" element={element} />
        <Route path="/app/no-access" element={<p>Acesso negado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Gates de acesso empresarial — falha de infraestrutura nao e acesso negado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Clientes oferece retry apos falha de rede e recupera a tela', async () => {
    vi.mocked(probeClientListAccess).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(true);
    route(<ClientsRoute><p>Clientes disponíveis</p></ClientsRoute>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Acesso negado')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Clientes disponíveis')).toBeTruthy();
  });

  it('Propostas preserva 403 como negativa real, sem simular falha', async () => {
    vi.mocked(probeProposalListAccess).mockResolvedValue(false);
    route(<ProposalsRoute><p>Propostas disponíveis</p></ProposalsRoute>);
    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Propostas oferece retry quando a API esta indisponivel', async () => {
    vi.mocked(probeProposalListAccess).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(true);
    route(<ProposalsRoute><p>Propostas disponíveis</p></ProposalsRoute>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Propostas disponíveis')).toBeTruthy();
  });

  it('CapabilityRoute distingue erro de rede de negativa do PDP', async () => {
    vi.mocked(probeRequest).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined as never);
    route(<CapabilityRoute><p>Capacidades disponíveis</p></CapabilityRoute>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Acesso negado')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Capacidades disponíveis')).toBeTruthy();
  });
});

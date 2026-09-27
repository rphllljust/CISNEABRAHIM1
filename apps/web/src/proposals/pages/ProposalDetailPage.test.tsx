import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-with-providers';
import { createCommercialFetchMock } from '../../test/commercial-fetch-mock';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { ProposalDetailPage } from './ProposalDetailPage';

const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function renderDetail() {
  // O helper já fornece o MemoryRouter; aqui só se declara a rota e o caminho inicial.
  return renderWithProviders(
    <Routes>
      <Route path="/app/proposals/:proposalId" element={<ProposalDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/proposals/${PROPOSAL_ID}`] } },
  );
}

describe('ProposalDetailPage — commercial workbench', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows the commercial decision surface with one contextual primary action', async () => {
    vi.stubGlobal('fetch', createCommercialFetchMock());
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /resumo comercial/i })).toBeInTheDocument();
    });

    // Hierarquia: resumo, composição, cadeia, linha do tempo e revisões.
    expect(screen.getByRole('heading', { name: /composição comercial/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /cadeia comercial/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /linha do tempo comercial/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /revisões e comparação/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();

    // Nome humano do cliente (módulo CLIENTES autorizado) — nunca o UUID.
    expect(screen.getAllByText('Cliente Demo').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).not.toBeInTheDocument();

    // Ação primária contextual única (rascunho → emitir) e secundária subordinada (cancelar).
    expect(screen.getByRole('button', { name: /emitir proposta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar versão/i })).toBeInTheDocument();
    // Nenhuma ação de decisão do cliente é oferecida em rascunho.
    expect(screen.queryByRole('button', { name: /registrar aceite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registrar rejeição/i })).not.toBeInTheDocument();

    // Revisão vigente declarada e próximo passo derivado do estado.
    expect(screen.getAllByText(/revisão 1/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/completar e emitir a proposta/i)).toBeInTheDocument();
  });

  it('does not offer a transition the actor is not authorized to perform', async () => {
    vi.stubGlobal('fetch', createCommercialFetchMock({ proposalIssueAllowed: false }));
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /emitir proposta/i })).not.toBeInTheDocument();
  });
});

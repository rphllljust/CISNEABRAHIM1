import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/**
 * A pagina passou a ser a OBJECT PAGE canonica: o MESMO conteudo comercial aparece agora na
 * gramatica do contrato enterprise (header, relacoes, paineis do corpo e historico). As
 * assercoes abaixo provam os mesmos FATOS de negocio, na nova estrutura.
 */
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
      expect(screen.getByRole('heading', { name: /composição comercial/i })).toBeInTheDocument();
    });

    // Hierarquia canonica: referencia/titulo no header, contexto, relacoes, corpo e historico.
    expect(screen.getByRole('heading', { name: 'Proposta de serviços' })).toBeInTheDocument();
    expect(screen.getAllByText('PROP-2026-DEMO01').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /revisões e comparação/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /cadeia comercial/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /histórico/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /próxima ação/i })).toBeInTheDocument();

    // Nome humano do cliente (módulo CLIENTES autorizado) — nunca o UUID.
    expect(screen.getAllByText('Cliente Demo').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).not.toBeInTheDocument();

    // Ação primária contextual única no header (rascunho → emitir); as demais ficam em
    // "Mais ações", com a transição destrutiva separada no fim do menu.
    const header = screen.getByRole('banner');
    const primary = within(header).getAllByRole('button', { name: /emitir proposta/i });
    expect(primary).toHaveLength(1);
    expect(within(header).queryByRole('button', { name: /cancelar versão/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(header).getByRole('button', { name: 'Mais ações' }));
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /cancelar versão/i }),
    ).toBeInTheDocument();
    // Nenhuma ação de decisão do cliente é oferecida em rascunho.
    expect(screen.queryByRole('button', { name: /registrar aceite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registrar rejeição/i })).not.toBeInTheDocument();

    // Revisão vigente declarada e próximo passo derivado do estado.
    expect(screen.getAllByText(/revisão 1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/completar e emitir a proposta/i).length).toBeGreaterThan(0);
  });

  it('does not offer a transition the actor is not authorized to perform', async () => {
    vi.stubGlobal('fetch', createCommercialFetchMock({ proposalIssueAllowed: false }));
    renderDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /composição comercial/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /emitir proposta/i })).not.toBeInTheDocument();
  });
});
